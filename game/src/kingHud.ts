import { MATERIALS } from './config';
import type { Arena, Side } from './arena';
import type { View } from './view';

// Over each king: a small health bar that follows him, and a "-N" that pops up when he is hurt.
// Damage arrives in tiny per-step slices, so it is gathered and shown at most a few times a second.

const POP_EVERY = 0.25;
const MIN_POP = 0.5;

export class KingHud {
  private bars: HTMLElement[] = [];
  private fills: HTMLElement[] = [];
  private pending = [0, 0];
  private sinceLast = [POP_EVERY, POP_EVERY];
  /** A downed king says KO! once; debris landing on him afterwards stays quiet. */
  private koShown = [false, false];

  /** `onPop` hears each gathered hit as it is shown (for the sound). */
  constructor(private host: HTMLElement, private topBars: HTMLElement[], private onPop: (side: Side, dmg: number) => void = () => {}) {
    for (const side of [0, 1] as Side[]) {
      const bar = document.createElement('div');
      bar.className = `kingBar p${side}`;
      const fill = document.createElement('i');
      bar.append(fill);
      host.append(bar);
      this.bars.push(bar);
      this.fills.push(fill);
    }
  }

  hit(side: Side, dmg: number): void {
    this.pending[side] += dmg;
  }

  clear(): void {
    this.pending = [0, 0];
    this.koShown = [false, false];
  }

  update(dt: number, arena: Arena, view: View, show: boolean): void {
    for (const side of [0, 1] as Side[]) {
      const k = arena.king(side);
      const bar = this.bars[side];
      this.sinceLast[side] += dt;
      if (!show || !k) {
        bar.style.display = 'none';
        this.pending[side] = 0;
        continue;
      }
      const p = k.body.translation();
      const s = view.toScreen(p.x, p.y + 1.25);
      bar.style.display = '';
      bar.style.left = `${s.x}px`;
      bar.style.top = `${s.y}px`;
      const health = Math.max(0, 1 - (k.impact ?? 0) / MATERIALS.king.hp);
      this.fills[side].style.width = `${health * 100}%`;
      if (this.koShown[side]) this.pending[side] = 0;
      if (this.pending[side] >= MIN_POP && this.sinceLast[side] >= POP_EVERY) {
        this.koShown[side] = health <= 0;
        this.pop(side, s.x, s.y, this.pending[side], health <= 0);
        this.pending[side] = 0;
        this.sinceLast[side] = 0;
      }
    }
  }

  private pop(side: Side, x: number, y: number, dmg: number, out: boolean): void {
    const el = document.createElement('div');
    el.className = `dmgPop p${side}${dmg >= 8 ? ' big' : ''}`;
    el.textContent = out ? 'KO!' : `-${Math.max(1, Math.round(dmg))}`;
    el.style.left = `${x + (Math.random() - 0.5) * 30}px`;
    el.style.top = `${y - 10}px`;
    el.addEventListener('animationend', () => el.remove());
    this.onPop(side, dmg);
    this.host.append(el);
    for (const b of [this.bars[side], this.topBars[side]]) {
      b.classList.remove('hurt');
      void b.offsetWidth; // restart the flash
      b.classList.add('hurt');
    }
  }
}
