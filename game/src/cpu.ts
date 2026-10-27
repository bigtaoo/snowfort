import { AMMO, CATAPULT, CPU, PHYSICS, type PieceId } from './config';
import { Arena, type Side } from './arena';
import { Launcher } from './launcher';

/** How well Frosty throws: noise on aim and power, time between throws, and how often he is fooled or throws wild. */
export interface CpuSkill {
  angleNoiseDeg: number;
  speedNoise: number;
  thinkSeconds: number;
  decoyFooled: number;
  wildShot: number;
}

/** The skill at a hidden level (1..CPU.maxLevel): a straight slide from the weakest to the strongest. */
export function cpuSkill(level: number): CpuSkill {
  const k = (Math.min(CPU.maxLevel, Math.max(1, level)) - 1) / (CPU.maxLevel - 1);
  const w = CPU.weakest;
  const s = CPU.strongest;
  const lerp = (a: number, b: number, x: number) => a + (b - a) * x;
  return {
    angleNoiseDeg: lerp(w.angleNoiseDeg, s.angleNoiseDeg, k),
    speedNoise: lerp(w.speedNoise, s.speedNoise, k),
    thinkSeconds: lerp(w.thinkSeconds, s.thinkSeconds, k),
    decoyFooled: lerp(w.decoyFooled, s.decoyFooled, k),
    wildShot: lerp(w.wildShot, s.wildShot, Math.min(1, k / CPU.wildFadeAt)),
  };
}

/** A placement in side-relative terms: u is the distance from the middle of the arena outwards. */
export interface Placement {
  piece: PieceId;
  u: number;
  y?: number;
}

/** Forts the CPU (and the "random fort" button) can build. Listed bottom-up. */
export const PRESET_FORTS: Placement[][] = [
  // shelter: king under a roof behind a snow wall
  [
    { piece: 'snow', u: 2.7 }, { piece: 'snow', u: 2.7 }, { piece: 'snow', u: 2.7 },
    { piece: 'snow', u: 3.7 }, { piece: 'snow', u: 3.7 }, { piece: 'snow', u: 3.7 },
    { piece: 'plankH', u: 3.2, y: 3 }, { piece: 'ice', u: 2.7, y: 3.3 }, { piece: 'snow', u: 3.7, y: 3.3 },
    { piece: 'ice', u: 4.7 }, { piece: 'ice', u: 4.7 },
    { piece: 'plankV', u: 5.8 }, { piece: 'plankV', u: 8.4 }, { piece: 'king', u: 7.1 },
    { piece: 'plankH', u: 7.1, y: 3 }, { piece: 'snow', u: 6.6, y: 3.3 }, { piece: 'snow', u: 7.6, y: 3.3 }, { piece: 'ice', u: 7.1, y: 4.3 },
  ],
  // bunker: low and wide, king hugging the ground
  [
    { piece: 'snow', u: 2.7 }, { piece: 'snow', u: 2.7 }, { piece: 'ice', u: 2.7 },
    { piece: 'snow', u: 3.7 }, { piece: 'snow', u: 3.7 }, { piece: 'ice', u: 3.7 },
    { piece: 'snow', u: 4.7 }, { piece: 'snow', u: 4.7 }, { piece: 'plankH', u: 3.7, y: 3 },
    { piece: 'snow', u: 2.7, y: 3.3 }, { piece: 'snow', u: 3.7, y: 3.3 }, { piece: 'ice', u: 4.7, y: 3.3 },
    { piece: 'plankV', u: 5.8 }, { piece: 'plankV', u: 8.4 }, { piece: 'king', u: 7.1 },
    { piece: 'plankH', u: 7.1, y: 3 }, { piece: 'snow', u: 6.5, y: 3.3 }, { piece: 'snow', u: 7.7, y: 3.3 }, { piece: 'ice', u: 7.1, y: 4.3 },
  ],
  // perch: king up on a pedestal behind a tall ice-and-snow wall
  [
    { piece: 'ice', u: 3.35 }, { piece: 'ice', u: 3.35 }, { piece: 'ice', u: 3.35 }, { piece: 'snow', u: 3.35 },
    { piece: 'snow', u: 4.35 }, { piece: 'snow', u: 4.35 }, { piece: 'snow', u: 4.35 }, { piece: 'snow', u: 4.35 },
    { piece: 'plankV', u: 5.4 },
    { piece: 'snow', u: 6.7 }, { piece: 'snow', u: 6.7 }, { piece: 'snow', u: 7.7 }, { piece: 'snow', u: 7.7 },
    { piece: 'plankH', u: 7.2, y: 2 }, { piece: 'king', u: 7.2, y: 2.3 },
    { piece: 'snow', u: 2.35 }, { piece: 'ice', u: 2.35 },
  ],
];

