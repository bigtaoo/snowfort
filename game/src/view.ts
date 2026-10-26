import * as THREE from 'three';
import { ARENA, BLOCK_HALF_DEPTH, CATAPULT, COLORS, PIECES, type PieceId } from './config';
import type { Side } from './arena';

/** Renderer, fixed side camera, terrain and the catapults. */
export class View {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(32, 16 / 9, 0.5, 400);
  readonly barrels: THREE.Group[] = [];
  readonly powerBars: THREE.Mesh[] = [];
  readonly aimLines: THREE.Line[] = [];
  private ghosts = new Map<number, THREE.Mesh>();
  private snow: THREE.Points;
  private snowVel: Float32Array;
  private homePos = new THREE.Vector3();
  private homeTarget = new THREE.Vector3();
  private raycaster = new THREE.Raycaster();
  private plane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);
  private zoneMarks: THREE.Mesh[] = [];

  constructor(host: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    host.appendChild(this.renderer.domElement);
    this.scene.background = new THREE.Color(COLORS.sky);
    this.scene.fog = new THREE.Fog(COLORS.sky, 60, 160);

    this.scene.add(new THREE.HemisphereLight(0xeaf4ff, 0x8aa0c0, 1.4));
    const sun = new THREE.DirectionalLight(0xffffff, 1.8);
    sun.position.set(-12, 30, 22);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    const sc = sun.shadow.camera;
    sc.left = -28; sc.right = 28; sc.top = 22; sc.bottom = -12; sc.near = 1; sc.far = 90;
    this.scene.add(sun);

    this.buildTerrain();
    for (const side of [0, 1] as Side[]) this.buildCatapult(side);
    const { points, vel } = makeSnow();
    this.snow = points;
    this.snowVel = vel;
    this.scene.add(points);

    window.addEventListener('resize', () => this.resize());
    this.resize();
  }

  private buildTerrain(): void {
    const ground = new THREE.MeshStandardMaterial({ color: COLORS.ground, roughness: 0.95 });
    const halfX = (ARENA.outerX - ARENA.edgeX) / 2;
    const h = ARENA.groundY - ARENA.ravineY;
    for (const sign of [-1, 1]) {
      const m = new THREE.Mesh(new THREE.BoxGeometry(halfX * 2 + 30, h, ARENA.depth), ground);
      m.position.set(sign * (ARENA.edgeX + halfX + 15), ARENA.groundY - h / 2, 0);
      m.receiveShadow = true;
      this.scene.add(m);
      // build zone markers on the plateau's front edge
      const zone = new THREE.Mesh(
        new THREE.BoxGeometry(ARENA.zoneFar - ARENA.zoneNear, 0.04, 0.3),
        new THREE.MeshBasicMaterial({ color: sign < 0 ? COLORS.p1 : COLORS.p2, transparent: true, opacity: 0.5 }),
      );
      zone.position.set(sign * (ARENA.zoneNear + ARENA.zoneFar) / 2, ARENA.groundY + 0.02, ARENA.depth / 2 - 0.2);
      this.scene.add(zone);
      this.zoneMarks.push(zone);
    }
    const ravine = new THREE.Mesh(new THREE.BoxGeometry(ARENA.edgeX * 2 + 2, 1, ARENA.depth), new THREE.MeshStandardMaterial({ color: COLORS.ravine, roughness: 0.4 }));
    ravine.position.set(0, ARENA.ravineY - 0.5, 0);
    ravine.receiveShadow = true;
    this.scene.add(ravine);
    // a back wall of distant hills and a far floor so the 3D replay has something behind it
    const far = new THREE.Mesh(new THREE.PlaneGeometry(400, 200), new THREE.MeshStandardMaterial({ color: 0xdfeaf7, roughness: 1 }));
    far.rotation.x = -Math.PI / 2;
    far.position.set(0, ARENA.ravineY - 1, 0);
    this.scene.add(far);
    const hillMat = new THREE.MeshStandardMaterial({ color: 0xe9f1fb, roughness: 1 });
    for (let i = 0; i < 9; i++) {
      const r = 8 + Math.random() * 10;
      const hill = new THREE.Mesh(new THREE.SphereGeometry(r, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2), hillMat);
      hill.position.set(-48 + i * 12 + Math.random() * 4, ARENA.ravineY - 1, -28 - Math.random() * 12);
      hill.scale.y = 0.55;
      this.scene.add(hill);
    }
  }

  private buildCatapult(side: Side): void {
    const dir = side === 0 ? 1 : -1;
    const color = side === 0 ? COLORS.p1 : COLORS.p2;
    const base = new THREE.Group();
    base.position.set(-dir * CATAPULT.x, 0, 0);
    const wood = new THREE.MeshStandardMaterial({ color: 0x8a5a33, roughness: 0.8 });
    const frame = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.5, 1.2), wood);
    frame.position.y = 0.25;
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.3, CATAPULT.pivotY, 0.3), wood);
    post.position.y = CATAPULT.pivotY / 2;
    const flag = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.4, 0.04), new THREE.MeshStandardMaterial({ color }));
    flag.position.set(-dir * 0.5, CATAPULT.pivotY + 1.2, -0.3);
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 1.4), wood);
    pole.position.set(-dir * 0.2, CATAPULT.pivotY + 0.8, -0.3);
    for (const z of [-0.6, 0.6]) {
      for (const x of [-0.6, 0.6]) {
        const wheel = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 0.12, 14), wood);
        wheel.rotation.x = Math.PI / 2;
        wheel.position.set(x, 0.3, z);
        base.add(wheel);
      }
    }
    const barrel = new THREE.Group();
    barrel.position.y = CATAPULT.pivotY;
    const tube = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.34, CATAPULT.barrelLength, 14), new THREE.MeshStandardMaterial({ color, roughness: 0.5 }));
    tube.rotation.z = -Math.PI / 2;
    tube.position.x = CATAPULT.barrelLength / 2;
    barrel.add(tube);
    barrel.scale.x = dir;
    base.add(frame, post, flag, pole, barrel);
    base.traverse((o) => { o.castShadow = true; });
    this.scene.add(base);
    this.barrels.push(barrel);

    // power gauge: a bar that grows above the catapult
    const gaugeBack = new THREE.Mesh(new THREE.BoxGeometry(0.25, 2.2, 0.05), new THREE.MeshBasicMaterial({ color: 0x334455, transparent: true, opacity: 0.4 }));
    gaugeBack.position.set(-dir * 1.4 + base.position.x, 2.4, 0.8);
    const gauge = new THREE.Mesh(new THREE.BoxGeometry(0.25, 2.2, 0.06), new THREE.MeshBasicMaterial({ color: 0xffd23d }));
    gauge.geometry.translate(0, 1.1, 0);
    gauge.position.set(gaugeBack.position.x, 1.3, 0.82);
    gauge.scale.y = 0.001;
    this.scene.add(gaugeBack, gauge);
    this.powerBars.push(gauge);

    // a short dashed aim line along the barrel
    const pts = [new THREE.Vector3(0, 0, 0), new THREE.Vector3(1, 0, 0)];
    const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineDashedMaterial({ color, dashSize: 0.3, gapSize: 0.25 }));
    line.computeLineDistances();
    line.position.set(base.position.x, CATAPULT.pivotY, 0.6);
    this.scene.add(line);
    this.aimLines.push(line);
  }

  /** Points barrel `side` at `angle` (radians above horizontal, towards the enemy) and sets the gauge. */
  setCatapult(side: Side, angle: number, power: number | null, locked: boolean, ready: boolean): void {
    this.barrels[side].rotation.z = side === 0 ? angle : -angle;
    const bar = this.powerBars[side];
    bar.visible = power !== null;
    bar.scale.y = Math.max(0.001, power ?? 0);
    (bar.material as THREE.MeshBasicMaterial).color.setHSL(0.15 - (power ?? 0) * 0.15, 1, 0.55);
    const line = this.aimLines[side];
    line.visible = ready;
    line.rotation.z = side === 0 ? angle : Math.PI - angle;
    line.scale.x = locked ? 5 : 3.5;
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

  resize(): void {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    const tan = Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2));
    const halfH = (ARENA.viewTop - ARENA.viewBottom) / 2;
    const dist = Math.max(ARENA.viewHalfWidth / (tan * this.camera.aspect), halfH / tan);
    const cy = (ARENA.viewTop + ARENA.viewBottom) / 2;
    this.homePos.set(0, cy + 1.5, dist);
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
    const a = THREE.MathUtils.lerp(-0.25, Math.PI - 0.25, t);
    const ease = 0.5 - Math.cos(Math.min(1, t * 3) * Math.PI) / 2;
    const pos = new THREE.Vector3(cx + Math.sin(a) * radius, height, Math.cos(a) * radius);
    this.camera.position.lerpVectors(this.homePos, pos, ease);
    const target = new THREE.Vector3(cx, 1.5, 0);
    this.camera.lookAt(new THREE.Vector3().lerpVectors(this.homeTarget, target, ease));
  }

  // ---------- weather ----------

  updateSnow(dt: number, blizzard: number): void {
    const pos = this.snow.geometry.attributes.position as THREE.BufferAttribute;
    const arr = pos.array as Float32Array;
    const n = arr.length / 3;
    const shown = Math.floor(n * (0.12 + 0.88 * blizzard));
    const wind = 1 + blizzard * 10;
    for (let i = 0; i < n; i++) {
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
