import type { AmmoId } from './arena';
import type { MaterialId } from './config';

const MUTE_KEY = 'snowfort.muted';
/** The same sound never starts twice within this many seconds (a collapsing wall breaks many blocks at once). */
const MIN_GAP = 0.045;

/**
 * Sound effects, all synthesised with WebAudio: no files to load or license.
 * The context is created on the first key or touch (browsers keep audio locked until then).
 */
export class Sfx {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private noise!: AudioBuffer;
  private last = new Map<string, number>();
  muted: boolean;
  /** Playback rate: the slow-motion replay pitches everything down. */
  rate = 1;

  constructor() {
    let m = false;
    try { m = localStorage.getItem(MUTE_KEY) === '1'; } catch { /* storage may be blocked */ }
    this.muted = m;
    document.addEventListener('visibilitychange', () => {
      if (!this.ctx) return;
      if (document.hidden) void this.ctx.suspend();
      else void this.ctx.resume();
    });
  }

  /** Call from a user gesture. */
  unlock(): void {
    if (this.ctx) {
      if (this.ctx.state === 'suspended' && !document.hidden) void this.ctx.resume();
      return;
    }
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    this.ctx = ctx;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.ratio.value = 6;
    comp.connect(ctx.destination);
    this.master = ctx.createGain();
    this.master.gain.value = this.muted ? 0 : 0.7;
    this.master.connect(comp);
    const n = ctx.sampleRate;
    this.noise = ctx.createBuffer(1, n, n);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
  }

  setMuted(m: boolean): void {
    this.muted = m;
    try { localStorage.setItem(MUTE_KEY, m ? '1' : '0'); } catch { /* storage may be blocked */ }
    if (this.ctx) this.master.gain.setTargetAtTime(m ? 0 : 0.7, this.ctx.currentTime, 0.02);
  }

  // ---------- the game's sounds ----------

  /** Aim locked: a short ratchet click. */
  lock(): void {
    if (!this.go('lock')) return;
    this.tone(1100, 700, 0.035, 'square', 0.12);
    this.tone(1500, 900, 0.03, 'square', 0.08, 0.05);
  }

  /** Catapult throw: the arm's thunk and the ball's whoosh. */
  launch(power: number): void {
    if (!this.go('launch')) return;
    this.tone(160, 55, 0.14, 'sine', 0.55);
    this.hiss(0.32, 500, 1600 + power * 1400, 'bandpass', 0.35 + power * 0.25, 1.4, 0.02);
  }

  /** A shot's first touch. */
  impact(ammo: AmmoId): void {
    if (!this.go(`impact.${ammo}`)) return;
    switch (ammo) {
      case 'bigIce':
        this.tone(110, 40, 0.3, 'sine', 0.8);
        this.hiss(0.35, 900, 200, 'lowpass', 0.6);
        break;
      case 'firework':
        this.hiss(0.08, 3000, 1200, 'highpass', 0.6);
        this.tone(900, 120, 0.18, 'triangle', 0.35);
        for (let i = 0; i < 5; i++) this.hiss(0.03, 4000, 4000, 'highpass', 0.25, 1, 0.08 + i * 0.05 + Math.random() * 0.03);
        break;
      case 'cocoa':
        this.hiss(0.3, 1800, 500, 'bandpass', 0.5, 2);
        this.tone(500, 900, 0.12, 'sine', 0.15, 0.04);
        break;
      default:
        // the soft "pff" of packed snow
        this.hiss(0.2, 1400, 300, 'lowpass', 0.6);
        this.tone(170, 70, 0.12, 'sine', 0.4);
    }
  }

  /** A block shattering. */
  crunch(material: MaterialId): void {
    if (!this.go(`crunch.${material}`)) return;
    if (material === 'ice') {
      this.hiss(0.18, 5000, 2500, 'highpass', 0.35);
      for (let i = 0; i < 4; i++) this.tone(2200 + Math.random() * 2600, 1800 + Math.random() * 1500, 0.12, 'sine', 0.09, i * 0.03 + Math.random() * 0.02);
    } else if (material === 'wood') {
      this.tone(240, 90, 0.12, 'triangle', 0.4);
      this.hiss(0.09, 2200, 900, 'bandpass', 0.5, 3);
    } else {
      // packed snow crumbles in a few grains
      for (let i = 0; i < 3; i++) this.hiss(0.06, 1300 + Math.random() * 900, 500, 'bandpass', 0.45, 1.5, i * 0.045);
    }
  }

