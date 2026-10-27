import {
  AlwaysStencilFunc,
  BoxGeometry,
  Color,
  Group,
  IcosahedronGeometry,
  Mesh,
  NotEqualStencilFunc,
  ReplaceStencilOp,
  type BufferGeometry,
  type Material,
  type MeshToonMaterial,
  type Object3D,
} from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { BLOCK_HALF_DEPTH, COLORS, PHYSICS, PIECES, type PieceId } from '../config';
import { snowmanKing } from './models';
import { iceTexture, snowTexture, woodTexture } from './textures';
import { hullGeometry, outlineMaterial, toonMaterial } from './toon';

// Toon meshes for the simulation's entities: blocks, kings, projectiles and debris. Each entity
// gets its own body material (its tint shows damage); geometry, textures and outlines are shared.

const SIDE_COLOR = [COLORS.p1, COLORS.p2];
const textures = { snow: snowTexture(), ice: iceTexture(), wood: woodTexture() };
const blockLine = outlineMaterial(0.04);
// ice is see-through: it marks the stencil where it draws, and its hull is drawn only outside
const iceLine = outlineMaterial(0.04);
iceLine.stencilWrite = true;
iceLine.stencilRef = 1;
iceLine.stencilFunc = NotEqualStencilFunc;
iceLine.transparent = true;
const ballLine = outlineMaterial(0.03);
const charBody = toonMaterial({ vertexColors: true });
const charLine = outlineMaterial(0.032);

const RADIUS = { snow: 0.12, ice: 0.05, wood: 0.04 };
const BASE = { snow: 0xffffff, ice: 0xe8fbff, wood: 0xffffff };
const SPREAD = { snow: 0.06, ice: 0.08, wood: 0.08 };
const HURT = new Color(0xff8a80);

const geoCache = new Map<string, BufferGeometry>();
const geo = (key: string, make: () => BufferGeometry) => {
  let g = geoCache.get(key);
  if (!g) geoCache.set(key, (g = make()));
  return g;
};

/** A small per-block brightness wobble so a wall of snow blocks does not read as one slab. */
function jitter(base: number, spread: number, seed: number): Color {
  const t = Math.sin(seed * 12.9898) * 43758.5453;
  return new Color(base).offsetHSL(0, 0, (t - Math.floor(t) - 0.5) * spread);
}

function withHull(g: BufferGeometry, body: Material, line: Material): Mesh {
  const m = new Mesh(g, body);
  m.castShadow = true;
  m.receiveShadow = true;
  const hull = new Mesh(geo(`hull:${g.uuid}`, () => hullGeometry(g)), line);
  m.add(hull);
  return m;
}

const SPRING = 0x8be36b;

export function blockMesh(piece: PieceId, seed: number, spring = false): Mesh {
  const spec = PIECES[piece];
  const kind = spec.material as 'snow' | 'ice' | 'wood';
  // a vertical plank is the horizontal one turned on its side, so the wood grain runs along it
  const upright = spec.hy > spec.hx && kind === 'wood';
  const [w, h] = upright ? [spec.hy, spec.hx] : [spec.hx, spec.hy];
  const g = geo(`block:${kind}:${w},${h}`, () => new RoundedBoxGeometry(w * 2, h * 2, BLOCK_HALF_DEPTH * 2, 3, RADIUS[kind]));
  const ice = kind === 'ice';
  const mat = toonMaterial({ map: textures[kind], glint: ice, opacity: ice ? 0.72 : 1 });
  if (ice) {
    mat.stencilWrite = true;
    mat.stencilRef = 1;
    mat.stencilFunc = AlwaysStencilFunc;
    mat.stencilZPass = ReplaceStencilOp;
  }
  mat.color.copy(spring ? new Color(SPRING) : jitter(BASE[kind], SPREAD[kind], seed));
  mat.userData.base = mat.color.clone();
  mat.userData.own = true;
  const body = withHull(g, mat, ice ? iceLine : blockLine);
  if (ice) body.renderOrder = 1;
  if (!upright) return body;
  const wrap = new Group();
  body.rotation.z = Math.PI / 2;
  wrap.add(body);
  wrap.userData.body = body;
  return wrap as unknown as Mesh;
}

/** Tints a block towards red as its hp runs out. */
export function hurtBlock(obj: Object3D, t: number): void {
  const body = (obj.userData.body ?? obj) as Mesh;
  const mat = body.material as MeshToonMaterial;
  mat.color.copy(mat.userData.base as Color).lerp(HURT, (1 - Math.max(0, t)) * 0.6);
}

const kings: Object3D[] = [];

/** The snowman king wearing his side's cape, feet at the bottom of his collider. Built once per side;
 *  every king after that is a clone sharing its geometry, so rebuilding kings leaks no GPU buffers. */
export function kingMesh(owner: 0 | 1): Object3D {
  kings[owner] ??= buildKing(owner);
  return kings[owner].clone();
}

function buildKing(owner: 0 | 1): Object3D {
  const wrap = new Group();
  const king = snowmanKing(SIDE_COLOR[owner], charBody, charLine);
  king.position.y = -PIECES.king.hy;
  // three-quarters towards the enemy
  king.rotation.y = owner === 0 ? 0.5 : -0.5;
  king.traverse((o) => { o.castShadow = true; });
  wrap.add(king);
  return wrap;
}

const AMMO_COLOR: Record<string, number> = { bigIce: 0x9fdcff, cocoa: 0x7a4a2a, firework: 0xffc23d, split: 0xd8f0ff, frost: 0x5fd8ff };
const ballMats = new Map<string, MeshToonMaterial>();

export function projectileMesh(ammo: string | undefined, radius: number): Mesh {
  const key = ammo ?? 'snowball';
  let mat = ballMats.get(key);
  if (!mat) ballMats.set(key, (mat = toonMaterial({ color: AMMO_COLOR[key] ?? 0xf6faff })));
  return withHull(geo(`ball:${radius}`, () => new IcosahedronGeometry(radius, 2)), mat, ballLine);
}

export function debrisMesh(color: number): Mesh {
  const s = PHYSICS.debrisSize;
  const mat = toonMaterial({ color });
  mat.userData.own = true;
  const m = new Mesh(geo('debris', () => new BoxGeometry(s, s, s)), mat);
  m.castShadow = true;
  return m;
}

/** Frees the materials an entity's mesh owns alone (blocks and debris tint their own); shared ones stay. */
export function releaseMesh(obj: Object3D): void {
  obj.traverse((o) => {
    const mat = (o as Mesh).material as Material | undefined;
    if (mat?.userData.own) mat.dispose();
  });
}
