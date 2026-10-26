import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import {
  AMMO, ARENA, BLOCK_HALF_DEPTH, CATAPULT, COLORS, MATERIALS, PHYSICS, PIECES, PROJECTILE, REPLAY,
  type PieceId,
} from './config';

export type Side = 0 | 1;
export type AmmoId = 'snowball' | 'bigIce' | 'split' | 'cocoa' | 'firework';
type Kind = 'block' | 'king' | 'decoy' | 'projectile' | 'debris';

/** Plain data of an entity: what a snapshot keeps so meshes can be rebuilt after a restore. */
export interface EntityData {
  id: number;
  kind: Kind;
  owner: Side;
  piece?: PieceId;
  hp: number;
  maxHp: number;
  bodyHandle: number;
  colliderHandle: number;
  born: number;
  ammo?: AmmoId;
  radius?: number;
  hitAt?: number;
  /** Split balls split once, at the top of the arc. */
  spent?: boolean;
  /** Debris and broken blocks vanish at this sim time. */
  dieAt?: number;
  /** Damage taken by a king this round (impulse units). */
  impact?: number;
}

export interface Entity extends EntityData {
  body: RAPIER.RigidBody;
  mesh: THREE.Object3D;
  alive: boolean;
}

interface Snapshot {
  time: number;
  bytes: Uint8Array;
  ents: EntityData[];
}

// Collision groups: membership bits in the high half, filter bits in the low half.
const G = { world: 1, b0: 2, b1: 4, p0: 8, p1: 16, debris: 32 } as const;
const ALL = 0xffff;
const groups = (member: number, filter: number) => (member << 16) | filter;
// A player's own shots fly through their own fort.
const blockGroups = (s: Side) => groups(s === 0 ? G.b0 : G.b1, ALL & ~(s === 0 ? G.p0 : G.p1));
const shotGroups = (s: Side) => groups(s === 0 ? G.p0 : G.p1, ALL & ~(s === 0 ? G.b0 : G.b1) & ~G.debris);
const debrisGroups = groups(G.debris, G.world | G.b0 | G.b1 | G.debris);

const SIDE_COLOR = [COLORS.p1, COLORS.p2];

export interface ImpactEvent {
  x: number;
  y: number;
  owner: Side;
  ammo: AmmoId;
}

/** The physics world plus the meshes that mirror its bodies. */
export class Arena {
  world!: RAPIER.World;
  readonly events = new RAPIER.EventQueue(true);
  readonly group = new THREE.Group();
  ents: Entity[] = [];
  private byCollider = new Map<number, Entity>();
  private nextId = 1;
  time = 0;
  /** Victory replay: bodies are free in 3D and hits shove them out of the plane. */
  freed = false;
  private snapshots: Snapshot[] = [];
  private lastSnapshotAt = -1;
  /** Projectile first-contacts this step, for sounds, effects and cocoa. */
  impacts: ImpactEvent[] = [];
  /** Extra force on each side's shots (wind card), set at round start. */
  wind: [number, number] = [0, 0];
  /** Off while building: blocks dropped into place should not crack. */
  damageOn = false;

  constructor(scene: THREE.Scene) {
    scene.add(this.group);
    this.world = this.makeWorld();
  }

  private makeWorld(): RAPIER.World {
    const w = new RAPIER.World({ x: 0, y: PHYSICS.gravity, z: 0 });
    w.timestep = PHYSICS.dt;
    const hz = ARENA.depth / 2;
    const plateauHalfX = (ARENA.outerX - ARENA.edgeX) / 2;
    const plateauHalfY = (ARENA.groundY - ARENA.ravineY) / 2;
    for (const sign of [-1, 1]) {
      const cx = sign * (ARENA.edgeX + plateauHalfX);
      w.createCollider(
        RAPIER.ColliderDesc.cuboid(plateauHalfX, plateauHalfY, hz)
          .setTranslation(cx, ARENA.groundY - plateauHalfY, 0)
          .setFriction(1)
          .setCollisionGroups(groups(G.world, ALL)),
      );
    }
    w.createCollider(
      RAPIER.ColliderDesc.cuboid(ARENA.edgeX + 1, 0.5, hz)
        .setTranslation(0, ARENA.ravineY - 0.5, 0)
        .setFriction(1)
        .setCollisionGroups(groups(G.world, ALL)),
    );
    return w;
  }

