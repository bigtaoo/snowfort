import {
  BackSide,
  BoxGeometry,
  BufferGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  Float32BufferAttribute,
  Group,
  Mesh,
  NormalBlending,
  PlaneGeometry,
  Points,
  ShaderMaterial,
  SphereGeometry,
  type Material,
} from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { ARENA } from '../config';
import { Kit } from './kit';
import { snowTexture } from './textures';
import { toonMaterial } from './toon';

// The backyard: sky, snowy ground, a picket fence, pines, snow piles and far hills. Every static
// prop is merged into one vertex-coloured body and one hull (two draw calls). The play strip
// (|z| < 3 around the forts) is left flat and clear; the falling snow stays behind it.
// Adapted from lookdev/src/scenery.ts: the yard now has the game's ravine between the forts.

export const SKY_TOP = 0x6fb9ec;
export const SKY_HORIZON = 0xe4f3fb;

export function sky(): Mesh {
  const m = new ShaderMaterial({
    side: BackSide,
    depthWrite: false,
    fog: false,
    uniforms: { top: { value: new Color(SKY_TOP) }, horizon: { value: new Color(SKY_HORIZON) } },
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main() {
        vDir = normalize( position );
        gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 top;
      uniform vec3 horizon;
      varying vec3 vDir;
      void main() {
        float h = clamp( vDir.y, 0.0, 1.0 );
        vec3 c = mix( horizon, top, smoothstep( 0.0, 0.45, h ) );
        // a pale band of warm light low on the sky
        c = mix( c, vec3( 1.0, 0.95, 0.86 ), ( 1.0 - smoothstep( 0.0, 0.12, abs( vDir.y - 0.03 ) ) ) * 0.35 );
        gl_FragColor = vec4( c, 1.0 );
        #include <colorspace_fragment>
      }`,
  });
  const s = new Mesh(new SphereGeometry(400, 32, 16), m);
  s.renderOrder = -10;
  return s;
}

/** The ravine between the plateaus starts just behind the play strip; the plateaus end in cliffs a
 * little in front of it, above a lower snowfield where the ravine's frozen creek runs on towards
 * the camera. Seen from the side this is the two hills and the gap between them. */
const RAVINE_BACK = -ARENA.depth / 2;
export const CLIFF_Z = ARENA.depth / 2 + 1;
const TILE = 3.6;

/** Height of the snow on the plateaus: flat on the play strip, soft drifts rising towards the
 * back, flattened at the ravine's rim so the cliff tops stay level with the plateaus. */
function drift(x: number, z: number): number {
  const away = Math.min(1, Math.max(0, (-z - 3.5) / 8));
  const back = Math.min(1, Math.max(0, (-z - 3.5) / 30));
  const h = away * (0.35 * Math.sin(x * 0.35 + z * 0.2) * Math.cos(z * 0.31) + 0.25 * Math.sin(x * 0.9 - z * 0.6) + 0.3) + back * 2.5;
  const dx = Math.max(0, Math.abs(x) - ARENA.edgeX);
  const dz = Math.max(0, RAVINE_BACK - z);
  const rim = Math.min(1, Math.hypot(dx, dz) / 3);
  return h * rim * rim * (3 - 2 * rim);
}

/** Height of the lower snowfield in front of the cliffs: flat at their foot, drifting further out. */
function low(x: number, z: number): number {
  const away = Math.min(1, Math.max(0, (z - CLIFF_Z - 3) / 8));
  const creek = Math.min(1, Math.max(0, (Math.abs(x) - ARENA.edgeX) / 3));
  return ARENA.ravineY + away * creek * (0.5 * Math.sin(x * 0.3 + z * 0.25) + 0.6);
}

/** The ground's height anywhere in the yard. */
function heightAt(x: number, z: number): number {
  if (z > CLIFF_Z || (Math.abs(x) < ARENA.edgeX && z > RAVINE_BACK)) return low(x, z);
  return drift(x, z);
}

function patch(x0: number, x1: number, z0: number, z1: number, h: (x: number, z: number) => number): BufferGeometry {
  const g = new PlaneGeometry(x1 - x0, z1 - z0, Math.max(1, Math.round((x1 - x0) / 2)), Math.max(1, Math.round((z1 - z0) / 2)));
  g.rotateX(-Math.PI / 2);
  g.translate((x0 + x1) / 2, 0, (z0 + z1) / 2);
  const p = g.getAttribute('position');
  const uv = g.getAttribute('uv');
  for (let i = 0; i < p.count; i++) {
    p.setY(i, h(p.getX(i), p.getZ(i)));
    // world-space UVs, so the snow texture tiles evenly across every patch
    uv.setXY(i, p.getX(i) / TILE, p.getZ(i) / TILE);
  }
  return g;
}

/** The snowy yard: two plateaus, the ground behind the ravine's head and the lower field in front. */
export function ground(material: Material): Mesh {
  const e = ARENA.edgeX;
  const g = mergeGeometries([
    patch(-110, -e, -80, CLIFF_Z, drift),
    patch(e, 110, -80, CLIFF_Z, drift),
    patch(-e, e, -80, RAVINE_BACK, drift),
    patch(-110, -e, CLIFF_Z, 90, low),
    patch(e, 110, CLIFF_Z, 90, low),
  ]);
  g.computeVertexNormals();
  const m = new Mesh(g, material);
  m.receiveShadow = true;
  return m;
}

/** The cliffs: the ravine's two faces and its head, the plateaus' fronts, and the frozen creek. */
const CLIFF_TOP = new Color(0xb4cce4);
const CLIFF_DEEP = new Color(0x48648c);

/** A cliff block shaded from pale ice at the rim to deep blue at the foot (for a vertex-coloured material). */
function cliffBox(w: number, h: number, d: number): BoxGeometry {
  const g = new BoxGeometry(w, h, d);
  const pos = g.attributes.position;
  const colors: number[] = [];
  const c = new Color();
  for (let i = 0; i < pos.count; i++) {
    c.copy(CLIFF_DEEP).lerp(CLIFF_TOP, pos.getY(i) / h + 0.5);
    colors.push(c.r, c.g, c.b);
  }
  g.setAttribute('color', new Float32BufferAttribute(colors, 3));
  return g;
}

export function ravine(wall: Material, floor: Material, snow: Material): Group {
  const e = ARENA.edgeX;
  const h = ARENA.groundY - ARENA.ravineY;
  const y = ARENA.ravineY + h / 2 - 0.01;
  const group = new Group();
  const add = (geo: BufferGeometry, mat: Material, x: number, y: number, z: number) => {
    const m = new Mesh(geo, mat);
    m.position.set(x, y, z);
    m.receiveShadow = true;
    group.add(m);
  };
  const len = CLIFF_Z - RAVINE_BACK;
  for (const sign of [-1, 1]) {
    add(cliffBox(1, h, len), wall, sign * (e + 0.5), y, RAVINE_BACK + len / 2);
    add(cliffBox(110 - e, h, 1), wall, sign * (110 + e) / 2, y, CLIFF_Z - 0.5);
    // a lip of overhanging snow along every rim, so the edge reads as a drop
    add(new RoundedBoxGeometry(0.5, 0.3, len + 0.4, 2, 0.12), snow, sign * (e + 0.1), -0.05, RAVINE_BACK + len / 2);
    add(new RoundedBoxGeometry(110 - e, 0.3, 0.5, 2, 0.12), snow, sign * (110 + e) / 2, -0.05, CLIFF_Z - 0.1);
  }
  add(cliffBox(e * 2, h, 1), wall, 0, y, RAVINE_BACK - 0.5);
  add(new RoundedBoxGeometry(e * 2, 0.3, 0.5, 2, 0.12), snow, 0, -0.05, RAVINE_BACK - 0.1);
  // a snowy ravine floor with a narrow frozen creek down its middle
  const creek = 90 - RAVINE_BACK;
  const bed = new PlaneGeometry(e * 2, creek);
  bed.rotateX(-Math.PI / 2);
  add(bed, snow, 0, ARENA.ravineY + 0.01, RAVINE_BACK + creek / 2);
  const ice = new PlaneGeometry(e * 0.7, creek);
  ice.rotateX(-Math.PI / 2);
  add(ice, floor, 0, ARENA.ravineY + 0.03, RAVINE_BACK + creek / 2);
  return group;
}

const WHITE = 0xf6faff;
const PINE = 0x2f8a63;
const PINE_DARK = 0x23704f;
const BARK = 0x7a4a26;
const FENCE = 0xbf8550;

function pine(k: Kit, x: number, z: number, size: number): void {
  const y = heightAt(x, z) - 0.1;
  k.add(new CylinderGeometry(0.12 * size, 0.16 * size, 0.7 * size, 8), BARK, { at: [x, y + 0.35 * size, z] });
  const tiers = 3;
  for (let i = 0; i < tiers; i++) {
    const r = (1.1 - i * 0.28) * size;
    const h = (1.25 - i * 0.2) * size;
    const ty = y + (0.55 + i * 0.75) * size;
    k.add(new ConeGeometry(r, h, 10), i % 2 ? PINE : PINE_DARK, { at: [x, ty + h / 2, z] });
    // snow on each tier: a shorter white cone over the tier's top
    k.add(new ConeGeometry(r * 0.62, h * 0.5, 10), WHITE, { at: [x, ty + h * 0.75 + 0.02 * size, z], noLine: true });
  }
}

function fence(k: Kit, x0: number, x1: number, z: number): void {
  const step = 0.55;
  for (let x = x0; x <= x1 + 1e-6; x += step) {
    const y = drift(x, z);
    k.add(new RoundedBoxGeometry(0.16, 1.1, 0.07, 2, 0.02), FENCE, { at: [x, y + 0.45, z] });
    k.add(new ConeGeometry(0.115, 0.16, 4), FENCE, { at: [x, y + 1.08, z], rot: [0, Math.PI / 4, 0], scale: [1, 1, 0.45] });
    k.add(new SphereGeometry(0.1, 8, 5), WHITE, { at: [x, y + 1.16, z], scale: [1, 0.5, 0.6], noLine: true });
  }
  const len = x1 - x0 + 0.3;
  const mid = (x0 + x1) / 2;
  const y = drift(mid, z);
  for (const ry of [0.25, 0.75]) {
    k.add(new RoundedBoxGeometry(len, 0.1, 0.05, 2, 0.02), FENCE, { at: [mid, y + ry, z - 0.06] });
    k.add(new RoundedBoxGeometry(len, 0.05, 0.07, 2, 0.02), WHITE, { at: [mid, y + ry + 0.07, z - 0.06], noLine: true });
  }
}

function pile(k: Kit, x: number, z: number, size: number): void {
  const y = heightAt(x, z);
  k.add(new SphereGeometry(size, 14, 8), WHITE, { at: [x, y, z], scale: [1.6, 0.6, 1] });
  k.add(new SphereGeometry(size * 0.6, 12, 8), WHITE, { at: [x + size * 0.7, y, z + size * 0.2], scale: [1.4, 0.7, 1] });
}

/** A little house with a snowy roof: the backdrop when the replay camera looks back at the yard. */
function house(k: Kit, x: number, z: number, wall: number, ry: number): void {
  const y = heightAt(x, z);
  const rot: [number, number, number] = [0, ry, 0];
  const at = (dx: number, dy: number, dz: number): [number, number, number] => [
    x + dx * Math.cos(ry) + dz * Math.sin(ry),
    y + dy,
    z - dx * Math.sin(ry) + dz * Math.cos(ry),
  ];
  k.add(new BoxGeometry(6, 3.2, 4.5), wall, { at: at(0, 1.6, 0), rot });
  // the roof: a triangular prism (a 3-sided cylinder on its side), then a snow layer on top
  k.add(new CylinderGeometry(2.9, 2.9, 6.6, 3), 0x9a4b3c, { at: at(0, 3.2 + 1.2, 0), rot: [0, ry, Math.PI / 2], scale: [1, 1, 0.95] });
  k.add(new CylinderGeometry(2.95, 2.95, 6.7, 3), WHITE, { at: at(0, 3.2 + 1.32, 0), rot: [0, ry, Math.PI / 2], scale: [0.9, 1, 0.9], noLine: true });
  k.add(new BoxGeometry(1.1, 2, 0.12), 0x6b3f24, { at: at(-1.5, 1, -2.28), rot });
  for (const wx of [0.6, 2.0]) {
    k.add(new BoxGeometry(1.0, 0.9, 0.1), 0xffe39a, { at: at(wx, 1.9, -2.28), rot });
    k.add(new BoxGeometry(1.2, 0.12, 0.25), WHITE, { at: at(wx, 1.4, -2.3), rot, noLine: true });
  }
  k.add(new BoxGeometry(0.6, 1.4, 0.6), 0x8c5a48, { at: at(1.8, 5.0, 0.8), rot });
  k.add(new BoxGeometry(0.7, 0.18, 0.7), WHITE, { at: at(1.8, 5.75, 0.8), rot, noLine: true });
}

export function props(body: Material, line: Material): Group {
  const k = new Kit();
  fence(k, -20, -ARENA.edgeX - 0.6, -5.5);
  fence(k, ARENA.edgeX + 0.6, 20, -5.5);
  // pines in clumps well behind the fence (kept low in the frame so the fight reads first), a couple further out to the sides; the space behind the
  // right-hand fort is left open for the replay camera, which swings round behind it
  const pines: [number, number, number][] = [
    [-14, -16, 1.4], [-11, -19, 1.7], [-8, -15, 1.1], [-4.5, -22, 1.9], [-1.5, -18, 1.3], [2, -24, 2.1],
    [13.5, -20, 2.0], [-18, -26, 2.3], [18, -27, 2.4], [3, -34, 2.6], [11, -32, 2.8],
    [-7, -29, 2.3], [7, -28, 2.4], [-13.6, -4, 1.3], [14, -3.5, 1.4],
  ];
  // the near side of the yard (behind the side-view camera, seen only when the replay turns round)
  pines.push([-20, 30, 2.6], [-9, 36, 2.9], [7, 40, 3.2], [20, 32, 2.8], [26, 40, 3.0], [-26, 38, 3.1], [11, 46, 3.4]);
  for (const [x, z, s] of pines) pine(k, x, z, s);
  house(k, -11, 30, 0xf2c46b, 0.15);
  house(k, 15, 34, 0x9cc7e6, -0.2);
  const piles: [number, number, number][] = [
    [-11, -4.2, 0.6], [-6.5, -4.4, 0.45], [-2.6, -5.0, 0.7], [2.8, -5.0, 0.5], [9.5, -4.4, 0.65], [12, -4.3, 0.5],
    [-14, 14, 0.8], [14.5, 15, 0.9], [-9, 18, 1.0], [10, 19, 1.1],
  ];
  for (const [x, z, s] of piles) pile(k, x, z, s);
  // far hills: big soft mounds, no outline (the fog does their edge)
  const hills: [number, number, number, number][] = [
    [-60, -90, 40, 9], [-10, -110, 50, 12], [45, -95, 42, 10], [90, -120, 55, 14], [-100, -120, 50, 13],
    [-40, 95, 45, 11], [30, 110, 50, 13], [90, 90, 40, 10],
  ];
  for (const [x, z, r, h] of hills) k.add(new SphereGeometry(r, 24, 10, 0, Math.PI * 2, 0, Math.PI / 2), 0xe9f3fc, { at: [x, z > 0 ? ARENA.ravineY - 1 : -1, z], scale: [1, h / r, 0.6], noLine: true });
  return k.build(body, line);
}

/** Falling snow behind the play area: one draw of points, moved in the vertex shader. */
export function snowfall(count = 900): Points {
  const g = new BufferGeometry();
  const p = new Float32Array(count * 3);
  const r = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    p[i * 3] = (Math.random() - 0.5) * 70;
    p[i * 3 + 1] = Math.random() * 22;
    p[i * 3 + 2] = -4 - Math.random() * 34;
    r[i] = Math.random();
  }
  g.setAttribute('position', new Float32BufferAttribute(p, 3));
  g.setAttribute('seed', new Float32BufferAttribute(r, 1));
  const m = new ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: NormalBlending,
    uniforms: { time: { value: 0 }, scale: { value: 600 } },
    vertexShader: /* glsl */ `
      attribute float seed;
      uniform float time;
      uniform float scale;
      varying float vA;
      void main() {
        vec3 p = position;
        float speed = 0.6 + seed * 0.7;
        p.y = mod( p.y - time * speed, 22.0 );
        p.x += sin( time * ( 0.5 + seed ) + seed * 40.0 ) * 0.4;
        vec4 mv = modelViewMatrix * vec4( p, 1.0 );
        gl_PointSize = ( 0.05 + seed * 0.07 ) * scale / -mv.z;
        vA = 0.65 + 0.35 * seed;
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `
      varying float vA;
      void main() {
        float d = length( gl_PointCoord - 0.5 );
        if ( d > 0.5 ) discard;
        gl_FragColor = vec4( 1.0, 1.0, 1.0, vA * smoothstep( 0.5, 0.25, d ) );
      }`,
  });
  const pts = new Points(g, m);
  pts.frustumCulled = false;
  return pts;
}

export function groundMaterial(): Material {
  // the snow block texture, tiled every few metres, so the open ground is not a blank sheet
  const map = snowTexture();
  return toonMaterial({ color: 0xf3f8ff, map });
}

