import * as THREE from 'three';
import { ARENA, BLOCK_HALF_DEPTH, CATAPULT, COLORS, PIECES, type PieceId } from './config';
import type { Side } from './arena';
import { ARM_PIVOT, ARM_REACH, BALL_R, COOL, WARM, catapult, kid, type Catapult } from './look/models';
import { Puff } from './look/puff';
import { SKY_HORIZON, ground, groundMaterial, props, ravine, sky, snowfall } from './look/scenery';
import { outlineMaterial, toonMaterial } from './look/toon';

/** The catapult model is drawn this much bigger, so its arm's reach matches CATAPULT.barrelLength. */
const BASE_SCALE = 1.6;
const ARM_SCALE = CATAPULT.barrelLength / Math.hypot(ARM_REACH, 0.12 + BALL_R);
const AIM_DOTS = 7;
/** The ball sits above the arm's beam; tilt the arm back so the ball, not the beam, aims. */
const BALL_TILT = Math.atan2(0.12 + BALL_R, ARM_REACH);

/** Renderer, fixed side camera, the backyard and the catapults (look: lookdev/README.md). */
export class View {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(30, 16 / 9, 0.5, 900);
  readonly puff: Puff;
  private catapults: Catapult[] = [];
  private powerBars: THREE.Mesh[] = [];
  private aims: THREE.Group[] = [];
  private ghosts = new Map<number, THREE.Mesh>();
  private flakes: THREE.Points;
  private snow: THREE.Points;
  private snowVel: Float32Array;
  private time = 0;
  private homePos = new THREE.Vector3();
  private homeTarget = new THREE.Vector3();
  private inset = 0;
  private raycaster = new THREE.Raycaster();
  private plane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);
  private zoneMarks: THREE.Mesh[] = [];

  constructor(host: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, stencil: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    host.appendChild(this.renderer.domElement);
    this.scene.background = new THREE.Color(SKY_HORIZON);
    this.scene.fog = new THREE.Fog(SKY_HORIZON, 45, 160);

    // one sun with one hard shadow; the sky-blue hemisphere tints the shade instead of greying it
    const sun = new THREE.DirectionalLight(0xfff4e0, 2.6);
    sun.position.set(-9, 16, 12);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    const sc = sun.shadow.camera;
    sc.left = -24; sc.right = 24; sc.top = 16; sc.bottom = -14; sc.near = 1; sc.far = 70;
    sun.shadow.bias = -0.0004;
    sun.shadow.normalBias = 0.03;
    this.scene.add(sun, sun.target, new THREE.HemisphereLight(0xc4def7, 0xffffff, 1.35));

    const charBody = toonMaterial({ vertexColors: true });
    const charLine = outlineMaterial(0.032);
    const snowMat = groundMaterial();
    this.scene.add(sky(), ground(snowMat), props(charBody, outlineMaterial(0.05)));
    this.scene.add(ravine(toonMaterial({ vertexColors: true }), toonMaterial({ color: 0x8cc4ec }), snowMat));
    this.flakes = snowfall();
    this.scene.add(this.flakes);
    this.puff = new Puff(snowMat, 80, (x) => (Math.abs(x) < ARENA.edgeX ? ARENA.ravineY : ARENA.groundY));
    this.scene.add(this.puff.mesh);

    this.buildZones();
    for (const side of [0, 1] as Side[]) this.buildCatapult(side, charBody, charLine);
    const { points, vel } = makeSnow();
    this.snow = points;
    this.snowVel = vel;
    this.scene.add(points);

    window.addEventListener('resize', () => this.resize());
    this.resize();
  }

  /** Build zone markers along each plateau's front edge. */
  private buildZones(): void {
    for (const sign of [-1, 1]) {
      const zone = new THREE.Mesh(
        new THREE.BoxGeometry(ARENA.zoneFar - ARENA.zoneNear, 0.04, 0.3),
        new THREE.MeshBasicMaterial({ color: sign < 0 ? COLORS.p1 : COLORS.p2, transparent: true, opacity: 0.5 }),
      );
      zone.position.set(sign * (ARENA.zoneNear + ARENA.zoneFar) / 2, ARENA.groundY + 0.02, BLOCK_HALF_DEPTH + 0.6);
      this.scene.add(zone);
      this.zoneMarks.push(zone);
    }
  }

  private buildCatapult(side: Side, body: THREE.Material, line: THREE.Material): void {
    const dir = side === 0 ? 1 : -1;
    const color = side === 0 ? COLORS.p1 : COLORS.p2;
    const px = -dir * CATAPULT.x;
    const c = catapult(body, line);
    // the model faces +x with its axle at ARM_PIVOT; turn the right one round to face the left
    c.base.scale.setScalar(BASE_SCALE);
    c.base.position.set(px - dir * ARM_PIVOT[0] * BASE_SCALE, CATAPULT.pivotY - ARM_PIVOT[1] * BASE_SCALE, 0);
    c.base.rotation.y = side === 0 ? 0 : Math.PI;
    c.arm.position.set(ARM_PIVOT[0], ARM_PIVOT[1], 0);
    c.arm.scale.setScalar(ARM_SCALE / BASE_SCALE);
    c.base.add(c.arm);
    c.base.traverse((o) => { if ((o as THREE.Mesh).isMesh) o.castShadow = true; });
    this.scene.add(c.base);
    this.catapults.push(c);

    const child = kid(side === 0 ? WARM : COOL, body, line);
    child.scale.setScalar(1.15);
    child.position.set(px - dir * 1.1, ARENA.groundY, 1.0);
    child.rotation.y = dir * 0.7;
    child.traverse((o) => { if ((o as THREE.Mesh).isMesh) o.castShadow = true; });
    this.scene.add(child);

    // power gauge: a bar that grows beside the catapult
    const gaugeBack = new THREE.Mesh(new THREE.BoxGeometry(0.25, 2.2, 0.05), new THREE.MeshBasicMaterial({ color: 0x334455, transparent: true, opacity: 0.4 }));
    gaugeBack.position.set(px - dir * 1.2, 2.4, 1.2);
    const gauge = new THREE.Mesh(new THREE.BoxGeometry(0.25, 2.2, 0.06), new THREE.MeshBasicMaterial({ color: 0xffd23d }));
    gauge.geometry.translate(0, 1.1, 0);
    gauge.position.set(gaugeBack.position.x, 1.3, 1.22);
    gauge.scale.y = 0.001;
    this.scene.add(gaugeBack, gauge);
    this.powerBars.push(gauge);

    // the aim: a row of dots from the pivot along the launch angle
    const aim = new THREE.Group();
    const dotGeo = new THREE.SphereGeometry(0.09, 10, 6);
    const dotMat = new THREE.MeshBasicMaterial({ color });
    for (let i = 0; i < AIM_DOTS; i++) {
      const d = new THREE.Mesh(dotGeo, dotMat);
      d.position.x = 0.6 + i * 0.55;
      d.scale.setScalar(1 - i * 0.08);
      aim.add(d);
    }
    aim.position.set(px, CATAPULT.pivotY, 0.9);
    this.scene.add(aim);
    this.aims.push(aim);
  }

  /** Points catapult `side` at `angle` (radians above horizontal, towards the enemy) and sets the gauge. */
  setCatapult(side: Side, angle: number, power: number | null, locked: boolean, ready: boolean): void {
    const c = this.catapults[side];
    c.arm.rotation.z = angle - Math.PI + BALL_TILT;
    c.ball.visible = ready;
    const bar = this.powerBars[side];
    bar.visible = power !== null;
    bar.scale.y = Math.max(0.001, power ?? 0);
    (bar.material as THREE.MeshBasicMaterial).color.setHSL(0.15 - (power ?? 0) * 0.15, 1, 0.55);
    const aim = this.aims[side];
    aim.visible = ready;
    aim.rotation.z = side === 0 ? angle : Math.PI - angle;
    aim.children.forEach((d, i) => { d.visible = locked || i < AIM_DOTS - 2; });
  }

  // ---------- build ghost ----------

  /** One ghost per dragging pointer; `piece` null hides it. */
  showGhost(key: number, piece: PieceId | null, x = 0, y = 0, ok = true): void {
    let g = this.ghosts.get(key);
    if (g && g.userData.piece !== piece) {
      this.scene.remove(g);
      this.ghosts.delete(key);
      g = undefined;
    }
    if (!piece) return;
    if (!g) {
      const s = PIECES[piece];
      g = new THREE.Mesh(new THREE.BoxGeometry(s.hx * 2, s.hy * 2, BLOCK_HALF_DEPTH * 2), new THREE.MeshBasicMaterial({ color: COLORS.ghostOk, transparent: true, opacity: 0.45, depthWrite: false }));
      g.userData.piece = piece;
      this.scene.add(g);
      this.ghosts.set(key, g);
    }
    g.position.set(x, y, 0);
    (g.material as THREE.MeshBasicMaterial).color.setHex(ok ? COLORS.ghostOk : COLORS.ghostBad);
  }

  highlightZones(sides: Side[]): void {
    this.zoneMarks.forEach((m, i) => {
      (m.material as THREE.MeshBasicMaterial).opacity = sides.includes(i as Side) ? 0.95 : 0.25;
      m.scale.y = sides.includes(i as Side) ? 3 : 1;
    });
  }

  /** Screen pixel -> point on the play plane. */
  toWorld(clientX: number, clientY: number): { x: number; y: number } {
    const r = this.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1);
    this.raycaster.setFromCamera(ndc, this.camera);
    const hit = new THREE.Vector3();
    this.raycaster.ray.intersectPlane(this.plane, hit);
    return { x: hit.x, y: hit.y };
  }

  /** World point -> CSS pixel (for HUD labels). */
  toScreen(x: number, y: number): { x: number; y: number } {
    const v = new THREE.Vector3(x, y, 0).project(this.camera);
    const r = this.renderer.domElement.getBoundingClientRect();
    return { x: r.left + ((v.x + 1) / 2) * r.width, y: r.top + ((1 - v.y) / 2) * r.height };
  }

  // ---------- camera ----------

  /** Fits the play width (or the play height on a narrow window) and pins the view's bottom edge
   * to ARENA.viewBottom, so a wide window shows more sky rather than more ravine. */
  resize(): void {
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.frame();
  }

  /** Keeps the bottom `px` of the screen clear of the play area (the build tray's strip), easing
   * the camera there; with 0 the ground in front of the forts shows again. */
  setBottomInset(px: number, dt: number): void {
    const next = this.inset + (px - this.inset) * (1 - Math.exp(-dt * 8));
    const inset = Math.abs(px - next) < 0.5 ? px : next;
    if (inset === this.inset) return;
    this.inset = inset;
    this.frame();
  }

  private frame(): void {
    const tan = Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2));
    const halfH = (ARENA.viewTop - ARENA.viewBottom) / 2;
    // the framing box has to fit in the part of the screen above the inset
    const clear = 1 - Math.min(0.4, this.inset / window.innerHeight);
    const dist = Math.max(ARENA.viewHalfWidth / (tan * this.camera.aspect), halfH / (tan * clear));
    const cy = ARENA.viewBottom - 2 * dist * tan * (1 - clear) + dist * tan;
    // a little above the plateaus, looking down: more yard and ravine behind the forts, less sky
    this.homePos.set(0, cy + dist * 0.1, dist);
    this.homeTarget.set(0, cy, 0);
    this.camera.updateProjectionMatrix();
    this.homeCamera();
  }

  homeCamera(): void {
    this.camera.position.copy(this.homePos);
    this.camera.lookAt(this.homeTarget);
  }

  /** Victory replay: orbit `t` in [0, 1] of a half turn around a point. */
  orbit(t: number, cx: number, radius: number, height: number): void {
    // swing round over the ravine side, so the catapult and kid at the outer end never block the fort
    const a = THREE.MathUtils.lerp(-0.25, Math.PI - 0.25, t) * (cx > 0 ? -1 : 1);
    const ease = 0.5 - Math.cos(Math.min(1, t * 3) * Math.PI) / 2;
    const pos = new THREE.Vector3(cx + Math.sin(a) * radius, height, Math.cos(a) * radius);
    this.camera.position.lerpVectors(this.homePos, pos, ease);
    const target = new THREE.Vector3(cx, 1.5, 0);
    this.camera.lookAt(new THREE.Vector3().lerpVectors(this.homeTarget, target, ease));
  }

  // ---------- weather ----------

  /** Light snow always falls behind the yard; the blizzard's driving snow crosses the field. */
  updateSnow(dt: number, blizzard: number): void {
    this.time += dt;
    (this.flakes.material as THREE.ShaderMaterial).uniforms.time.value = this.time;
    const pos = this.snow.geometry.attributes.position as THREE.BufferAttribute;
    const arr = pos.array as Float32Array;
    const n = arr.length / 3;
    const shown = Math.floor(n * blizzard);
    this.snow.visible = shown > 0;
    if (!shown) return;
    const wind = 1 + blizzard * 10;
    for (let i = 0; i < shown; i++) {
      arr[i * 3] += (this.snowVel[i] * 0.3 + wind) * dt;
      arr[i * 3 + 1] -= (1 + this.snowVel[i]) * (1 + blizzard * 2) * dt;
      if (arr[i * 3 + 1] < ARENA.ravineY || arr[i * 3] > 40) {
        arr[i * 3] = -40 + Math.random() * 70;
        arr[i * 3 + 1] = 20 + Math.random() * 5;
      }
    }
    this.snow.geometry.setDrawRange(0, shown);
    pos.needsUpdate = true;
  }

  render(): void {
    this.renderer.render(this.scene, this.camera);
  }
}

function makeSnow(): { points: THREE.Points; vel: Float32Array } {
  const n = 1500;
  const arr = new Float32Array(n * 3);
  const vel = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    arr[i * 3] = -40 + Math.random() * 80;
    arr[i * 3 + 1] = ARENA.ravineY + Math.random() * 30;
    arr[i * 3 + 2] = -10 + Math.random() * 18;
    vel[i] = Math.random();
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(arr, 3));
  const points = new THREE.Points(g, new THREE.PointsMaterial({ color: 0xffffff, size: 0.18, transparent: true, opacity: 0.85 }));
  points.frustumCulled = false;
  return { points, vel };
}