  /** Clears all bodies (new match). */
  reset(): void {
    for (const e of this.ents) this.group.remove(e.mesh);
    this.ents = [];
    this.byCollider.clear();
    this.world.free();
    this.world = this.makeWorld();
    this.freed = false;
    this.damageOn = false;
    this.snapshots = [];
    this.lastSnapshotAt = -1;
    this.time = 0;
  }

  // ---------- creation ----------

  private bodyDesc(x: number, y: number): RAPIER.RigidBodyDesc {
    const d = RAPIER.RigidBodyDesc.dynamic().setTranslation(x, y, 0);
    if (!this.freed) d.enabledTranslations(true, true, false).enabledRotations(false, false, true);
    return d;
  }

  private register(data: Omit<EntityData, 'id' | 'bodyHandle' | 'colliderHandle' | 'born'>, body: RAPIER.RigidBody, collider: RAPIER.Collider): Entity {
    const e: Entity = {
      ...data,
      id: this.nextId++,
      bodyHandle: body.handle,
      colliderHandle: collider.handle,
      born: this.time,
      body,
      mesh: makeMesh(data),
      alive: true,
    };
    this.ents.push(e);
    this.byCollider.set(collider.handle, e);
    this.group.add(e.mesh);
    syncMesh(e);
    return e;
  }

  addPiece(piece: PieceId, owner: Side, x: number, y: number, decoy = false): Entity {
    const spec = PIECES[piece];
    const mat = MATERIALS[spec.material];
    const body = this.world.createRigidBody(this.bodyDesc(x, y).setLinearDamping(PHYSICS.blockDamping).setAngularDamping(PHYSICS.blockDamping));
    const col = this.world.createCollider(
      RAPIER.ColliderDesc.cuboid(spec.hx, spec.hy, BLOCK_HALF_DEPTH)
        .setDensity(mat.density)
        .setFriction(mat.friction)
        .setRestitution(mat.restitution)
        .setCollisionGroups(blockGroups(owner))
        .setActiveEvents(RAPIER.ActiveEvents.CONTACT_FORCE_EVENTS)
        .setContactForceEventThreshold(mat.armor / PHYSICS.dt),
      body,
    );
    const kind: Kind = piece === 'king' ? (decoy ? 'decoy' : 'king') : 'block';
    return this.register({ kind, owner, piece, hp: mat.hp, maxHp: mat.hp, impact: 0 }, body, col);
  }

  addProjectile(owner: Side, ammo: AmmoId, x: number, y: number, vx: number, vy: number, massMul: number): Entity {
    let radius = PROJECTILE.radius;
    let density = PROJECTILE.density * massMul;
    if (ammo === 'bigIce') { radius = AMMO.bigIce.radius; density *= AMMO.bigIce.densityMul; }
    if (ammo === 'firework') { radius = AMMO.firework.radius; density *= AMMO.firework.densityMul; }
    const desc = this.bodyDesc(x, y).setLinvel(vx, vy, 0).setCcdEnabled(true);
    if (ammo === 'firework') desc.setGravityScale(AMMO.firework.gravityScale);
    const body = this.world.createRigidBody(desc);
    const col = this.world.createCollider(
      RAPIER.ColliderDesc.ball(radius)
        .setDensity(density)
        .setFriction(PROJECTILE.friction)
        .setRestitution(PROJECTILE.restitution)
        .setCollisionGroups(shotGroups(owner))
        .setActiveEvents(RAPIER.ActiveEvents.CONTACT_FORCE_EVENTS)
        .setContactForceEventThreshold(0),
      body,
    );
    const w = this.wind[owner];
    if (w) body.addForce({ x: w * body.mass(), y: 0, z: 0 }, true);
    return this.register({ kind: 'projectile', owner, ammo, radius, hp: 1, maxHp: 1 }, body, col);
  }

