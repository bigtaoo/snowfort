import { IcosahedronGeometry, InstancedMesh, Matrix4, Quaternion, Vector3, type Material } from 'three';

// A burst of snow chunks where the snowball lands: one instanced mesh, moved on the CPU in
// simulation time (so it slows down with the slow motion).

interface Chunk {
  p: Vector3;
  v: Vector3;
  life: number;
  size: number;
}

export class Puff {
  readonly mesh: InstancedMesh;
  private chunks: Chunk[] = [];

  constructor(material: Material, private max = 80) {
    this.mesh = new InstancedMesh(new IcosahedronGeometry(1, 0), material, max);
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = true;
  }

  burst(at: Vector3, n = 60): void {
    for (let i = 0; i < n && this.chunks.length < this.max; i++) {
      const v = new Vector3(Math.random() - 0.6, Math.random() * 0.9 + 0.2, Math.random() - 0.5).normalize().multiplyScalar(2 + Math.random() * 5);
      this.chunks.push({ p: at.clone(), v, life: 1.2 + Math.random() * 1.2, size: 0.04 + Math.random() * 0.09 });
    }
  }

  clear(): void {
    this.chunks = [];
    this.mesh.count = 0;
  }

  update(dt: number): void {
    const m = new Matrix4();
    const q = new Quaternion();
    const s = new Vector3();
    this.chunks = this.chunks.filter((c) => (c.life -= dt) > 0);
    this.chunks.forEach((c, i) => {
      c.v.y -= 9.8 * dt;
      c.p.addScaledVector(c.v, dt);
      if (c.p.y < c.size * 0.5) {
        c.p.y = c.size * 0.5;
        c.v.set(c.v.x * 0.3, Math.abs(c.v.y) * 0.15, c.v.z * 0.3);
      }
      const k = Math.min(1, c.life * 2);
      m.compose(c.p, q.set(i * 0.37, i * 0.11, 0, 1).normalize(), s.setScalar(c.size * k));
      this.mesh.setMatrixAt(i, m);
    });
    this.mesh.count = this.chunks.length;
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}
