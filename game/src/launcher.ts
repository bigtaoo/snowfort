import { CATAPULT } from './config';
import type { AmmoId, Side } from './arena';

const deg = Math.PI / 180;
const tri = (t: number) => 1 - Math.abs(((t % 1) + 1) % 1 * 2 - 1); // 0 -> 1 -> 0

export interface Shot {
  side: Side;
  angle: number;
  speed: number;
  ammo: AmmoId;
  triple: boolean;
}

/**
 * One catapult. The barrel sweeps up and down by itself; pressing locks the angle and starts
 * charging (power ping-pongs while held); releasing fires. Then it reloads.
 */
export class Launcher {
  phase: 'sweep' | 'charge' | 'reload' = 'sweep';
  angle = CATAPULT.minAngleDeg * deg;
  power = 0;
  reloadLeft = 0;
  reloadMul = 1;
  /** Alternate-turn mode: only the armed launcher may fire. */
  armed = true;
  /** Special shots granted by ammo cards, used first. */
  ammo: AmmoId[] = [];
  /** Rule card: the first shot of the round fires three balls. */
  tripleNext = false;
  shots = 0;
  private sweepT: number;
  private chargeT = 0;

  constructor(readonly side: Side) {
    this.sweepT = side * 0.37;
  }

  get ready(): boolean {
    return this.armed && this.phase !== 'reload';
  }

  resetForRound(): void {
    this.phase = 'sweep';
    this.reloadLeft = 0;
    this.power = 0;
    this.shots = 0;
  }

  update(dt: number): void {
    if (this.phase === 'sweep') {
      if (this.armed) this.sweepT += dt / CATAPULT.sweepPeriod;
      this.angle = (CATAPULT.minAngleDeg + (CATAPULT.maxAngleDeg - CATAPULT.minAngleDeg) * tri(this.sweepT)) * deg;
    } else if (this.phase === 'charge') {
      this.chargeT += dt / CATAPULT.chargePeriod;
      this.power = tri(this.chargeT);
    } else if (this.phase === 'reload') {
      this.reloadLeft -= dt;
      if (this.reloadLeft <= 0) this.phase = 'sweep';
    }
  }

  press(): void {
    if (this.phase !== 'sweep' || !this.armed) return;
    this.phase = 'charge';
    this.chargeT = 0;
    this.power = 0;
  }

  release(): Shot | null {
    if (this.phase !== 'charge') return null;
    const shot: Shot = {
      side: this.side,
      angle: this.angle,
      speed: CATAPULT.minSpeed + (CATAPULT.maxSpeed - CATAPULT.minSpeed) * this.power,
      ammo: this.ammo.shift() ?? 'snowball',
      triple: this.tripleNext,
    };
    this.tripleNext = false;
    this.phase = 'reload';
    this.reloadLeft = CATAPULT.reloadSeconds * this.reloadMul;
    this.power = 0;
    this.shots++;
    return shot;
  }

  /** CPU helper: the speed a given power gives, and back. */
  static powerFor(speed: number): number {
    return (speed - CATAPULT.minSpeed) / (CATAPULT.maxSpeed - CATAPULT.minSpeed);
  }
}
