import { CATAPULT, CPU, PHYSICS, type PieceId } from './config';
import { Arena, type Side } from './arena';
import { Launcher } from './launcher';
import type { Card } from './cards';

export type CpuLevel = keyof typeof CPU.levels;

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

export const REPAIR_PLAN: Placement[] = [
  { piece: 'snow', u: 4, y: 6 }, { piece: 'snow', u: 5, y: 6 }, { piece: 'ice', u: 6, y: 6 }, { piece: 'snow', u: 3, y: 6 }, { piece: 'plankH', u: 4.5, y: 7 },
];

const deg = Math.PI / 180;
const gauss = () => (Math.random() + Math.random() + Math.random() - 1.5) / 1.5;

/** Plays one catapult by solving the ballistic arc to the enemy king, plus noise. */
export class CpuShooter {
  private wantAngle: number | null = null;
  private wantPower = 0;
  private think = 0;
  private bias = 0;
  private targetX = 0;
  private awaitingImpact = false;
  private prevPower = 0;

  constructor(readonly side: Side, readonly level: CpuLevel) {}

  update(dt: number, l: Launcher, arena: Arena): { press?: boolean; release?: boolean } {
    const cfg = CPU.levels[this.level];
    for (const imp of arena.impacts) {
      if (imp.owner === this.side && this.awaitingImpact) {
        this.awaitingImpact = false;
        // positive error means the shot went past the target
        const err = (imp.x - this.targetX) * (this.side === 0 ? 1 : -1);
        this.bias -= err * cfg.correction;
        this.bias = Math.max(-6, Math.min(6, this.bias));
      }
    }
    if (l.phase === 'reload' || !l.ready && l.phase !== 'charge') {
      this.wantAngle = null;
      return {};
    }
    if (l.phase === 'sweep') {
      if (this.wantAngle === null) {
        this.think -= dt;
        if (this.think > 0) return {};
        if (!this.plan(arena)) return {};
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
      this.awaitingImpact = true;
      return { release: true };
    }
    return {};
  }

  private plan(arena: Arena): boolean {
    const cfg = CPU.levels[this.level];
    const enemy = (1 - this.side) as Side;
    const kings = arena.ents.filter((e) => e.alive && e.owner === enemy && (e.kind === 'king' || e.kind === 'decoy'));
    const real = kings.find((k) => k.kind === 'king');
    if (!real) return false;
    const decoy = kings.find((k) => k.kind === 'decoy');
    const target = decoy && Math.random() < cfg.decoyFooled ? decoy : real;
    const tp = target.body.translation();
    this.targetX = tp.x;
    const dir = this.side === 0 ? 1 : -1;
    const g = -PHYSICS.gravity;
    const angles = [...CPU.preferredAnglesDeg].sort(() => Math.random() - 0.5);
    for (const a of angles) {
      const theta = (a + gauss() * cfg.angleNoiseDeg) * deg;
      const m = Arena.muzzle(this.side, theta);
      const dx = (tp.x - m.x) * dir + this.bias;
      const dy = tp.y + 0.3 - m.y;
      const denom = 2 * Math.cos(theta) ** 2 * (dx * Math.tan(theta) - dy);
      if (denom <= 0) continue;
      let v = Math.sqrt((g * dx * dx) / denom);
      v += gauss() * cfg.speedNoise;
      const power = Launcher.powerFor(v);
      if (power < 0.03 || power > 0.97) continue;
      this.wantAngle = Math.max(CATAPULT.minAngleDeg * deg, Math.min(CATAPULT.maxAngleDeg * deg, theta));
      this.wantPower = power;
      return true;
    }
    // nothing fits: lob something anyway
    this.wantAngle = 45 * deg;
    this.wantPower = 0.7;
    return true;
  }
}


/**
 * The CPU's card: ammo when it is behind, fort cards when its own fort is worn down, with some noise.
 * `fortShare` is its standing blocks over the rival's. Easy picks at random.
 */
export function cpuPickCard(hand: Card[], level: CpuLevel, behind: boolean, fortShare: number): number {
  if (level === 'easy') return Math.floor(Math.random() * hand.length);
  let best = 0;
  let bestScore = -Infinity;
  hand.forEach((c, i) => {
    let score = Math.random() * 1.5;
    if (c.kind === 'ammo') score += 2 + (behind ? 1.5 : 0) + (c.id === 'bigIce' ? 0.8 : 0);
    if (c.kind === 'fort') score += 1.5 + (fortShare < 0.8 ? 2 : 0) + (c.id === 'roof' || c.id === 'spring' ? 0.5 : 0);
    if (c.kind === 'rule') score += 1.5 + (c.id === 'triple' && behind ? 1 : 0);
    if (score > bestScore) { bestScore = score; best = i; }
  });
  return best;
}