export const randomFort = (): Placement[] => PRESET_FORTS[Math.floor(Math.random() * PRESET_FORTS.length)];

const deg = Math.PI / 180;
const gauss = () => (Math.random() + Math.random() + Math.random() - 1.5) / 1.5;

/** Plays one catapult by solving the arc to the enemy king (gravity, wind and the ammo's flight), plus noise. */
export class CpuShooter {
  private wantAngle: number | null = null;
  private wantPower = 0;
  private think = 0;
  private prevPower = 0;

  private readonly cfg: CpuSkill;

  constructor(readonly side: Side, readonly level: number) {
    this.cfg = cpuSkill(level);
  }

  update(dt: number, l: Launcher, arena: Arena): { press?: boolean; release?: boolean } {
    const cfg = this.cfg;
    if (l.phase === 'reload' || !l.ready && l.phase !== 'charge') {
      this.wantAngle = null;
      return {};
    }
    if (l.phase === 'sweep') {
      if (this.wantAngle === null) {
        this.think -= dt;
        if (this.think > 0) return {};
        if (!this.plan(arena, l)) return {};
        if (Math.random() < cfg.wildShot) {
          // way short or way long, so an easy CPU lands only now and then
          const off = 0.18 + Math.random() * 0.17;
          this.wantPower = Math.min(0.97, Math.max(0.03, this.wantPower + (Math.random() < 0.5 ? -off : off)));
        }
      }
      if (Math.abs(l.angle - this.wantAngle!) < 1.6 * deg) {
        this.prevPower = 0;
        return { press: true };
      }
      return {};
    }
    // charging: let go once power passes the wanted value on its way up
    const p = l.power;
    const rising = p >= this.prevPower;
    this.prevPower = p;
    if ((rising && p >= this.wantPower) || (!rising && p < 0.05)) {
      this.wantAngle = null;
      this.think = cfg.thinkSeconds * (0.6 + Math.random() * 0.8);
      return { release: true };
    }
    return {};
  }