  private addDebris(x: number, y: number, color: number, vx: number, vy: number): void {
    const s = PHYSICS.debrisSize / 2;
    const body = this.world.createRigidBody(
      this.bodyDesc(x, y).setLinvel(vx, vy, this.freed ? (Math.random() - 0.5) * 4 : 0).setAngvel({ x: 0, y: 0, z: (Math.random() - 0.5) * 10 }),
    );
    const col = this.world.createCollider(
      RAPIER.ColliderDesc.cuboid(s, s, s).setDensity(0.6).setCollisionGroups(debrisGroups),
      body,
    );
    const e = this.register({ kind: 'debris', owner: 0, hp: 1, maxHp: 1, dieAt: this.time + PHYSICS.debrisLife }, body, col);
    ((e.mesh as THREE.Mesh).material as THREE.MeshStandardMaterial).color.setHex(color);
  }

  remove(e: Entity): void {
    if (!e.alive) return;
    e.alive = false;
    this.byCollider.delete(e.colliderHandle);
    this.world.removeRigidBody(e.body);
    this.group.remove(e.mesh);
  }

  /** Shatters a block into debris. */
  breakBlock(e: Entity): void {
    if (!e.alive) return;
    const p = e.body.translation();
    const v = e.body.linvel();
    const color = e.piece ? MATERIALS[PIECES[e.piece].material].color : 0xffffff;
    this.remove(e);
    for (let i = 0; i < PHYSICS.debrisPerBreak; i++) {
      this.addDebris(
        p.x + (Math.random() - 0.5) * 0.6, p.y + (Math.random() - 0.5) * 0.6, color,
        v.x * 0.5 + (Math.random() - 0.5) * 5, v.y * 0.5 + Math.random() * 4,
      );
    }
  }

  // ---------- queries ----------

  /** True if a piece placed here would overlap another piece or a shot (2D box test, exact right after placing). */
  overlaps(piece: PieceId, x: number, y: number): boolean {
    const spec = PIECES[piece];
    const a = { x, y, hx: spec.hx * 0.98, hy: spec.hy * 0.98, angle: 0 };
    return this.ents.some((e) => e.alive && e.kind !== 'debris' && boxesOverlap(a, boxOf(e)));
  }

  /** The own piece (block or king) under a point, if any. */
  pieceAt(x: number, y: number, owner: Side): Entity | null {
    return this.ents.find((e) => e.alive && e.owner === owner && (e.kind === 'block' || e.kind === 'king' || e.kind === 'decoy') && pointInBox(x, y, boxOf(e))) ?? null;
  }

  king(side: Side): Entity | undefined {
    return this.ents.find((e) => e.alive && e.kind === 'king' && e.owner === side);
  }

  // ---------- stepping ----------

