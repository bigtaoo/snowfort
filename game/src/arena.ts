import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import { blockMesh, debrisMesh, hurtBlock, kingMesh, projectileMesh } from './look/meshes';
import {
  AMMO, ARENA, BLOCK_HALF_DEPTH, CARDS, CATAPULT, MATERIALS, PHYSICS, PIECES, PROJECTILE, REPLAY,
  type MaterialId, type PieceId,
} from './config';

export type Side = 0 | 1;
export type AmmoId = 'snowball' | 'bigIce' | 'split' | 'cocoa' | 'firework' | 'frost';
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
  /** Bouncy fence card: a springy plank. */
  spring?: boolean;
  /** Damage taken by a king this round (impulse units). */
  impact?: number;
  /** The king's current hit: when it started and how much it has done so far. */
  hitStart?: number;
  hitDmg?: number;
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


export interface ImpactEvent {
  x: number;
  y: number;
  owner: Side;
  ammo: AmmoId;
  /** The shot's first contact was a bouncy fence. */
  spring?: boolean;
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
  /** Damage each king took this step, for the HUD. */
  kingHits: { owner: Side; dmg: number }[] = [];
  /** Blocks shattered since the last step began, for sounds. */
  breaks: MaterialId[] = [];
  /** Extra force on each side's shots (wind card), set at round start. */
  wind: [number, number] = [0, 0];
  /** Off while building: blocks dropped into place should not crack. */
  damageOn = false;
  /** Every hit counts this many times (turn mode makes each shot matter more). */
  damageMul = 1;

  constructor(scene: THREE.Scene) {
    scene.add(this.group);
    this.world = this.makeWorld();
  }

  private makeWorld(): RAPIER.World {
    const w = new RAPIER.World({ x: 0, y: PHYSICS.gravity, z: 0 });
    w.timestep = PHYSICS.dt;
    // the plateaus reach the drawn cliffs (look/scenery.ts CLIFF_Z); the replay frees z, so the
    // ravine floor is one wide slab that also catches whatever falls off their fronts
    const hz = ARENA.depth / 2 + 1;
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
      RAPIER.ColliderDesc.cuboid(ARENA.outerX, 0.5, 40)
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
    // Only the rotations are locked: locking z translation as well leaves Rapier (0.21) with no
    // friction at all, so bodies slid like on ice. z is pinned by hand after each step instead.
    if (!this.freed) d.enabledRotations(false, false, true);
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
      mesh: makeMesh(data, this.nextId),
      alive: true,
    };
    this.ents.push(e);
    this.byCollider.set(collider.handle, e);
    this.group.add(e.mesh);
    syncMesh(e);
    return e;
  }

  addPiece(piece: PieceId, owner: Side, x: number, y: number, decoy = false, spring = false): Entity {
    const spec = PIECES[piece];
    const mat = MATERIALS[spec.material];
    const body = this.world.createRigidBody(this.bodyDesc(x, y).setLinearDamping(PHYSICS.blockDamping).setAngularDamping(PHYSICS.blockDamping));
    const desc = RAPIER.ColliderDesc.cuboid(spec.hx, spec.hy, BLOCK_HALF_DEPTH);
    // a springy plank is heavy so it stands its ground, and its bounce wins over the ball's
    if (spring) desc.setRestitutionCombineRule(RAPIER.CoefficientCombineRule.Max);
    const col = this.world.createCollider(
      desc
        .setDensity(spring ? CARDS.springDensity : mat.density)
        .setFriction(mat.friction)
        .setRestitution(spring ? CARDS.springRestitution : mat.restitution)
        .setCollisionGroups(blockGroups(owner))
        .setActiveEvents(RAPIER.ActiveEvents.CONTACT_FORCE_EVENTS)
        .setContactForceEventThreshold(mat.armor / PHYSICS.dt),
      body,
    );
    const kind: Kind = piece === 'king' ? (decoy ? 'decoy' : 'king') : 'block';
    const hp = spring ? mat.hp * CARDS.springHpMul : mat.hp;
    return this.register({ kind, owner, piece, hp, maxHp: hp, impact: 0, spring }, body, col);
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
    ((e.mesh as THREE.Mesh).material as THREE.MeshToonMaterial).color.setHex(color);
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
    const mat = e.piece ? PIECES[e.piece].material : 'snow';
    if (mat !== 'king') this.breaks.push(mat);
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
    this.kingHits = [];
    this.breaks = [];
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
            this.impacts.push({ x: p.x, y: p.y, owner: e.owner, ammo: e.ammo ?? 'snowball', spring: !!other?.spring });
          }
          continue;
        }
        if (e.kind === 'debris' || !this.damageOn) continue;
        // Debris is cosmetic: it never hurts anything.
        if (other?.kind === 'debris') continue;
        const mat = MATERIALS[PIECES[e.piece!].material];
        const direct = other?.kind === 'projectile';
        const dmg = (impulse - mat.armor) * (direct ? 1 : PHYSICS.knockOnDamage) * this.damageMul;
        if (dmg <= 0) continue;
        if (this.freed && other?.kind === 'projectile') {
          e.body.applyImpulse({ x: 0, y: 0, z: (Math.random() - 0.5) * REPLAY.hitZImpulse * impulse }, true);
        }
        if (e.kind === 'king') {
          // one shot lands over several steps (and knocks blocks into him): it all counts as one hit
          if (e.hitStart === undefined || this.time - e.hitStart > PHYSICS.kingHitWindow) {
            e.hitStart = this.time;
            e.hitDmg = 0;
          }
          const hit = Math.min(dmg, MATERIALS.king.hp * PHYSICS.kingMaxHitShare - e.hitDmg!);
          if (hit <= 0) continue;
          e.hitDmg! += hit;
          e.impact = (e.impact ?? 0) + hit;
          this.kingHits.push({ owner: e.owner, dmg: hit });
        }
        else if (e.kind === 'block') e.hp -= dmg;
      }
    });
    for (const e of this.ents) {
      if (!e.alive) continue;
      const p = e.body.translation();
      if (!this.freed && p.z !== 0) {
        e.body.setTranslation({ x: p.x, y: p.y, z: 0 }, false);
        const v = e.body.linvel();
        e.body.setLinvel({ x: v.x, y: v.y, z: 0 }, false);
      }
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
      const e: Entity = { ...d, body: this.world.getRigidBody(d.bodyHandle), mesh: makeMesh(d, d.id), alive: true };
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

function makeMesh(d: Omit<EntityData, 'id' | 'bodyHandle' | 'colliderHandle' | 'born'>, seed: number): THREE.Object3D {
  if (d.kind === 'king' || d.kind === 'decoy') return kingMesh(d.owner);
  if (d.kind === 'projectile') return projectileMesh(d.ammo, d.radius ?? PROJECTILE.radius);
  if (d.kind === 'debris') return debrisMesh(0xffffff);
  return blockMesh(d.piece!, seed, d.spring);
}

function syncMesh(e: Entity): void {
  const p = e.body.translation();
  const r = e.body.rotation();
  e.mesh.position.set(p.x, p.y, p.z);
  e.mesh.quaternion.set(r.x, r.y, r.z, r.w);
  if (e.kind === 'block' && e.hp < e.maxHp) hurtBlock(e.mesh, e.hp / e.maxHp);
}
