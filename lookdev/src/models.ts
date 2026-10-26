import {
  CapsuleGeometry,
  ConeGeometry,
  CylinderGeometry,
  Group,
  IcosahedronGeometry,
  SphereGeometry,
  TorusGeometry,
  type Material,
} from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { Kit } from './kit';

// The characters and the catapult, built from primitives (Tripo was out of credits; the reference
// images in art/models/ can go through image-to-3D later). Units are metres, feet at y = 0,
// facing +z (the camera in the side view).

const PI = Math.PI;
const SKIN = 0xffd6b3;
const COAL = 0x1b2333;
const SNOW = 0xf6faff;

export interface KidColours {
  jacket: number;
  hat: number;
  scarf: number;
  mitten: number;
  trousers: number;
  boots: number;
  hair: number;
}

export const WARM: KidColours = { jacket: 0xff6a2b, hat: 0xffc928, scarf: 0xffc928, mitten: 0xe8322b, trousers: 0x5b3a2b, boots: 0xa0683a, hair: 0x5a3320 };
export const COOL: KidColours = { jacket: 0x3aa8f2, hat: 0x17b3a6, scarf: 0x86e6c8, mitten: 0x17b3a6, trousers: 0x2b3f86, boots: 0x7c8796, hair: 0x7a4a26 };

/** A chibi kid about 1.4 m tall: big head, puffy jacket, bobble hat. */
export function kid(c: KidColours, body: Material, line: Material): Group {
  const k = new Kit();
  for (const s of [-1, 1]) {
    k.add(new RoundedBoxGeometry(0.17, 0.13, 0.27, 2, 0.05), c.boots, { at: [s * 0.1, 0.065, 0.03] });
    k.add(new CylinderGeometry(0.075, 0.08, 0.24, 10), c.trousers, { at: [s * 0.1, 0.24, 0] });
    // arms out and down, a mitten at the end
    k.add(new CapsuleGeometry(0.075, 0.2, 4, 10), c.jacket, { at: [s * 0.3, 0.68, 0], rot: [0, 0, s * 0.75] });
    k.add(new SphereGeometry(0.085, 12, 8), c.mitten, { at: [s * 0.4, 0.56, 0.02] });
    // face: eyes, cheeks
    k.add(new SphereGeometry(0.036, 10, 8), COAL, { at: [s * 0.085, 1.09, 0.235], noLine: true });
    k.add(new SphereGeometry(0.012, 6, 4), 0xffffff, { at: [s * 0.085 + 0.012, 1.1, 0.268], noLine: true });
    k.add(new SphereGeometry(0.05, 10, 8), 0xff9a9a, { at: [s * 0.15, 1.01, 0.205], scale: [1, 0.7, 0.4], noLine: true });
  }
  // puffy jacket: a squat capsule with a ring round the hem
  k.add(new CapsuleGeometry(0.23, 0.2, 6, 16), c.jacket, { at: [0, 0.6, 0], scale: [1, 1, 0.88] });
  k.add(new TorusGeometry(0.2, 0.05, 8, 20), c.jacket, { at: [0, 0.38, 0], rot: [PI / 2, 0, 0], scale: [1, 0.88, 1] });
  k.add(new SphereGeometry(0.02, 6, 4), COAL, { at: [0, 0.62, 0.205], noLine: true });
  k.add(new SphereGeometry(0.02, 6, 4), COAL, { at: [0, 0.52, 0.21], noLine: true });
  // scarf
  k.add(new TorusGeometry(0.16, 0.065, 8, 20), c.scarf, { at: [0, 0.84, 0], rot: [PI / 2, 0, 0] });
  k.add(new RoundedBoxGeometry(0.1, 0.24, 0.05, 2, 0.02), c.scarf, { at: [0.09, 0.72, 0.19], rot: [0.15, 0, 0.12] });
  // head, hair fringe, nose, smile
  k.add(new SphereGeometry(0.26, 20, 14), SKIN, { at: [0, 1.06, 0] });
  k.add(new SphereGeometry(0.262, 16, 8, 0, 2 * PI, 0, PI * 0.36), c.hair, { at: [0, 1.06, 0], rot: [0.45, 0, 0], noLine: true });
  k.add(new SphereGeometry(0.03, 8, 6), 0xff8f80, { at: [0, 1.04, 0.262], noLine: true });
  k.add(new TorusGeometry(0.045, 0.012, 6, 12, PI), COAL, { at: [0, 0.98, 0.245], rot: [0, 0, PI], noLine: true });
  // bobble hat: a dome, a ribbed cuff and the bobble
  k.add(new SphereGeometry(0.27, 18, 10, 0, 2 * PI, 0, PI / 2), c.hat, { at: [0, 1.13, -0.01], scale: [1, 1.05, 1] });
  k.add(new TorusGeometry(0.255, 0.055, 8, 22), c.hat, { at: [0, 1.14, -0.01], rot: [PI / 2 - 0.08, 0, 0] });
  k.add(new IcosahedronGeometry(0.085, 1), c.hat, { at: [0, 1.43, -0.02] });
  return k.build(body, line);
}