  /** A shot bounces off the springy fence: a wobbling "boing". */
  boing(): void {
    if (!this.go('boing')) return;
    [[160, 420], [420, 300], [300, 380], [380, 330]].forEach(([a, b], i) => this.tone(a, b, 0.09, 'sine', 0.4 - i * 0.07, i * 0.07));
  }

  /** The snow king takes a hit: a cartoon "bonk", deeper for a big one. */
  kingHit(share: number): void {
    if (!this.go('king')) return;
    const f = 520 - Math.min(1, share) * 220;
    this.tone(f, f * 0.55, 0.22, 'triangle', 0.45);
    this.tone(f * 1.5, f * 0.9, 0.12, 'sine', 0.18, 0.02);
  }

  /** A king is out: a sad trombone slide. */
  ko(): void {
    [392, 370, 349, 294].forEach((f, i) => this.tone(f, i === 3 ? f * 0.85 : f, i === 3 ? 0.6 : 0.2, 'sawtooth', 0.12, i * 0.22, 900));
  }

  /** Round start: two bell strikes. */
  bell(): void {
    this.tone(880, 880, 0.5, 'sine', 0.3);
    this.tone(1760, 1760, 0.3, 'sine', 0.08);
    this.tone(1320, 1320, 0.7, 'sine', 0.3, 0.18);
    this.tone(2640, 2640, 0.4, 'sine', 0.06, 0.18);
  }

  /** Round won: a quick arpeggio. */
  jingle(delay = 0): void {
    [523, 659, 784, 1047].forEach((f, i) => this.tone(f, f, 0.22, 'triangle', 0.28, delay + i * 0.09));
  }

  /** Match won: a longer fanfare. */
  fanfare(): void {
    const notes: [number, number, number][] = [[523, 0, 0.15], [523, 0.16, 0.15], [523, 0.32, 0.15], [659, 0.48, 0.45], [587, 0.95, 0.15], [659, 1.1, 0.15], [784, 1.26, 0.7]];
    for (const [f, t, d] of notes) {
      this.tone(f, f, d, 'triangle', 0.3, t);
      this.tone(f / 2, f / 2, d, 'sine', 0.15, t);
    }
  }

  /** Buttons and card picks. */
  click(): void {
    if (!this.go('click')) return;
    this.tone(660, 990, 0.06, 'triangle', 0.25);
  }

  /** A piece placed while building. */
  place(): void {
    if (!this.go('place')) return;
    this.tone(220, 130, 0.08, 'sine', 0.35);
    this.hiss(0.06, 900, 400, 'lowpass', 0.25);
  }

  // ---------- synth ----------

  private go(key: string): boolean {
    if (!this.ctx || this.muted) return false;
    const now = this.ctx.currentTime;
    if (now - (this.last.get(key) ?? -1) < MIN_GAP) return false;
    this.last.set(key, now);
    return true;
  }

  /** A pitch glide from f0 to f1 with a fast attack and an exponential tail. */
  private tone(f0: number, f1: number, dur: number, type: OscillatorType, gain: number, delay = 0, lowpass = 0): void {
    const ctx = this.ctx;
    if (!ctx || this.muted) return;
    const r = this.rate;
    const t = ctx.currentTime + delay / r;
    const len = dur / r;
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(f0 * r, t);
    osc.frequency.exponentialRampToValueAtTime(Math.max(20, f1 * r), t + len);
    const g = this.envelope(t, len, gain);
    if (lowpass) {
      const f = ctx.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.value = lowpass * r;
      osc.connect(f).connect(g);
    } else osc.connect(g);
    osc.start(t);
    osc.stop(t + len + 0.05);
  }

  /** Filtered noise whose filter sweeps from f0 to f1. */
  private hiss(dur: number, f0: number, f1: number, type: BiquadFilterType, gain: number, q = 1, delay = 0): void {
    const ctx = this.ctx;
    if (!ctx || this.muted) return;
    const r = this.rate;
    const t = ctx.currentTime + delay / r;
    const len = dur / r;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.playbackRate.value = r;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.Q.value = q;
    f.frequency.setValueAtTime(f0 * r, t);
    f.frequency.exponentialRampToValueAtTime(Math.max(20, f1 * r), t + len);
    src.connect(f).connect(this.envelope(t, len, gain));
    src.start(t, Math.random() * 0.5);
    src.stop(t + len + 0.05);
  }

  private envelope(t: number, len: number, gain: number): GainNode {
    const g = this.ctx!.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + Math.min(0.012, len * 0.2));
    g.gain.exponentialRampToValueAtTime(0.0001, t + len);
    g.connect(this.master);
    return g;
  }
}