  step(): void {
    this.impacts = [];
    this.world.step(this.events);
    this.time += PHYSICS.dt;
    const dt = PHYSICS.dt;
    this.events.drainContactForceEvents((ev) => {
      const a = this.byCollider.get(ev.collider1());
      const b = this.byCollider.get(ev.collider2());
      const impulse = ev.totalForceMagnitude() * dt;
      for (const [e, other] of [[a, b], [b, a]] as const) {
        if (!e || !e.alive) continue;
        if (e.kind === 'projectile') {
          if (e.hitAt === undefined) {
            e.hitAt = this.time;
            const p = e.body.translation();
            this.impacts.push({ x: p.x, y: p.y, owner: e.owner, ammo: e.ammo ?? 'snowball' });
          }
          continue;
        }
        if (e.kind === 'debris' || !this.damageOn) continue;
        // Debris is cosmetic: it never hurts anything.
        if (other?.kind === 'debris') continue;
        const mat = MATERIALS[PIECES[e.piece!].material];
        const direct = other?.kind === 'projectile';
        const dmg = (impulse - mat.armor) * (direct ? 1 : PHYSICS.knockOnDamage);
        if (dmg <= 0) continue;
        if (this.freed && other?.kind === 'projectile') {
          e.body.applyImpulse({ x: 0, y: 0, z: (Math.random() - 0.5) * REPLAY.hitZImpulse * impulse }, true);
        }
        if (e.kind === 'king') e.impact = (e.impact ?? 0) + Math.min(dmg, MATERIALS.king.hp * PHYSICS.kingMaxHitShare);
        else if (e.kind === 'block') e.hp -= dmg;
      }
    });
    for (const e of this.ents) {
      if (!e.alive) continue;
      const p = e.body.translation();
      if (p.y < ARENA.ravineY - 6) { this.remove(e); continue; }
      if (e.kind === 'block' && e.hp <= 0) this.breakBlock(e);
      else if (e.kind === 'debris' && e.dieAt !== undefined && this.time > e.dieAt) this.remove(e);
      else if (e.kind === 'projectile') this.stepProjectile(e);
    }
    this.ents = this.ents.filter((e) => e.alive);
    if (!this.freed && this.time - this.lastSnapshotAt >= REPLAY.snapshotEvery) this.snapshot();
  }

  private stepProjectile(e: Entity): void {
    const ammo = e.ammo ?? 'snowball';
    const linger = ammo === 'bigIce' ? AMMO.bigIce.lingerAfterHit : PROJECTILE.lingerAfterHit;
    if ((e.hitAt !== undefined && this.time - e.hitAt > linger) || this.time - e.born > PROJECTILE.maxLife) {
      this.remove(e);
      return;
    }
    if (ammo === 'split' && !e.spent && e.hitAt === undefined && e.body.linvel().y < 0) {
      e.spent = true;
      const p = e.body.translation();
      const v = e.body.linvel();
      const mass = e.body.mass();
      const massMul = mass / ((4 / 3) * Math.PI * PROJECTILE.radius ** 3 * PROJECTILE.density);
      this.remove(e);
      const n = AMMO.split.count;
      for (let i = 0; i < n; i++) {
        const k = i - (n - 1) / 2;
        this.addProjectile(e.owner, 'snowball', p.x, p.y + k * 0.1, v.x + k * AMMO.split.spreadSpeed * 0.4, v.y + k * AMMO.split.spreadSpeed, massMul);
      }
    }
  }

  /** Copies body poses onto meshes. */
  sync(): void {
    for (const e of this.ents) if (e.alive) syncMesh(e);
  }

  // ---------- replay ----------

  private snapshot(): void {
    this.lastSnapshotAt = this.time;
    this.snapshots.push({ time: this.time, bytes: this.world.takeSnapshot(), ents: this.ents.filter((e) => e.alive).map(dataOf) });
    if (this.snapshots.length > REPLAY.snapshotKeep) this.snapshots.shift();
  }

  /** Rewinds to shortly before `decidedAt` and frees every body into 3D. Returns false if no snapshot fits. */
  rewindForReplay(decidedAt: number): boolean {
    const snap = [...this.snapshots].reverse().find((s) => s.time <= decidedAt - REPLAY.leadSeconds) ?? this.snapshots[0];
    if (!snap) return false;
    for (const e of this.ents) this.group.remove(e.mesh);
    this.world.free();
    this.world = RAPIER.World.restoreSnapshot(snap.bytes);
    this.time = snap.time;
    this.byCollider.clear();
    this.ents = snap.ents.map((d) => {
      const e: Entity = { ...d, body: this.world.getRigidBody(d.bodyHandle), mesh: makeMesh(d), alive: true };
      this.byCollider.set(d.colliderHandle, e);
      this.group.add(e.mesh);
      return e;
    });
    this.freeAll();
    this.sync();
    return true;
  }