/** The snowman king, about 1.35 m: three snowballs, a red capelet and a golden crown. */
export function snowmanKing(body: Material, line: Material): Group {
  const k = new Kit();
  k.add(new SphereGeometry(0.36, 22, 16), SNOW, { at: [0, 0.34, 0], scale: [1, 0.94, 1] });
  k.add(new SphereGeometry(0.27, 20, 14), SNOW, { at: [0, 0.8, 0] });
  k.add(new SphereGeometry(0.205, 20, 14), SNOW, { at: [0, 1.15, 0] });
  // capelet with a white fur trim, tied at the front
  k.add(new CylinderGeometry(0.2, 0.31, 0.2, 18), 0xe0302a, { at: [0, 0.94, 0] });
  k.add(new TorusGeometry(0.3, 0.035, 6, 22), 0xffffff, { at: [0, 0.84, 0], rot: [PI / 2, 0, 0] });
  k.add(new SphereGeometry(0.05, 8, 6), 0xc72520, { at: [-0.05, 1.0, 0.2] });
  k.add(new SphereGeometry(0.05, 8, 6), 0xc72520, { at: [0.05, 1.0, 0.2] });
  // face and buttons
  for (const s of [-1, 1]) {
    k.add(new SphereGeometry(0.03, 8, 6), COAL, { at: [s * 0.07, 1.2, 0.18], noLine: true });
    k.add(new SphereGeometry(0.035, 8, 6), 0xffb3b3, { at: [s * 0.13, 1.12, 0.16], scale: [1, 0.7, 0.4], noLine: true });
  }
  k.add(new ConeGeometry(0.04, 0.2, 10), 0xff8a1f, { at: [0, 1.14, 0.28], rot: [PI / 2, 0, 0] });
  for (let i = 0; i < 5; i++) {
    const a = -0.6 + i * 0.3;
    k.add(new SphereGeometry(0.014, 6, 4), COAL, { at: [Math.sin(a) * 0.12, 1.08 - Math.cos(a) * 0.035 - 0.04, 0.17], noLine: true });
  }
  k.add(new SphereGeometry(0.035, 8, 6), COAL, { at: [0, 0.74, 0.262], noLine: true });
  k.add(new SphereGeometry(0.035, 8, 6), COAL, { at: [0, 0.62, 0.235], noLine: true });
  k.add(new SphereGeometry(0.04, 8, 6), COAL, { at: [0, 0.4, 0.34], noLine: true });
  // twig arms with a side twig each
  for (const s of [-1, 1]) {
    k.add(new CylinderGeometry(0.018, 0.026, 0.45, 6), 0x7a4a26, { at: [s * 0.42, 0.92, 0], rot: [0, 0, -s * 1.0] });
    k.add(new CylinderGeometry(0.012, 0.016, 0.14, 5), 0x7a4a26, { at: [s * 0.53, 1.07, 0], rot: [0, 0, -s * 0.2] });
  }
  // crown: a gold band with five points, each tipped with a ball, and red gems on the band
  k.add(new CylinderGeometry(0.16, 0.15, 0.1, 20), 0xffc21a, { at: [0, 1.36, 0] });
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * 2 * PI;
    const x = Math.sin(a) * 0.14;
    const z = Math.cos(a) * 0.14;
    k.add(new ConeGeometry(0.05, 0.12, 4), 0xffc21a, { at: [x, 1.46, z], rot: [0, a + PI / 4, 0] });
    k.add(new SphereGeometry(0.022, 8, 6), 0xffd84a, { at: [x, 1.53, z], noLine: true });
    k.add(new SphereGeometry(0.024, 8, 6), 0xe0302a, { at: [Math.sin(a) * 0.158, 1.36, Math.cos(a) * 0.158], noLine: true });
  }
  return k.build(body, line);
}

