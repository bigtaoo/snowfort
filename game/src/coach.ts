// First-time hints: a speech bubble pointing at the thing to do next (a tray button, a catapult, the
// rival king), shown until the player does it. Each step is learned once, kept in the saves, so a
// returning player never sees it again; `?tips` in the URL shows them all again.

import { loadSave, writeSave } from './platform/saves';

export type Step = 'menu' | 'drag' | 'king' | 'done' | 'aim' | 'charge' | 'goal' | 'card' | 'repair';

/** The steps in the order a first match meets them, for the tutorial funnel. */
export const STEPS: readonly Step[] = ['menu', 'drag', 'king', 'done', 'aim', 'charge', 'goal', 'card', 'repair'];

/** Where a bubble points: a HUD element, or a screen point worked out each frame. */
export type Anchor = HTMLElement | (() => { x: number; y: number } | null);

interface Tip {
  el: HTMLElement;
  anchor: Anchor;
  /** Bubble above the anchor (arrow down) or below it (arrow up). */
  above: boolean;
  /** Seconds left, for a tip that goes away on its own. */
  ttl: number;
}

const KEY = 'snowfort.coach';

export class Coach {
  private learned = new Set<Step>();
  private tips = new Map<string, Tip>();
  /** Called once per step as it is learned, with how many are learned by then. */
  onLearn: (step: Step, learned: number) => void = () => {};

  constructor(private host: HTMLElement) {
    if (new URLSearchParams(location.search).has('tips')) return;
    try {
      for (const s of JSON.parse(loadSave(KEY) ?? '[]') as Step[]) this.learned.add(s);
    } catch { /* a broken save: every tip then shows again */ }
  }

  /** Whether the step is still to be learned. */
  needs(step: Step): boolean {
    return !this.learned.has(step);
  }

  /** Every step is learned (a returning player). */
  get finished(): boolean {
    return STEPS.every((s) => this.learned.has(s));
  }

  /**
   * Shows a bubble under `key` (one per key, so each side can have its own) unless the step is
   * learned; another step under the same key replaces it, the same step stays as it is. A tip with
   * a `ttl` is a one-off: it goes away by itself and its step counts as learned at once.
   */
  show(key: string, step: Step, html: string, anchor: Anchor, opts: { above?: boolean; side?: 0 | 1; ttl?: number } = {}): void {
    if (!this.needs(step) || this.tips.get(key)?.el.dataset.step === step) return;
    this.hide(key);
    const el = document.createElement('div');
    el.className = `coach${opts.side === undefined ? '' : ` p${opts.side}`}${opts.above === false ? ' below' : ''}`;
    el.innerHTML = html;
    el.dataset.step = step;
    this.host.append(el);
    this.tips.set(key, { el, anchor, above: opts.above !== false, ttl: opts.ttl ?? Infinity });
    this.place(this.tips.get(key)!);
    if (opts.ttl !== undefined) this.remember(step);
  }

  hide(key: string): void {
    this.tips.get(key)?.el.remove();
    this.tips.delete(key);
  }

  /** The step is learned: never shown again, and any bubble of it goes. */
  learn(step: Step): void {
    for (const [key, t] of this.tips) if (t.el.dataset.step === step) this.hide(key);
    this.remember(step);
  }

  private remember(step: Step): void {
    if (this.learned.has(step)) return;
    this.learned.add(step);
    this.onLearn(step, this.learned.size);
    writeSave(KEY, JSON.stringify([...this.learned]));
  }

  clear(): void {
    for (const key of [...this.tips.keys()]) this.hide(key);
  }

  update(dt: number): void {
    for (const [key, t] of this.tips) {
      t.ttl -= dt;
      if (t.ttl <= 0) this.hide(key);
      else this.place(t);
    }
  }

  private place(t: Tip): void {
    let p: { x: number; y: number } | null;
    if (typeof t.anchor === 'function') p = t.anchor();
    else if (t.anchor.isConnected) {
      const r = t.anchor.getBoundingClientRect();
      p = { x: r.left + r.width / 2, y: t.above ? r.top : r.bottom };
    } else p = null;
    t.el.style.display = p ? '' : 'none';
    if (!p) return;
    // keep the bubble on screen; the arrow still points at the anchor
    const w = t.el.offsetWidth;
    const x = Math.min(window.innerWidth - w / 2 - 6, Math.max(w / 2 + 6, p.x));
    t.el.style.left = `${x}px`;
    t.el.style.top = `${p.y}px`;
    t.el.style.setProperty('--arrow', `${p.x - x}px`);
  }
}