  private freeAll(): void {
    this.freed = true;
    for (const e of this.ents) {
      if (!e.alive) continue;
      const b = e.body;
      b.setEnabledTranslations(true, true, true, true);
      b.setEnabledRotations(true, true, true, true);
      if (e.kind === 'projectile') continue;
      const p = b.translation();
      b.setTranslation({ x: p.x, y: p.y, z: (Math.random() - 0.5) * REPLAY.zJitter }, true);
      const w = b.angvel();
      b.setAngvel({ x: (Math.random() - 0.5) * REPLAY.spinJitter, y: (Math.random() - 0.5) * REPLAY.spinJitter, z: w.z }, true);
    }
  }

  /** Where shots leave each catapult. */
  static muzzle(side: Side, angle: number): { x: number; y: number } {
    const dir = side === 0 ? 1 : -1;
    return {
      x: dir * -CATAPULT.x + dir * Math.cos(angle) * CATAPULT.barrelLength,
      y: CATAPULT.pivotY + Math.sin(angle) * CATAPULT.barrelLength,
    };
  }
}

interface Box2 { x: number; y: number; hx: number; hy: number; angle: number }

function boxOf(e: Entity): Box2 {
  const p = e.body.translation();
  const q = e.body.rotation();
  const angle = 2 * Math.atan2(q.z, q.w);
  if (e.kind === 'projectile') { const r = e.radius ?? PROJECTILE.radius; return { x: p.x, y: p.y, hx: r, hy: r, angle: 0 }; }
  const spec = PIECES[e.piece!];
  return { x: p.x, y: p.y, hx: spec.hx, hy: spec.hy, angle };
}

function axesOf(b: Box2): [number, number][] {
  const c = Math.cos(b.angle), s = Math.sin(b.angle);
  return [[c, s], [-s, c]];
}

/** Separating-axis test for two rotated rectangles. */
function boxesOverlap(a: Box2, b: Box2): boolean {
  const dx = b.x - a.x, dy = b.y - a.y;
  const aa = axesOf(a), ba = axesOf(b);
  for (const [ax, ay] of [...aa, ...ba]) {
    const ra = a.hx * Math.abs(aa[0][0] * ax + aa[0][1] * ay) + a.hy * Math.abs(aa[1][0] * ax + aa[1][1] * ay);
    const rb = b.hx * Math.abs(ba[0][0] * ax + ba[0][1] * ay) + b.hy * Math.abs(ba[1][0] * ax + ba[1][1] * ay);
    if (Math.abs(dx * ax + dy * ay) > ra + rb) return false;
  }
  return true;
}

function pointInBox(x: number, y: number, b: Box2): boolean {
  const [[ux, uy], [vx, vy]] = axesOf(b);
  const dx = x - b.x, dy = y - b.y;
  return Math.abs(dx * ux + dy * uy) <= b.hx && Math.abs(dx * vx + dy * vy) <= b.hy;
}

const dataOf = (e: Entity): EntityData => {
  const { body: _b, mesh: _m, alive: _a, ...d } = e;
  return { ...d };
};

// ---------- meshes ----------

const geoCache = new Map<string, THREE.BufferGeometry>();
const geo = (key: string, make: () => THREE.BufferGeometry) => {
  let g = geoCache.get(key);
  if (!g) geoCache.set(key, (g = make()));
  return g;
};

