import { BufferGeometry, Euler, Group, Matrix4, Mesh, Quaternion, Vector3, type Material } from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { hullGeometry, paint } from './toon';

// Primitive-built models: many small shapes, each painted one colour, merged into one
// vertex-coloured body and one hull, so a whole character or prop is two draw calls.

export interface Place {
  at?: [number, number, number];
  rot?: [number, number, number];
  scale?: number | [number, number, number];
  /** Leave the shape out of the hull (eyes, buttons: small details inside the silhouette). */
  noLine?: boolean;
}

export class Kit {
  private body: BufferGeometry[] = [];
  private hull: BufferGeometry[] = [];

  add(g: BufferGeometry, color: number, p: Place = {}): this {
    const m = new Matrix4().compose(
      new Vector3(...(p.at ?? [0, 0, 0])),
      new Quaternion().setFromEuler(new Euler(...(p.rot ?? [0, 0, 0]))),
      typeof p.scale === 'number' ? new Vector3(p.scale, p.scale, p.scale) : new Vector3(...(p.scale ?? [1, 1, 1])),
    );
    const b = new BufferGeometry();
    b.setAttribute('position', g.getAttribute('position'));
    b.setAttribute('normal', g.getAttribute('normal'));
    if (g.index) b.setIndex(g.index);
    const body = (b.index ? b.toNonIndexed() : b.clone()).applyMatrix4(m);
    this.body.push(paint(body, color));
    if (!p.noLine) this.hull.push(hullGeometry(g).applyMatrix4(m).toNonIndexed());
    g.dispose();
    return this;
  }

  /** The body and its hull as two meshes in one group. */
  build(body: Material, line: Material, shadows = true): Group {
    const group = new Group();
    const b = new Mesh(mergeGeometries(this.body), body);
    b.castShadow = shadows;
    b.receiveShadow = true;
    group.add(b);
    if (this.hull.length) group.add(new Mesh(mergeGeometries(this.hull), line));
    return group;
  }

  bodyGeometry(): BufferGeometry {
    return mergeGeometries(this.body);
  }

  hullGeometry(): BufferGeometry | null {
    return this.hull.length ? mergeGeometries(this.hull) : null;
  }
}
