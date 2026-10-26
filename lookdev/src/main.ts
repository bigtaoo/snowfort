import RAPIER from '@dimforge/rapier3d-compat';
import {
  AlwaysStencilFunc,
  Color,
  DirectionalLight,
  Fog,

  HemisphereLight,
  IcosahedronGeometry,
  NotEqualStencilFunc,
  PCFShadowMap,
  PerspectiveCamera,
  ReplaceStencilOp,
  Scene,
  SRGBColorSpace,
  Vector3,
  WebGLRenderer,
  type InstancedMesh,
  type Mesh,
} from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

import { Fort, KING_Y, SIZES, sampleFort, type Kind, type KindLook } from './fort';
import { Kit } from './kit';
import { ARM_FIRED, ARM_REST, BALL_R, COOL, WARM, catapult, kid, snowmanKing, type Catapult } from './models';
import { Puff } from './puff';
import { SKY_HORIZON, ground, groundMaterial, props, sky, snowfall } from './scenery';
import { outlineMaterial, toonMaterial } from './toon';
import { iceTexture, snowTexture, woodTexture } from './textures';

await RAPIER.init();

// ---------------------------------------------------------------- renderer, scene, camera

const renderer = new WebGLRenderer({ antialias: true, stencil: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.outputColorSpace = SRGBColorSpace;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = PCFShadowMap;
document.body.prepend(renderer.domElement);

const scene = new Scene();
scene.background = new Color(SKY_HORIZON);
scene.fog = new Fog(SKY_HORIZON, 45, 160);

const camera = new PerspectiveCamera(30, window.innerWidth / window.innerHeight, 0.1, 900);
const SIDE_TARGET = new Vector3(1.6, 2.4, 0);
const SIDE_POS = new Vector3(1.6, 2.0, 23);
camera.position.copy(SIDE_POS);
const controls = new OrbitControls(camera, renderer.domElement);
controls.target.copy(SIDE_TARGET);
controls.enableDamping = true;
controls.maxPolarAngle = Math.PI * 0.53;
controls.minDistance = 3;
controls.maxDistance = 60;

// one sun with one hard shadow; the sky-blue hemisphere tints the shade instead of greying it
const sun = new DirectionalLight(0xfff4e0, 2.6);
sun.position.set(-9, 16, 12);
sun.target.position.set(1.5, 0, 0);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.camera.left = -16;
sun.shadow.camera.right = 16;
sun.shadow.camera.top = 12;
sun.shadow.camera.bottom = -10;
sun.shadow.camera.near = 1;
sun.shadow.camera.far = 60;
sun.shadow.bias = -0.0004;
sun.shadow.normalBias = 0.03;
scene.add(sun, sun.target, new HemisphereLight(0xc4def7, 0xffffff, 1.35));

// ---------------------------------------------------------------- materials

const charBody = toonMaterial({ vertexColors: true });
const charLine = outlineMaterial(0.032);
const propLine = outlineMaterial(0.05);

const snowMat = toonMaterial({ map: snowTexture() });
const iceMat = toonMaterial({ map: iceTexture(), glint: true, opacity: 0.72 });
const woodMat = toonMaterial({ map: woodTexture() });
const blockLine = outlineMaterial(0.04);
const iceLine = outlineMaterial(0.04);
// ice is see-through: it marks the stencil where it draws, and its hull is drawn only outside
// that, so the dark back of the hull never shows through the ice
iceMat.stencilWrite = true;
iceMat.stencilRef = 1;
iceMat.stencilFunc = AlwaysStencilFunc;
iceMat.stencilZPass = ReplaceStencilOp;
iceLine.stencilWrite = true;
iceLine.stencilRef = 1;
iceLine.stencilFunc = NotEqualStencilFunc;
iceLine.transparent = true;

const jitter = (base: number, spread: number, seed: number) => {
  const c = new Color(base);
  const t = Math.sin(seed * 12.9898) * 43758.5453;
  const f = (t - Math.floor(t) - 0.5) * spread;
  return c.offsetHSL(0, 0, f);
};
const looks: Record<Kind, KindLook> = {
  snow: { size: SIZES.snow, radius: 0.12, body: snowMat, line: blockLine, density: 0.6, friction: 0.9, tint: (i) => jitter(0xffffff, 0.06, i + 1) },
  ice: { size: SIZES.ice, radius: 0.05, body: iceMat, line: iceLine, density: 0.9, friction: 0.08, tint: (i) => jitter(0xe8fbff, 0.08, i + 7) },
  wood: { size: SIZES.wood, radius: 0.04, body: woodMat, line: blockLine, density: 0.7, friction: 0.6, tint: (i) => jitter(0xffffff, 0.08, i + 3) },
};

// ---------------------------------------------------------------- the backyard

scene.add(sky());
scene.add(ground(groundMaterial()));
scene.add(props(charBody, propLine));
const flakes = snowfall();
scene.add(flakes);

const FX = 4.6; // the sample fort's centre
const ATTACK_X = -5.0; // the left catapult

const warmKid = kid(WARM, charBody, charLine);
warmKid.position.set(-7.0, 0, 0.35);
warmKid.rotation.y = 0.55;
const coolKid = kid(COOL, charBody, charLine);
coolKid.position.set(10.4, 0, 0.35);
coolKid.rotation.y = -0.55;
scene.add(warmKid, coolKid);

const left: Catapult = catapult(charBody, charLine);
left.group.position.set(ATTACK_X, 0, 0);
const right: Catapult = catapult(charBody, charLine);
right.group.position.set(8.7, 0, 0);
right.group.rotation.y = Math.PI;
scene.add(left.group, right.group);

const puff = new Puff(snowMat);
scene.add(puff.mesh);

// the flying snowball
const shot = (() => {
  const k = new Kit();
  k.add(new IcosahedronGeometry(BALL_R, 2), 0xf6faff);
  const g = k.build(charBody, charLine);
  g.visible = false;
  scene.add(g);
  return g;
})();

// ---------------------------------------------------------------- physics

const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
world.createCollider(RAPIER.ColliderDesc.cuboid(100, 1, 100).setTranslation(0, -1, 0).setFriction(0.9));
let fort: Fort;
let ball: RAPIER.RigidBody | null = null;
let ballCollider: RAPIER.Collider | null = null;

function buildFort(): void {
  fort = new Fort(world, looks);
  fort.build(sampleFort(), FX);
  fort.addKing(snowmanKing(charBody, charLine), FX, KING_Y);
  scene.add(fort.group);
  for (const m of fort.group.children) if ((m as InstancedMesh).isInstancedMesh && (m as Mesh).material === iceMat) m.renderOrder = 1;
  // let the stack settle in play mode before anyone looks at it
  world.timestep = 1 / 120;
  for (let i = 0; i < 120; i++) world.step();
  fort.sync();
}
buildFort();

// ---------------------------------------------------------------- the collapse

type State = 'idle' | 'firing' | 'flying' | 'impact';
let state: State = 'idle';
let paused = false;
let timeScale = 1;
let simTime = 0;
let stateTime = 0; // real seconds in the current state
let released = false;

const orbit = {
  on: false,
  t: 0,
  dur: 7,
  centre: new Vector3(),
  az0: 0,
  r0: 0,
  el0: 0,
};

function collapse(): void {
  if (state !== 'idle') return;
  fort.setLocked(false);
  state = 'firing';
  stateTime = 0;
  released = false;
}

function release(): void {
  released = true;
  const from = new Vector3();
  left.ball.getWorldPosition(from);
  left.ball.visible = false;
  // aim at the front of the fort, a little off the play plane so it falls in depth too
  const to = new Vector3(FX - 1.6, 1.7, 0.18);
  const t = 0.95;
  const v = to.clone().sub(from).divideScalar(t);
  v.y += 0.5 * 9.81 * t;
  ball = world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(from.x, from.y, from.z).setLinvel(v.x, v.y, v.z).setCcdEnabled(true));
  ballCollider = world.createCollider(RAPIER.ColliderDesc.ball(BALL_R).setDensity(9).setRestitution(0.1).setFriction(0.8), ball);
  shot.visible = true;
  state = 'flying';
  stateTime = 0;
}

function impact(): void {
  state = 'impact';
  stateTime = 0;
  const at = new Vector3().copy(ball!.translation() as Vector3);
  fort.burst(at, 3.4, 12);
  puff.burst(at);
  orbit.on = true;
  orbit.t = 0;
  orbit.centre.set(FX, 1.5, 0);
  const rel = camera.position.clone().sub(orbit.centre);
  orbit.r0 = rel.length();
  orbit.az0 = Math.atan2(rel.x, rel.z);
  orbit.el0 = Math.asin(rel.y / orbit.r0);
  controls.enabled = false;
}

function hitSomething(): boolean {
  if (!ball || !ballCollider) return false;
  let hit = false;
  world.contactPairsWith(ballCollider, (other) => {
    if (other.parent() !== null && other.parent()!.isDynamic()) hit = true;
  });
  return hit || ball.translation().x > FX - 1.2;
}

function reset(): void {
  if (ball) world.removeRigidBody(ball);
  ball = null;
  ballCollider = null;
  shot.visible = false;
  fort.dispose(scene);
  buildFort();
  left.arm.rotation.z = ARM_REST;
  left.ball.visible = true;
  puff.clear();
  state = 'idle';
  timeScale = 1;
  orbit.on = false;
  controls.enabled = true;
}

function sideView(): void {
  orbit.on = false;
  controls.enabled = true;
  camera.position.copy(SIDE_POS);
  controls.target.copy(SIDE_TARGET);
  controls.update();
}

const ease = (t: number) => 0.5 - 0.5 * Math.cos(Math.PI * Math.min(1, Math.max(0, t)));

/** The scripted camera: half a turn round the fort, closing in and rising, then settling lower. */
function orbitCamera(dt: number): void {
  if (!orbit.on) return;
  orbit.t += dt;
  const k = ease(orbit.t / orbit.dur);
  const az = orbit.az0 + Math.PI * k;
  const r = orbit.r0 + (9.5 - orbit.r0) * ease((orbit.t / orbit.dur) * 1.6);
  const el = orbit.el0 + (0.12 - orbit.el0) * k + Math.sin(Math.PI * k) * 0.08;
  camera.position.set(
    orbit.centre.x + Math.sin(az) * Math.cos(el) * r,
    orbit.centre.y + Math.sin(el) * r,
    orbit.centre.z + Math.cos(az) * Math.cos(el) * r,
  );
  controls.target.copy(orbit.centre);
  camera.lookAt(orbit.centre);
  if (orbit.t >= orbit.dur) {
    orbit.on = false;
    controls.enabled = true;
  }
}

function stepWorld(simDt: number): void {
  if (simDt <= 0) return;
  const n = Math.max(1, Math.ceil(simDt / (1 / 120)));
  world.timestep = simDt / n;
  for (let i = 0; i < n; i++) world.step();
}

// ---------------------------------------------------------------- loop

let last = performance.now();
let fpsFrames = 0;
let fpsTime = 0;
const statsEl = document.getElementById('stats')!;
const stats = { fps: 0, calls: 0, triangles: 0, frameMs: 0 };
(window as unknown as { lookdev: unknown }).lookdev = { stats, advance, snapshot, collapse, reset, sideView, pause: () => togglePause(), renderer, camera, scene };

function frame(now: number, manual = false): void {
  const real = Math.max(0, (now - last) / 1000);
  if (!manual && now < last) return void requestAnimationFrame((t) => frame(t));
  const dt = Math.min(0.05, real);
  last = now;
  stateTime += dt;

  if (!paused) {
    if (state === 'firing') {
      // the arm whips over in a quarter second, letting go of the ball on the way up
      const k = Math.min(1, stateTime / 0.26);
      left.arm.rotation.z = ARM_REST + (ARM_FIRED - ARM_REST) * k * k;
      if (!released && left.arm.rotation.z < -1.7) release();
    }
    if (state === 'flying' && hitSomething()) impact();
    if (state === 'impact') {
      // slow down hard at the hit, hold, then come back to speed
      const target = stateTime < 5 ? 0.3 : 1;
      timeScale += (target - timeScale) * Math.min(1, dt * (target < timeScale ? 18 : 1.2));
    }
    const simDt = dt * timeScale;
    simTime += simDt;
    stepWorld(simDt);
    puff.update(simDt);
    orbitCamera(dt);
  }

  fort.sync();
  if (ball) {
    const t = ball.translation();
    const r = ball.rotation();
    shot.position.set(t.x, t.y, t.z);
    shot.quaternion.set(r.x, r.y, r.z, r.w);
  }
  (flakes.material as unknown as { uniforms: { time: { value: number } } }).uniforms.time.value = simTime;

  if (controls.enabled) controls.update();
  const t0 = performance.now();
  renderer.render(scene, camera);
  stats.frameMs = performance.now() - t0;

  fpsFrames++;
  fpsTime += real;
  if (fpsTime >= 0.5) {
    stats.fps = Math.round(fpsFrames / fpsTime);
    stats.calls = renderer.info.render.calls;
    stats.triangles = renderer.info.render.triangles;
    statsEl.textContent = `${stats.fps} fps\n${stats.calls} draw calls\n${(stats.triangles / 1000).toFixed(1)}k triangles\n${state}${paused ? ' (paused)' : ''} ×${timeScale.toFixed(2)}`;
    fpsFrames = 0;
    fpsTime = 0;
  }
  if (!manual) requestAnimationFrame((t) => frame(t));
}
requestAnimationFrame((t) => frame(t));

/** Saves the next frame as shots/<name>.png (dev server only). */
async function snapshot(name: string): Promise<string> {
  frame(last + 1000 / 60, true);
  const url = renderer.domElement.toDataURL('image/png');
  return (await fetch(`/__shot?name=${name}`, { method: 'POST', body: url })).text();
}

/** Runs `seconds` of 60 Hz frames right now (for screenshots when the tab is throttled). */
function advance(seconds: number): void {
  for (let i = 0; i < Math.round(seconds * 60); i++) frame(last + 1000 / 60, true);
}

// ---------------------------------------------------------------- UI

function togglePause(): void {
  paused = !paused;
  document.getElementById('pause')!.textContent = paused ? 'Play (P)' : 'Pause (P)';
  if (paused) {
    orbit.on = false;
    controls.enabled = true;
  }
}

document.getElementById('collapse')!.onclick = collapse;
document.getElementById('reset')!.onclick = reset;
document.getElementById('side')!.onclick = sideView;
document.getElementById('pause')!.onclick = togglePause;
document.getElementById('clean')!.onclick = () => document.body.classList.toggle('clean');
window.addEventListener('keydown', (e) => {
  const k = e.key.toLowerCase();
  if (k === 'c') collapse();
  else if (k === 'r') reset();
  else if (k === 'v') sideView();
  else if (k === 'p') togglePause();
  else if (k === 'h') document.body.classList.toggle('clean');
});
window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

export {};