  private plan(arena: Arena, l: Launcher): boolean {
    const cfg = this.cfg;
    const enemy = (1 - this.side) as Side;
    const kings = arena.ents.filter((e) => e.alive && e.owner === enemy && (e.kind === 'king' || e.kind === 'decoy'));
    const real = kings.find((k) => k.kind === 'king');
    if (!real) return false;
    const decoy = kings.find((k) => k.kind === 'decoy');
    const target = decoy && Math.random() < cfg.decoyFooled ? decoy : real;
    const tp = target.body.translation();
    const dir = this.side === 0 ? 1 : -1;
    const firework = l.ammo[0] === 'firework';
    const g = -PHYSICS.gravity * (firework ? AMMO.firework.gravityScale : 1);
    const wind = arena.wind[this.side] * dir;
    const speedMul = firework ? AMMO.firework.speedMul : 1;
    if (firework) {
      // too fast to land on him: pick a speed and aim the near-straight line through him
      const v = (CATAPULT.minSpeed + Math.random() * 0.5 * (CATAPULT.maxSpeed - CATAPULT.minSpeed)) * speedMul;
      const theta = solveAngle(this.side, v, tp.x, tp.y + 0.3, g, wind);
      if (theta !== null) {
        this.wantAngle = Math.min(AMMO.firework.maxAngleDeg * deg, Math.max(AMMO.firework.minAngleDeg * deg, theta + gauss() * cfg.angleNoiseDeg * deg));
        this.wantPower = Math.min(0.97, Math.max(0.03, Launcher.powerFor(v / speedMul + gauss() * cfg.speedNoise)));
        return true;
      }
    }
    const angles = [...CPU.preferredAnglesDeg].sort(() => Math.random() - 0.5);
    for (const a of angles) {
      const theta = (a + gauss() * cfg.angleNoiseDeg) * deg;
      if (theta < CATAPULT.minAngleDeg * deg || theta > CATAPULT.maxAngleDeg * deg) continue;
      const m = Arena.muzzle(this.side, theta);
      const dx = (tp.x - m.x) * dir;
      const dy = tp.y + 0.3 - m.y;
      let v = solveSpeed(theta, dx, dy, g, wind, CATAPULT.minSpeed * speedMul, CATAPULT.maxSpeed * speedMul);
      if (v === null) continue;
      v = v / speedMul + gauss() * cfg.speedNoise;
      const power = Launcher.powerFor(v);
      if (power < 0.03 || power > 0.97) continue;
      this.wantAngle = theta;
      this.wantPower = power;
      return true;
    }
    // nothing fits: a firework goes straight at him; anything else lobs
    this.wantAngle = firework ? 4 * deg : 45 * deg;
    this.wantPower = firework ? 0.3 : 0.7;
    return true;
  }
}


/**
 * The launch speed that brings a shot at angle `theta` down through (dx, dy), under gravity `g` and a steady
 * horizontal acceleration `ax` (wind), by bisection: the landing distance grows with speed. Null if out of reach.
 */
/**
 * Barrel angle whose arc at speed `v` passes through (tx, ty) on the way, rising or falling, or null.
 * For shots too fast to land on the target (fireworks), over the firework's sweep, where height there grows with angle.
 */
export function solveAngle(side: Side, v: number, tx: number, ty: number, g: number, ax: number): number | null {
  const dir = side === 0 ? 1 : -1;
  const miss = (theta: number): number => {
    const m = Arena.muzzle(side, theta);
    const dx = (tx - m.x) * dir;
    const vx = v * Math.cos(theta);
    const disc = vx * vx + 2 * ax * dx;
    if (disc < 0) return -Infinity; // blown back before getting there
    const t = Math.abs(ax) < 1e-6 ? dx / vx : (Math.sqrt(disc) - vx) / ax;
    return m.y + v * Math.sin(theta) * t - 0.5 * g * t * t - ty;
  };
  let lo = AMMO.firework.minAngleDeg * deg;
  let hi = AMMO.firework.maxAngleDeg * deg;
  if (miss(lo) > 0 || miss(hi) < 0) return null;
  for (let i = 0; i < 30; i++) {
    const mid = (lo + hi) / 2;
    if (miss(mid) < 0) lo = mid; else hi = mid;
  }
  return (lo + hi) / 2;
}

export function solveSpeed(theta: number, dx: number, dy: number, g: number, ax: number, vMin: number, vMax: number): number | null {
  const reach = (v: number): number => {
    const vy = v * Math.sin(theta);
    const disc = vy * vy - 2 * g * dy;
    if (disc < 0) return -Infinity; // never climbs that high
    const t = (vy + Math.sqrt(disc)) / g;
    return v * Math.cos(theta) * t + 0.5 * ax * t * t;
  };
  if (reach(vMin) > dx || reach(vMax) < dx) return null;
  let lo = vMin;
  let hi = vMax;
  for (let i = 0; i < 30; i++) {
    const mid = (lo + hi) / 2;
    if (reach(mid) < dx) lo = mid; else hi = mid;
  }
  return (lo + hi) / 2;
}