export interface Catapult {
  group: Group;
  /** Pivots about z; 0 is cocked (bucket back and low), ARM_FIRED is thrown. */
  arm: Group;
  /** The snowball sitting in the bucket (hidden when it flies). */
  ball: Group;
  /** Where the ball sits, in arm coordinates. */
  cup: [number, number, number];
}

export const ARM_REST = 0.1;
export const ARM_FIRED = -2.45;
export const BALL_R = 0.2;

/** A toy-like wooden catapult on four wheels, facing +x; its arm is its own group so it can swing. */
export function catapult(body: Material, line: Material): Catapult {
  const WOOD = 0xc98a4b;
  const DARK = 0x8a5a2e;
  const k = new Kit();
  for (const z of [-0.3, 0.3]) {
    k.add(new RoundedBoxGeometry(1.5, 0.14, 0.12, 2, 0.03), WOOD, { at: [0, 0.26, z] });
    for (const x of [-0.5, 0.5]) {
      k.add(new CylinderGeometry(0.19, 0.19, 0.09, 16), WOOD, { at: [x, 0.19, z * 1.42], rot: [PI / 2, 0, 0] });
      k.add(new CylinderGeometry(0.06, 0.06, 0.11, 10), DARK, { at: [x, 0.19, z * 1.42], rot: [PI / 2, 0, 0], noLine: true });
    }
    // an A-frame each side holding the stop bar
    k.add(new RoundedBoxGeometry(0.1, 0.72, 0.1, 2, 0.025), WOOD, { at: [0.2, 0.6, z], rot: [0, 0, 0.28] });
    k.add(new RoundedBoxGeometry(0.1, 0.72, 0.1, 2, 0.025), WOOD, { at: [0.5, 0.6, z], rot: [0, 0, -0.28] });
    // snow lying on the rails
    k.add(new SphereGeometry(0.12, 10, 6), 0xf6faff, { at: [-0.55, 0.33, z], scale: [1.6, 0.4, 0.7] });
  }
  for (const x of [-0.62, 0, 0.62]) k.add(new RoundedBoxGeometry(0.16, 0.07, 0.72, 2, 0.02), DARK, { at: [x, 0.35, 0] });
  k.add(new CylinderGeometry(0.055, 0.055, 0.78, 10), DARK, { at: [0.35, 0.92, 0], rot: [PI / 2, 0, 0] });
  k.add(new CylinderGeometry(0.05, 0.05, 0.74, 10), DARK, { at: [-0.35, 0.42, 0], rot: [PI / 2, 0, 0] });
  const group = k.build(body, line);

  // the arm: pivots on the back axle, the bucket at its far end
  const a = new Kit();
  a.add(new RoundedBoxGeometry(1.15, 0.09, 0.11, 2, 0.03), WOOD, { at: [-0.52, 0, 0] });
  a.add(new CylinderGeometry(0.15, 0.11, 0.1, 14), DARK, { at: [-1.1, 0.06, 0] });
  a.add(new TorusGeometry(0.075, 0.03, 6, 12), 0xd9b26a, { at: [0, 0, 0], rot: [0, 0, 0] });
  const arm = a.build(body, line);
  arm.position.set(-0.35, 0.42, 0);
  arm.rotation.z = ARM_REST;
  group.add(arm);

  const b = new Kit();
  b.add(new IcosahedronGeometry(BALL_R, 2), 0xf6faff);
  const ball = b.build(body, line);
  const cup: [number, number, number] = [-1.1, 0.12 + BALL_R, 0];
  ball.position.set(...cup);
  arm.add(ball);
  return { group, arm, ball, cup };
}
