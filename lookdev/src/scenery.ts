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
import { Kit } from './kit';
import { snowTexture } from './textures';
import { toonMaterial } from './toon';

// The backyard: sky, snowy ground, a picket fence, pines, snow piles and far hills. Every static
// prop is merged into one vertex-coloured body and one hull (two draw calls). The play strip
// (|z| < 3 around the forts) is left flat and clear; the falling snow stays behind it.

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

/** Height of the snow away from the play strip: soft drifts, rising towards the back. */
function drift(x: number, z: number): number {
  const away = Math.min(1, Math.max(0, (Math.abs(z) - 3.5) / 8));
  const back = z < 0 ? Math.min(1, (-z - 3.5) / 30) : 0;
  return away * (0.35 * Math.sin(x * 0.35 + z * 0.2) * Math.cos(z * 0.31) + 0.25 * Math.sin(x * 0.9 - z * 0.6) + 0.3) + back * 2.5;
}

export function ground(material: Material): Mesh {
  const g = new PlaneGeometry(220, 160, 110, 80);
  g.rotateX(-Math.PI / 2);
  const p = g.getAttribute('position');
  for (let i = 0; i < p.count; i++) p.setY(i, drift(p.getX(i), p.getZ(i)));
  g.computeVertexNormals();
  const m = new Mesh(g, material);
  m.receiveShadow = true;
  return m;
}

const WHITE = 0xf6faff;
const PINE = 0x2f8a63;
const PINE_DARK = 0x23704f;
const BARK = 0x7a4a26;
const FENCE = 0xbf8550;

function pine(k: Kit, x: number, z: number, size: number): void {
  const y = drift(x, z) - 0.1;
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
  const y = drift(x, z);
  k.add(new SphereGeometry(size, 14, 8), WHITE, { at: [x, y, z], scale: [1.6, 0.6, 1] });
  k.add(new SphereGeometry(size * 0.6, 12, 8), WHITE, { at: [x + size * 0.7, y, z + size * 0.2], scale: [1.4, 0.7, 1] });
}

/** A little house with a snowy roof: the backdrop when the replay camera looks back at the yard. */
function house(k: Kit, x: number, z: number, wall: number, ry: number): void {
  const y = drift(x, z);
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
  fence(k, -16, -3.5, -5.5);
  fence(k, 3.5, 16, -5.5);
  // pines in clumps behind the fence, a couple further out to the sides; the space behind the
  // right-hand fort is left open for the replay camera, which swings round behind it
  const pines: [number, number, number][] = [
    [-13, -8, 1.5], [-10.5, -9.5, 1.9], [-8, -7.5, 1.2], [-4.5, -11, 2.2], [-1.5, -9, 1.4], [1.8, -12, 2.4],
    [13.5, -11, 2.3], [-17, -14, 2.6], [17, -15, 2.8], [3, -21, 3.0], [10.5, -20, 3.2],
    [-7, -16, 2.6], [6.5, -17, 2.8], [-15.5, -4, 1.3], [16, -3.5, 1.4],
  ];
  // the near side of the yard (behind the side-view camera, seen only when the replay turns round)
  pines.push([-20, 30, 2.6], [-9, 36, 2.9], [3, 40, 3.2], [20, 32, 2.8], [26, 40, 3.0], [-26, 38, 3.1], [9, 46, 3.4]);
  for (const [x, z, s] of pines) pine(k, x, z, s);
  house(k, -3, 30, 0xf2c46b, 0.15);
  house(k, 13, 34, 0x9cc7e6, -0.2);
  const piles: [number, number, number][] = [
    [-11, -4.2, 0.6], [-6.5, -4.4, 0.45], [-1.5, -4.6, 0.7], [2.8, -4.3, 0.5], [9.5, -4.4, 0.65], [13.5, -4.3, 0.5],
    [-14, 5, 0.8], [14.5, 5.5, 0.9], [-12, 9, 1.0], [-6, 11, 0.9], [11, 10.5, 1.1],
  ];
  for (const [x, z, s] of piles) pile(k, x, z, s);
  // far hills: big soft mounds, no outline (the fog does their edge)
  const hills: [number, number, number, number][] = [
    [-60, -90, 40, 9], [-10, -110, 50, 12], [45, -95, 42, 10], [90, -120, 55, 14], [-100, -120, 50, 13],
    [-40, 95, 45, 11], [30, 110, 50, 13], [90, 90, 40, 10],
  ];
  for (const [x, z, r, h] of hills) k.add(new SphereGeometry(r, 24, 10, 0, Math.PI * 2, 0, Math.PI / 2), 0xe9f3fc, { at: [x, -1, z], scale: [1, h / r, 0.6], noLine: true });
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
  map.repeat.set(60, 44);
  return toonMaterial({ color: 0xf3f8ff, map });
}

