import RAPIER from '@dimforge/rapier3d-compat';
import { Color, Group, InstancedMesh, Matrix4, Quaternion, Vector3, type BufferGeometry, type Material, type Scene } from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { hullGeometry } from './toon';

// The fort: blocks of three materials as instanced meshes (body + hull per material, so six draw
// calls however many blocks), each a Rapier body. In play the bodies are locked to the z = 0
// plane (no z translation, no x/y rotation); the collapse unlocks them.

export type Kind = 'snow' | 'ice' | 'wood';

export interface KindLook {
  size: [number, number, number];
  radius: number;
  body: Material;
  line: Material;
  density: number;
  friction: number;
  /** Per-block colour jitter, so a wall of the same block is not a printed pattern. */
  tint: (i: number) => Color;
}

export interface BlockSpec {
  kind: Kind;
  x: number;
  y: number;
  /** Rotation about z (a plank stood on end, say). */
  rz?: number;
}

interface Block {
  kind: Kind;
  index: number;
  body: RAPIER.RigidBody;
}

const LOCKED_T: [boolean, boolean, boolean] = [true, true, false];
const LOCKED_R: [boolean, boolean, boolean] = [false, false, true];

export class Fort {
  readonly group = new Group();
  private meshes = new Map<Kind, InstancedMesh>();
  private blocks: Block[] = [];
  king: RAPIER.RigidBody | null = null;
  private kingView: Group | null = null;
  private kingOffset = new Vector3();

  constructor(
    private world: RAPIER.World,
    private looks: Record<Kind, KindLook>,
    max = 64,
  ) {
    for (const kind of Object.keys(looks) as Kind[]) {
      const l = looks[kind];
      const geo: BufferGeometry = new RoundedBoxGeometry(l.size[0], l.size[1], l.size[2], 3, l.radius);
      const body = new InstancedMesh(geo, l.body, max);
      body.castShadow = true;
      body.receiveShadow = true;
      body.count = 0;
      body.frustumCulled = false;
      const line = new InstancedMesh(hullGeometry(geo), l.line, max);
      line.instanceMatrix = body.instanceMatrix;
      line.count = 0;
      line.frustumCulled = false;
      // ice is see-through: its hull goes after it and only where the ice did not draw (stencil)
      if (kind === 'ice') line.renderOrder = 2;
      this.group.add(body, line);
      this.meshes.set(kind, body);
      body.userData.line = line;
    }
  }