function makeMesh(d: Omit<EntityData, 'id' | 'bodyHandle' | 'colliderHandle' | 'born'>): THREE.Object3D {
  if (d.kind === 'king' || d.kind === 'decoy') return makeKing(d.owner);
  if (d.kind === 'projectile') {
    const r = d.radius ?? PROJECTILE.radius;
    const color = d.ammo === 'bigIce' ? 0x9fdcff : d.ammo === 'cocoa' ? 0x7a4a2a : d.ammo === 'firework' ? 0xffc23d : d.ammo === 'split' ? 0xd8f0ff : 0xffffff;
    const m = new THREE.Mesh(geo(`ball${r}`, () => new THREE.SphereGeometry(r, 16, 12)), new THREE.MeshStandardMaterial({ color, roughness: 0.6, emissive: d.ammo === 'firework' ? 0x553300 : 0 }));
    m.castShadow = true;
    return m;
  }
  if (d.kind === 'debris') {
    const s = PHYSICS.debrisSize;
    return new THREE.Mesh(geo('debris', () => new THREE.BoxGeometry(s, s, s)), new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.8 }));
  }
  const spec = PIECES[d.piece!];
  const mat = MATERIALS[spec.material];
  const m = new THREE.Mesh(
    geo(`box${spec.hx},${spec.hy}`, () => new THREE.BoxGeometry(spec.hx * 2, spec.hy * 2, BLOCK_HALF_DEPTH * 2)),
    new THREE.MeshStandardMaterial({
      color: mat.color,
      roughness: spec.material === 'ice' ? 0.15 : 0.85,
      transparent: mat.opacity < 1,
      opacity: mat.opacity,
    }),
  );
  m.castShadow = true;
  m.receiveShadow = true;
  // a thin stripe in the owner's colour so forts read at a glance
  const stripe = new THREE.Mesh(
    geo(`stripe${spec.hx},${spec.hy}`, () => new THREE.BoxGeometry(spec.hx * 2 * 0.9, Math.min(0.06, spec.hy), 0.02)),
    new THREE.MeshBasicMaterial({ color: SIDE_COLOR[d.owner] }),
  );
  stripe.position.set(0, -spec.hy + 0.08, BLOCK_HALF_DEPTH + 0.011);
  m.add(stripe);
  return m;
}

function makeKing(owner: Side): THREE.Object3D {
  const g = new THREE.Group();
  const snow = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9 });
  const spec = PIECES.king;
  const base = new THREE.Mesh(geo('kingBase', () => new THREE.SphereGeometry(0.5, 20, 14)), snow);
  base.position.y = -spec.hy + 0.48;
  const head = new THREE.Mesh(geo('kingHead', () => new THREE.SphereGeometry(0.34, 20, 14)), snow);
  head.position.y = -spec.hy + 1.16;
  const scarf = new THREE.Mesh(geo('kingScarf', () => new THREE.TorusGeometry(0.3, 0.07, 8, 20)), new THREE.MeshStandardMaterial({ color: SIDE_COLOR[owner] }));
  scarf.rotation.x = Math.PI / 2;
  scarf.position.y = -spec.hy + 0.88;
  const crown = new THREE.Mesh(geo('kingCrown', () => new THREE.CylinderGeometry(0.22, 0.26, 0.24, 5, 1, true)), new THREE.MeshStandardMaterial({ color: 0xffcc33, metalness: 0.4, roughness: 0.4, side: THREE.DoubleSide }));
  crown.position.y = -spec.hy + 1.52;
  const eyeMat = new THREE.MeshBasicMaterial({ color: 0x222222 });
  const facing = owner === 0 ? 1 : -1;
  for (const dx of [-0.1, 0.1]) {
    const eye = new THREE.Mesh(geo('eye', () => new THREE.SphereGeometry(0.045, 8, 6)), eyeMat);
    eye.position.set(facing * 0.08 + dx, -spec.hy + 1.24, 0.3);
    g.add(eye);
  }
  const nose = new THREE.Mesh(geo('nose', () => new THREE.ConeGeometry(0.06, 0.28, 8)), new THREE.MeshStandardMaterial({ color: 0xff8a1c }));
  nose.rotation.z = -facing * Math.PI / 2;
  nose.position.set(facing * 0.36, -spec.hy + 1.13, 0.12);
  g.add(base, head, scarf, crown, nose);
  g.traverse((o) => { o.castShadow = true; });
  return g;
}

function syncMesh(e: Entity): void {
  const p = e.body.translation();
  const r = e.body.rotation();
  e.mesh.position.set(p.x, p.y, p.z);
  e.mesh.quaternion.set(r.x, r.y, r.z, r.w);
  if (e.kind === 'block' && e.hp < e.maxHp) {
    const mat = (e.mesh as THREE.Mesh).material as THREE.MeshStandardMaterial;
    const t = Math.max(0, e.hp / e.maxHp);
    mat.emissive.setRGB((1 - t) * 0.25, 0, 0);
  }
}