  build(specs: BlockSpec[], originX: number): void {
    for (const s of specs) {
      const l = this.looks[s.kind];
      const mesh = this.meshes.get(s.kind)!;
      const desc = RAPIER.RigidBodyDesc.dynamic()
        .setTranslation(originX + s.x, s.y, 0)
        .setRotation(new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), s.rz ?? 0))
        .setCanSleep(true);
      const body = this.world.createRigidBody(desc);
      this.world.createCollider(
        RAPIER.ColliderDesc.cuboid(l.size[0] / 2, l.size[1] / 2, l.size[2] / 2)
          .setDensity(l.density)
          .setFriction(l.friction)
          .setRestitution(0.05),
        body,
      );
      const index = mesh.count++;
      mesh.setColorAt(index, l.tint(index));
      (mesh.userData.line as InstancedMesh).count = mesh.count;
      this.blocks.push({ kind: s.kind, index, body });
    }
    for (const m of this.meshes.values()) if (m.instanceColor) m.instanceColor.needsUpdate = true;
    this.setLocked(true);
    this.sync();
  }

  /** The king on top: two balls (body and head) on one rigid body; `view` follows it. */
  addKing(view: Group, x: number, y: number): void {
    const body = this.world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(x, y, 0));
    this.world.createCollider(RAPIER.ColliderDesc.ball(0.35).setTranslation(0, 0.34, 0).setDensity(0.5).setFriction(0.9), body);
    this.world.createCollider(RAPIER.ColliderDesc.ball(0.25).setTranslation(0, 0.84, 0).setDensity(0.4).setFriction(0.9), body);
    this.king = body;
    this.kingView = view;
    this.group.add(view);
    this.setLocked(true);
    this.sync();
  }

  private bodies(): RAPIER.RigidBody[] {
    const all = this.blocks.map((b) => b.body);
    if (this.king) all.push(this.king);
    return all;
  }

  /** Locked: gameplay physics in the z = 0 plane. Unlocked: free 3D (the collapse). */
  setLocked(locked: boolean): void {
    for (const b of this.bodies()) {
      const t = locked ? LOCKED_T : [true, true, true];
      const r = locked ? LOCKED_R : [true, true, true];
      b.setEnabledTranslations(t[0], t[1], t[2], true);
      b.setEnabledRotations(r[0], r[1], r[2], true);
    }
  }

  /** Every block within `radius` of `at` gets pushed outward (a cartoon "poof" on impact). */
  burst(at: Vector3, radius: number, strength: number): void {
    for (const b of this.bodies()) {
      const p = b.translation();
      const d = new Vector3(p.x - at.x, p.y - at.y, p.z - at.z);
      const len = d.length();
      if (len > radius) continue;
      const f = strength * (1 - len / radius) * b.mass();
      d.normalize();
      // a little sideways scatter, so the fort spreads in depth as well as forwards
      d.z += (Math.random() - 0.5) * 0.9;
      d.y += 0.35;
      b.applyImpulse({ x: d.x * f, y: d.y * f, z: d.z * f }, true);
      b.applyTorqueImpulse({ x: (Math.random() - 0.5) * f * 0.3, y: (Math.random() - 0.5) * f * 0.3, z: (Math.random() - 0.5) * f * 0.3 }, true);
    }
  }

  /** Copies the bodies' poses to the meshes. */
  sync(): void {
    const m = new Matrix4();
    const q = new Quaternion();
    const p = new Vector3();
    const one = new Vector3(1, 1, 1);
    for (const b of this.blocks) {
      const t = b.body.translation();
      const r = b.body.rotation();
      m.compose(p.set(t.x, t.y, t.z), q.set(r.x, r.y, r.z, r.w), one);
      this.meshes.get(b.kind)!.setMatrixAt(b.index, m);
    }
    for (const mesh of this.meshes.values()) mesh.instanceMatrix.needsUpdate = true;
    if (this.king && this.kingView) {
      const t = this.king.translation();
      const r = this.king.rotation();
      this.kingView.position.set(t.x, t.y, t.z).add(this.kingOffset);
      this.kingView.quaternion.set(r.x, r.y, r.z, r.w);
    }
  }

  /** The centre of the blocks still standing near the fort (where the camera looks). */
  centre(): Vector3 {
    const c = new Vector3();
    for (const b of this.blocks) {
      const t = b.body.translation();
      c.x += t.x;
      c.y += t.y;
      c.z += t.z;
    }
    return c.multiplyScalar(1 / Math.max(1, this.blocks.length));
  }

  dispose(scene: Scene): void {
    for (const b of this.bodies()) this.world.removeRigidBody(b);
    this.blocks = [];
    this.king = null;
    for (const m of this.meshes.values()) {
      m.count = 0;
      (m.userData.line as InstancedMesh).count = 0;
    }
    if (this.kingView) this.group.remove(this.kingView);
    this.kingView = null;
    scene.remove(this.group);
  }
}

/** Block sizes (w, h, d). One size per kind: each kind is a single instanced geometry. */
export const SIZES: Record<Kind, [number, number, number]> = {
  snow: [1.0, 0.6, 1.0],
  ice: [0.62, 0.6, 0.92],
  wood: [2.4, 0.18, 1.0],
};

/** The sample fort, relative to its centre; the attacker is on the left (-x). */
export function sampleFort(): BlockSpec[] {
  const H = 0.6 + 0.002; // a row of snow or ice, with a hair of air so nothing starts overlapping
  const W = 0.18 + 0.002;
  const s: BlockSpec[] = [];
  const row = (y: number, items: [Kind, number][]) => {
    for (const [kind, x] of items) s.push({ kind, x, y: y + SIZES[kind][1] / 2 + 0.001 });
  };
  row(0, [['snow', -2.95], ['snow', -1.6], ['snow', -0.53], ['snow', 0.53], ['snow', 1.6]]);
  row(H, [['ice', -1.6], ['snow', -0.53], ['snow', 0.53], ['ice', 1.6]]);
  row(2 * H, [['wood', 0], ['ice', -1.6], ['ice', 1.6]]);
  row(2 * H + W, [['snow', -0.6], ['snow', 0.6]]);
  row(3 * H + W, [['wood', 0]]);
  return s;
}

/** Where the king stands on the sample fort (relative to its centre). */
export const KING_Y = 3 * (0.6 + 0.002) + 2 * (0.18 + 0.002) + 0.005;
