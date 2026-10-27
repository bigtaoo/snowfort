import { Vector3 } from 'three';
import {
  AMMO, ARENA, BUILD, CARDS, CATAPULT, CPU, MATERIALS, PHYSICS, PIECES, REPLAY, ROUND,
  budgetKeyOf, type Budget, type PieceId,
} from './config';
import { Arena, type Entity, type Side } from './arena';
import { View } from './view';
import { Sfx } from './audio';
import { KingHud } from './kingHud';
import { Coach, STEPS } from './coach';
import { LOCALES, getLocale, loadLocale, localeName, setLocale, t, type Key, type Locale } from './i18n';
import { Launcher, type Shot } from './launcher';
import { dealHand, type Card } from './cards';
import { CpuShooter, PRESET_FORTS, cpuPickCard, REPAIR_PLAN, type CpuLevel, type Placement } from './cpu';

type Mode = 'simul' | 'turns' | 'cpu';
type Phase = 'menu' | 'build' | 'fight' | 'roundEnd' | 'cards' | 'replay' | 'results';

interface BuildSession {
  sides: Side[];
  time: number;
  repair: boolean;
  done: [boolean, boolean];
}

interface Drag {
  side: Side;
  piece: PieceId;
  x: number;
  y: number;
  ok: boolean;
}

/** What the game tells its host portal (Playgama Bridge); no-ops anywhere else. */
export interface Portal {
  /** A match started (true) or ended or was left (false). */
  gameplay(on: boolean): void;
  /** The player beat the CPU. */
  achievement(): void;
  /** Between two matches: an interstitial, if the platform has one to show. */
  betweenMatches(): Promise<void>;
  /** One event for the platform's own telemetry. */
  track(event: string, data: Record<string, string | number | boolean>): void;
}

const NO_PORTAL: Portal = { gameplay: () => {}, achievement: () => {}, betweenMatches: async () => {}, track: () => {} };

/** A player's name and fire key in the current language. */
const nameOf = (s: Side) => t(s === 0 ? 'names.p0' : 'names.p1');
const keyOf = (s: Side) => t(s === 0 ? 'keys.p0' : 'keys.p1');
const FIRE_KEYS = ['Space', 'Enter'];
/** Where the player's own language choice is kept (else the platform's or the browser's). */
export const LANG_KEY = 'snowfort.lang';
const CARD_KEYS: string[][] = [['KeyA', 'KeyS', 'KeyD'], ['KeyJ', 'KeyK', 'KeyL']];
const CARD_LABEL = [['A', 'S', 'D'], ['J', 'K', 'L']];
const PALETTE: PieceId[] = ['snow', 'ice', 'plankH', 'plankV', 'king'];
const dirOf = (s: Side) => (s === 0 ? 1 : -1);
/** Side-relative u (distance from the middle) to world x. */
const xOf = (s: Side, u: number) => -dirOf(s) * u;
const other = (s: Side) => (1 - s) as Side;
const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', html = '') => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html) e.innerHTML = html;
  return e;
};

export class Game {
  readonly view: View;
  readonly arena: Arena;
  readonly sfx = new Sfx();
  readonly touch: boolean;
  mode: Mode = 'simul';
  cpuLevel: CpuLevel = 'normal';
  phase: Phase = 'menu';
  portal: Portal = NO_PORTAL;
  /** The platform paused the game (an ad, its own overlay): no frames run. */
  paused = false;
  private matchesPlayed = 0;
  /** When the match under way began (performance.now), null between matches. */
  private matchAt: number | null = null;
  private starting = false;
  launchers: [Launcher, Launcher] = [new Launcher(0), new Launcher(1)];
  cpu: CpuShooter | null = null;
  score: [number, number] = [0, 0];
  round = 0;
  roundTime = 0;
  /** Sim time when the deciding hit of the round landed. */
  decidedAt = 0;
  lastWinner: Side | null = null;
  timeScale = 1;
  private acc = 0;
  private budgets: [Budget, Budget] = [{ ...BUILD.budget }, { ...BUILD.budget }];
  private sessions: BuildSession[] = [];
  private session: BuildSession | null = null;
  private drags = new Map<number, Drag>();
  private firePointers = new Map<number, Side>();
  private cpuBuildQueue: Placement[] = [];
  private cpuBuildTimer = 0;
  /** The card the CPU will take when its pick time runs out. */
  private cpuCard: number | null = null;
  private cardClockEl = el('div', 'cardClock', '');
  private bannerTimer = 0;
  private cardQueue: Side[] = [];
  private hand: Card[] = [];
  private cardTime = 0;
  private pending: [Card[], Card[]] = [[], []];
  /** Alternate-turn mode: whose shot it is, and how long since they fired. */
  private turn: Side = 0;
  private turnFiredAt: number | null = null;
  /** Each side's latest shot, traced until it first touches something. */
  private trailBall: (Entity | null)[] = [null, null];
  private trailNext = [0, 0];
  private replayT = 0;
  private replayLoser: Side = 0;
  private winnerOfMatch: Side = 0;

  // HUD
  private hud = document.getElementById('hud')!;
  private topEl = el('div', 'top');
  private pinfo: { root: HTMLElement; label: HTMLElement; pips: HTMLElement; bar: HTMLElement; status: HTMLElement }[] = [];
  private kingHud!: KingHud;
  private coach!: Coach;
  /** Who has thrown in this match: the aiming tips stay until each player has. */
  private thrown = [false, false];
  private clockEl = el('div', 'clock');
  private subEl = el('div', 'sub');
  private bannerEl = el('div', 'banner');
  private overlayEl = el('div', 'overlay');
  private paletteEls: HTMLElement[] = [];
  private timerChips: HTMLElement[] = [];
  private keyEls: HTMLElement[] = [];
  private muteEl = el('button', 'mute on');

  constructor(host: HTMLElement) {
    this.view = new View(host);
    this.arena = new Arena(this.view.scene);
    this.touch = matchMedia('(pointer: coarse)').matches || new URLSearchParams(location.search).has('touch');
    this.buildHud();
    this.bindInput();
    this.showMenu();
    (window as unknown as { __sf: Game }).__sf = this;
  }

  // =====================================================================
  // loop
  // =====================================================================

  frame(realDt: number): void {
    const dt = Math.min(realDt, 0.1);
    this.acc += dt * this.timeScale;
    let n = 0;
    while (this.acc >= PHYSICS.dt && n < PHYSICS.maxSubSteps) {
      this.acc -= PHYSICS.dt;
      n++;
      if (this.phase === 'fight') this.fightStep(PHYSICS.dt);
      this.arena.step();
      this.sfx.rate = this.phase === 'replay' ? this.timeScale : 1;
      for (const imp of this.arena.impacts) {
        this.view.puff.burst(new Vector3(imp.x, imp.y, 0), 24);
        this.sfx.impact(imp.ammo);
        if (imp.spring) this.sfx.boing();
      }
      for (const h of this.arena.kingHits) this.kingHud.hit(h.owner, h.dmg);
      if (this.phase === 'fight') this.afterStep();
      for (const m of this.arena.breaks) this.sfx.crunch(m);
      if (this.phase === 'replay' && this.arena.time - this.decidedAt > REPLAY.simSeconds - REPLAY.leadSeconds) this.endReplay();
    }
    if (n === PHYSICS.maxSubSteps) this.acc = 0;
    this.arena.sync();
    this.view.puff.update(dt * this.timeScale);
    this.update(dt);
    this.view.updateSnow(dt, this.phase === 'fight' && this.roundTime > ROUND.blizzardAfter ? 1 : 0);
    this.view.render(dt);
  }

  private update(dt: number): void {
    this.kingHud.update(dt, this.arena, this.view, this.phase === 'fight' || this.phase === 'roundEnd');
    if (this.phase !== 'replay') this.view.setBottomInset(this.trayStrip(), dt);
    switch (this.phase) {
      case 'build': this.updateBuild(dt); break;
      case 'roundEnd':
        this.bannerTimer -= dt;
        if (this.bannerTimer <= 0) this.afterRoundBanner();
        break;
      case 'cards':
        this.cardTime -= dt;
        // the last few seconds count down, so a random pick never comes as a surprise
        this.cardClockEl.textContent = this.cardTime < 6 && !(this.mode === 'cpu' && this.cardQueue[0] === 1)
          ? t('cards.randomIn', { n: Math.ceil(this.cardTime) }) : '';
        if (this.cardTime <= 0) this.pickCard(this.cpuCard ?? Math.floor(Math.random() * 3));
        break;
      case 'replay': {
        this.replayT += dt;
        const total = REPLAY.simSeconds / REPLAY.timeScale;
        this.view.orbit(Math.min(1, this.replayT / total), this.replayLoser === 0 ? -10 : 10, REPLAY.orbitRadius, REPLAY.orbitHeight);
        break;
      }
      default: break;
    }
    if (this.bannerTimer > 0 && this.phase !== 'roundEnd') {
      this.bannerTimer -= dt;
      if (this.bannerTimer <= 0) this.bannerEl.innerHTML = '';
    }
    const fighting = this.phase === 'fight' || this.phase === 'roundEnd';
    this.view.showTrails(fighting);
    for (const s of [0, 1] as Side[]) {
      const b = this.trailBall[s];
      if (!fighting || !b) continue;
      if (!b.alive || b.hitAt !== undefined) { this.trailBall[s] = null; continue; }
      if (this.arena.time < this.trailNext[s]) continue;
      const p = b.body.translation();
      this.view.addTrailDot(s, p.x, p.y);
      this.trailNext[s] = this.arena.time + 0.05;
    }
    for (const s of [0, 1] as Side[]) {
      const l = this.launchers[s];
      const showAim = this.phase === 'fight';
      this.view.setCatapult(s, l.angle, l.phase === 'charge' ? l.power : null, l.phase === 'charge', showAim && l.ready);
    }
    if (this.phase === 'fight') this.fightTips();
    this.coach.update(dt);
    this.updateHud();
  }

  // =====================================================================
  // menu / match flow
  // =====================================================================

  private showMenu(): void {
    this.phase = 'menu';
    this.portal.gameplay(false);
    this.hideTop();
    this.clearPalettes();
    this.overlay(true);
    this.coach.clear();
    if (this.matchAt !== null) this.trackEnd('progression_failed', { reason: 'left' });
    const o = this.overlayEl;
    o.innerHTML = '';
    o.append(el('h1', 'title', 'Snow Fort Showdown'));
    const menu = el('div', 'menu');
    const add = (label: string, fn: () => void, cls = 'btn') => {
      const b = el('button', cls, label);
      b.onclick = () => { this.sfx.click(); fn(); };
      return b;
    };
    menu.append(add(t('menu.simul'), () => this.begin('simul'), 'btn big'));
    menu.append(add(t('menu.turns'), () => this.begin('turns')));
    const row = el('div', 'row');
    for (const lv of Object.keys(CPU.levels) as CpuLevel[]) {
      const b = add(t('menu.cpu', { level: t(`menu.${lv}`) }), () => { this.cpuLevel = lv; this.begin('cpu'); });
      // a first-timer is pointed at the gentlest way in
      if (lv === 'easy' && this.coach.needs('menu')) {
        b.classList.add('coachMark');
        b.prepend(el('span', 'startHere', t('menu.startHere')));
      }
      row.append(b);
    }
    menu.append(row);
    o.append(menu);
    o.append(el('div', 'help', this.touch
      ? t('menu.helpTouch')
      : t('menu.helpKeys', { red: `<b>${nameOf(0)}</b>`, space: `<kbd>${keyOf(0)}</kbd>`, blue: `<b>${nameOf(1)}</b>`, enter: `<kbd>${keyOf(1)}</kbd>` })));
    o.append(this.languagePicker());
  }

  /** The language list on the menu; a pick is kept and the screen redrawn in it. */
  private languagePicker(): HTMLElement {
    const pick = el('select', 'lang');
    pick.title = t('common.language');
    for (const l of LOCALES) {
      const opt = el('option', '', localeName(l));
      opt.value = l;
      opt.selected = l === getLocale();
      pick.append(opt);
    }
    pick.onchange = async () => {
      const l = pick.value as Locale;
      if (!(await loadLocale(l))) return void (pick.value = getLocale());
      setLocale(l);
      try { localStorage.setItem(LANG_KEY, l); } catch { /* storage may be blocked */ }
      this.relabel();
      this.showMenu();
    };
    return pick;
  }

  /** The HUD text that is set once, again in the current language. */
  private relabel(): void {
    this.pinfo.forEach((info, side) => { info.label.textContent = nameOf(side as Side); });
    this.muteEl.title = t('common.sound');
    const rotate = document.getElementById('rotate');
    if (rotate) rotate.textContent = t('common.rotate');
  }

  /** A match from a button: after the first one the platform may show an ad in between. */
  private async begin(mode: Mode): Promise<void> {
    if (this.starting) return;
    this.starting = true;
    this.mode = mode;
    this.coach.learn('menu');
    try {
      if (this.matchesPlayed > 0) await this.portal.betweenMatches();
    } finally {
      this.starting = false;
    }
    this.startMatch(mode);
  }

  startMatch(mode: Mode): void {
    this.portal.gameplay(true);
    this.mode = mode;
    this.arena.reset();
    this.view.puff.clear();
    this.kingHud.clear();
    this.view.homeCamera();
    this.timeScale = 1;
    this.score = [0, 0];
    this.round = 0;
    this.pending = [[], []];
    this.lastWinner = null;
    this.thrown = [false, false];
    this.matchAt = performance.now();
    this.portal.track('progression_started', this.matchFields());
    this.cpu = mode === 'cpu' ? new CpuShooter(1, this.cpuLevel) : null;
    this.arena.damageMul = mode === 'turns' ? CATAPULT.turnDamageMul : 1;
    this.launchers = [new Launcher(0), new Launcher(1)];
    this.budgets = [{ ...BUILD.budget }, { ...BUILD.budget }];
    this.overlay(false);
    this.showTop();
    const simultaneous = this.touch;
    if (mode === 'cpu') {
      this.queueCpuBuild(PRESET_FORTS[Math.floor(Math.random() * PRESET_FORTS.length)]);
      // against the CPU there is no clock: the player builds until they press Done
      this.sessions = [{ sides: [0], time: Infinity, repair: false, done: [false, true] }];
    } else if (simultaneous) {
      this.sessions = [{ sides: [0, 1], time: BUILD.simultaneousSeconds, repair: false, done: [false, false] }];
    } else {
      this.sessions = [
        { sides: [0], time: BUILD.turnSeconds, repair: false, done: [false, true] },
        { sides: [1], time: BUILD.turnSeconds, repair: false, done: [true, false] },
      ];
    }
    this.phase = 'build';
    this.nextSession();
  }

  /** What every telemetry event says about the match: its mode as the step, and the input. */
  private matchFields(): Record<string, string | number | boolean> {
    const step_id = this.mode === 'cpu' ? `cpu_${this.cpuLevel}` : this.mode;
    return { step_id, mode: this.mode, touch: this.touch, match_index: this.matchesPlayed + 1, new_player: !this.coach.finished };
  }

  /** A match's end, finished or left: how long it ran and how far it got. */
  private trackEnd(event: string, extra: Record<string, string | number | boolean>): void {
    if (this.matchAt === null) return;
    const duration_sec = Math.round((performance.now() - this.matchAt) / 1000);
    this.matchAt = null;
    this.portal.track(event, { ...this.matchFields(), duration_sec, rounds: this.round, score: `${this.score[0]}-${this.score[1]}`, ...extra });
  }

  // =====================================================================
  // building
  // =====================================================================

  private nextSession(): void {
    this.cancelDrags();
    const s = this.sessions.shift();
    if (!s) return this.endBuilding();
    this.session = s;
    this.view.highlightZones(s.sides);
    this.makePalettes(s);
    const who = s.sides.length === 2 ? t('build.both') : nameOf(s.sides[0]);
    this.banner(t(s.repair ? 'build.repair' : 'build.build', { who }), t(s.sides.length === 2 ? 'build.dragOwn' : 'build.dragTray'), 2);
    this.buildTips();
  }

  /** The next thing to learn in building, pointed at on each builder's tray. */
  private buildTips(): void {
    const s = this.session;
    if (!s) return;
    for (const side of s.sides) {
      const pal = this.paletteEls[side];
      const key = `build${side}`;
      if (!pal || s.done[side]) { this.coach.hide(key); continue; }
      const button = (sel: string) => pal.querySelector<HTMLElement>(sel)!;
      const opts = { side };
      if (s.repair) this.coach.show(key, 'repair', t('coach.repair'), button('.done'), opts);
      else if (this.coach.needs('drag')) this.coach.show(key, 'drag', t('coach.drag'), button('[data-piece="snow"]'), opts);
      else if (this.budgets[side].king > 0) this.coach.show(key, 'king', t('coach.king'), button('[data-piece="king"]'), opts);
      else this.coach.show(key, 'done', t('coach.done'), button('.done'), opts);
    }
  }

  private endSession(): void {
    this.coach.clear();
    // whoever never placed their king gets one dropped in for them
    for (const side of this.session?.sides ?? []) if (this.budgets[side].king > 0) this.autoPlaceKing(side);
    this.session = null;
    this.nextSession();
  }

  private endBuilding(): void {
    this.view.highlightZones([]);
    this.clearPalettes();
    // flush any CPU placements still queued
    while (this.cpuBuildQueue.length) this.cpuPlaceNext();
    for (const side of [0, 1] as Side[]) this.ensureKing(side);
    if (this.round === 0) this.saveBlueprints();
    if (this.round === 0) this.startRound();
    else this.startCards();
  }

  private updateBuild(dt: number): void {
    if (this.cpuBuildQueue.length) {
      this.cpuBuildTimer -= dt;
      while (this.cpuBuildTimer <= 0 && this.cpuBuildQueue.length) {
        this.cpuBuildTimer += CPU.buildDropInterval;
        this.cpuPlaceNext();
      }
    }
    const s = this.session;
    if (!s) return;
    s.time -= dt;
    for (const d of this.drags.values()) this.updateDragGhost(d);
    if (s.time <= 0 || s.sides.every((side) => s.done[side])) this.endSession();
  }

  private queueCpuBuild(plan: Placement[]): void {
    this.cpuBuildQueue.push(...plan);
    this.cpuBuildTimer = 0.4;
  }

  private cpuPlaceNext(): void {
    const p = this.cpuBuildQueue.shift();
    if (p) this.placeFromPlan(1, p);
  }

  /** Places a planned piece if the side's budget allows. */
  private placeFromPlan(side: Side, p: Placement): Entity | null {
    const key = budgetKeyOf(p.piece);
    if (this.budgets[side][key] <= 0) return null;
    const spot = this.dropSpot(side, p.piece, xOf(side, p.u), p.y ?? ARENA.groundY);
    if (!spot) return null;
    this.budgets[side][key]--;
    return this.arena.addPiece(p.piece, side, spot.x, spot.y);
  }

  /** Lowest free spot at or above (x, y) for a piece, inside the side's zone; null if none. */
  private dropSpot(side: Side, piece: PieceId, x: number, y: number): { x: number; y: number } | null {
    const spec = PIECES[piece];
    const u = Math.max(ARENA.zoneNear + spec.hx, Math.min(ARENA.zoneFar - spec.hx, x * -dirOf(side)));
    const cx = xOf(side, u);
    let cy = Math.max(y, ARENA.groundY + spec.hy + 0.01);
    while (cy < ARENA.buildCeiling) {
      if (!this.arena.overlaps(piece, cx, cy)) return { x: cx, y: cy };
      cy += BUILD.liftStep;
    }
    return null;
  }

  /** Puts a king back on the hill if it is missing or fell off while building. */
  private ensureKing(side: Side): void {
    const k = this.arena.king(side);
    if (k && k.body.translation().y > ARENA.fallY && k.body.translation().x * -dirOf(side) > ARENA.edgeX) return;
    if (k) this.arena.remove(k);
    this.arena.ents = this.arena.ents.filter((e) => e.alive);
    this.budgets[side].king = 1;
    this.autoPlaceKing(side);
  }

  private autoPlaceKing(side: Side): void {
    for (const u of [10, 11, 12, 9, 13, 8, 14]) {
      if (this.placeFromPlan(side, { piece: 'king', u })) return;
    }
  }

  private canBuild(side: Side): boolean {
    return this.phase === 'build' && !!this.session && this.session.sides.includes(side) && !this.session.done[side] && !(this.mode === 'cpu' && side === 1);
  }

  private startDrag(pointerId: number, side: Side, piece: PieceId, cx: number, cy: number): void {
    const w = this.view.toWorld(cx, cy);
    const d: Drag = { side, piece, x: w.x, y: w.y, ok: false };
    this.drags.set(pointerId, d);
    this.updateDragGhost(d, pointerId);
  }

  private updateDragGhost(d: Drag, key?: number): void {
    const id = key ?? [...this.drags.entries()].find(([, v]) => v === d)?.[0] ?? 0;
    const onSide = d.x * -dirOf(d.side) > ARENA.edgeX - 1;
    const spot = onSide ? this.dropSpot(d.side, d.piece, d.x, d.y - PIECES[d.piece].hy) : null;
    d.ok = !!spot;
    this.view.showGhost(id, d.piece, spot?.x ?? d.x, spot?.y ?? d.y, d.ok);
  }

  private endDrag(pointerId: number): void {
    const d = this.drags.get(pointerId);
    if (!d) return;
    this.drags.delete(pointerId);
    this.view.showGhost(pointerId, null);
    if (!this.canBuild(d.side)) return;
    const key = budgetKeyOf(d.piece);
    if (this.budgets[d.side][key] <= 0) return;
    const onSide = d.x * -dirOf(d.side) > ARENA.edgeX - 1;
    const spot = onSide ? this.dropSpot(d.side, d.piece, d.x, d.y - PIECES[d.piece].hy) : null;
    if (!spot) return;
    this.budgets[d.side][key]--;
    this.arena.addPiece(d.piece, d.side, spot.x, spot.y);
    this.sfx.place();
    this.refreshPalettes();
    this.coach.learn('drag');
    if (d.piece === 'king') this.coach.learn('king');
    this.buildTips();
  }

  private cancelDrags(): void {
    for (const id of this.drags.keys()) this.view.showGhost(id, null);
    this.drags.clear();
  }

  /** Removes all of a side's own pieces, refunding them. */
  private clearFort(side: Side): void {
    for (const e of [...this.arena.ents]) {
      if (e.owner === side && (e.kind === 'block' || e.kind === 'king')) {
        this.budgets[side][budgetKeyOf(e.piece!)]++;
        this.arena.remove(e);
      }
    }
    this.arena.ents = this.arena.ents.filter((e) => e.alive);
  }

  private loadPlan(side: Side, plan: Placement[]): void {
    this.clearFort(side);
    for (const p of plan) this.placeFromPlan(side, p);
    this.refreshPalettes();
    this.coach.learn('drag');
    this.coach.learn('king');
    this.buildTips();
  }

  private saveBlueprints(): void {
    for (const side of [0, 1] as Side[]) {
      if (this.mode === 'cpu' && side === 1) continue;
      const plan: Placement[] = this.arena.ents
        .filter((e) => e.owner === side && (e.kind === 'block' || e.kind === 'king'))
        .map((e) => { const p = e.body.translation(); return { piece: e.piece!, u: -dirOf(side) * p.x, y: p.y - PIECES[e.piece!].hy }; })
        .sort((a, b) => a.y! - b.y!);
      try { localStorage.setItem(`snowfort.blueprint2.${side}`, JSON.stringify(plan)); } catch { /* storage may be blocked */ }
    }
  }

  private loadBlueprint(side: Side): Placement[] | null {
    try {
      const s = localStorage.getItem(`snowfort.blueprint2.${side}`);
      return s ? (JSON.parse(s) as Placement[]) : null;
    } catch { return null; }
  }

  private makePalettes(s: BuildSession): void {
    this.clearPalettes();
    for (const side of s.sides) {
      if (this.mode === 'cpu' && side === 1) continue;
      const pal = el('div', `palette on p${side}`);
      for (const piece of PALETTE) {
        const spec = PIECES[piece];
        const b = el('button', '', `<span class="sw" style="background:#${(spec.material === 'king' ? 0xffffff : MATERIALS[spec.material].color).toString(16).padStart(6, '0')};${piece === 'plankV' ? 'width:8px;height:22px' : piece === 'plankH' ? 'height:7px;width:30px' : ''}"></span>${t(`pieces.${piece}`)}<span class="n"></span>`);
        b.dataset.piece = piece;
        b.onpointerdown = (ev) => {
          ev.preventDefault();
          if (!this.canBuild(side) || this.budgets[side][budgetKeyOf(piece)] <= 0) return;
          this.startDrag(ev.pointerId, side, piece, ev.clientX, ev.clientY);
        };
        pal.append(b);
      }
      if (!s.repair) {
        const bp = this.loadBlueprint(side);
        if (bp) {
          const b = el('button', '', t('build.lastFort'));
          b.onclick = () => this.loadPlan(side, bp);
          pal.append(b);
        }
        const r = el('button', '', t('build.randomFort'));
        r.onclick = () => this.loadPlan(side, PRESET_FORTS[Math.floor(Math.random() * PRESET_FORTS.length)]);
        pal.append(r);
      }
      const done = el('button', 'done', t('build.done'));
      done.onclick = () => {
        if (!this.session) return;
        this.session.done[side] = true;
        this.coach.learn(s.repair ? 'repair' : 'done');
        this.buildTips();
      };
      pal.append(done);
      this.hud.append(pal);
      this.paletteEls[side] = pal;
      if (!Number.isFinite(s.time)) continue;
      const chip = el('div', `timerChip p${side}`);
      this.hud.append(chip);
      this.timerChips[side] = chip;
    }
    this.refreshPalettes();
  }

  private refreshPalettes(): void {
    for (const side of [0, 1] as Side[]) {
      const pal = this.paletteEls[side];
      if (!pal) continue;
      pal.querySelectorAll<HTMLButtonElement>('button[data-piece]').forEach((b) => {
        const n = this.budgets[side][budgetKeyOf(b.dataset.piece as PieceId)];
        b.querySelector('.n')!.textContent = `×${n}`;
        b.disabled = n <= 0;
      });
    }
  }

  /** Screen pixels the build trays (and their timers) take at the bottom, which the camera keeps clear. */
  private trayStrip(): number {
    let top = window.innerHeight;
    for (const e of [...this.paletteEls, ...this.timerChips]) if (e) top = Math.min(top, e.getBoundingClientRect().top);
    return top < window.innerHeight ? window.innerHeight - top + 6 : 0;
  }

  private clearPalettes(): void {
    for (const p of [...this.paletteEls, ...this.timerChips]) p?.remove();
    this.paletteEls = [];
    this.timerChips = [];
  }

  // =====================================================================
  // fighting
  // =====================================================================

  private startRound(): void {
    this.round++;
    this.roundTime = 0;
    this.arena.wind = [0, 0];
    for (const l of this.launchers) {
      l.resetForRound();
      l.reloadMul = 1;
      l.ammo = [];
      l.tripleNext = false;
    }
    for (const side of [0, 1] as Side[]) {
      for (const c of this.pending[side]) this.applyCard(side, c);
      this.pending[side] = [];
    }
    for (const e of this.arena.ents) if (e.kind === 'king') e.impact = 0;
    this.kingHud.clear();
    this.turn = this.lastWinner === null ? 0 : other(this.lastWinner);
    this.turnFiredAt = null;
    this.trailBall = [null, null];
    this.view.clearTrail();
    this.setArmed();
    this.phase = 'fight';
    this.firePointers.clear();
    this.showKeys(true);
    this.sfx.bell();
    this.banner(t('fight.round', { n: this.round }), this.mode === 'turns' ? t('fight.firstTurn', { name: nameOf(this.turn) }) : t('fight.fireAtWill'), 1.6);
  }

  private setArmed(): void {
    for (const l of this.launchers) l.armed = this.mode !== 'turns' || l.side === this.turn;
  }

  private applyCard(side: Side, c: Card): void {
    const rival = other(side);
    switch (c.id) {
      case 'iceWall':
        for (let i = 0; i < 3; i++) this.arena.addPiece('ice', side, xOf(side, ARENA.zoneNear + 0.6), ARENA.groundY + 0.5 + i * 1.02 + 4);
        break;
      case 'roof': {
        const k = this.arena.king(side);
        if (k) { const p = k.body.translation(); this.arena.addPiece('plankH', side, p.x, Math.max(p.y + 3, this.dropSpot(side, 'plankH', p.x, p.y + 1.2)?.y ?? p.y + 3)); }
        break;
      }
      case 'spring': {
        // on the strip between the cliff and the build zone, which nothing else uses; a new one replaces the old
        for (const e of this.arena.ents) if (e.alive && e.spring && e.owner === side) this.arena.remove(e);
        this.arena.ents = this.arena.ents.filter((e) => e.alive);
        this.arena.addPiece('plankV', side, xOf(side, ARENA.edgeX + PIECES.plankV.hx - 0.01), ARENA.groundY + PIECES.plankV.hy + 0.02, false, true);
        break;
      }
      case 'decoy': {
        const k = this.arena.king(side);
        const ku = k ? -dirOf(side) * k.body.translation().x : 10;
        for (const u of [ku - 3, ku + 3, 7, 13]) {
          const spot = this.dropSpot(side, 'king', xOf(side, u), ARENA.groundY);
          if (spot) { this.arena.addPiece('king', side, spot.x, spot.y, true); break; }
        }
        break;
      }
      case 'wind':
        this.arena.wind[rival] = -dirOf(rival) * CARDS.windForce;
        break;
      case 'slowReload':
        this.launchers[rival].reloadMul = CARDS.slowReloadMul;
        break;
      case 'triple':
        this.launchers[side].tripleNext = true;
        break;
      default:
        if (c.ammo) for (let i = 0; i < AMMO.shotsPerCard; i++) this.launchers[side].ammo.push(c.ammo);
    }
  }

  private fightStep(dt: number): void {
    this.roundTime += dt;
    // card pieces dropped in at round start settle before anything can get hurt
    this.arena.damageOn = this.roundTime > ROUND.damageGraceSeconds;
    for (const l of this.launchers) l.update(dt);
    if (this.cpu) {
      const l = this.launchers[1];
      const act = this.cpu.update(dt, l, this.arena);
      if (act.press) this.press(1);
      if (act.release) this.fire(l.release());
    }
    if (this.mode === 'turns' && this.turnFiredAt !== null) {
      // hand over as soon as the shot has landed (split and triple shots: all of it)
      const mine = this.arena.ents.filter((e) => e.kind === 'projectile' && e.owner === this.turn);
      const landed = mine.every((e) => e.hitAt !== undefined && this.arena.time - e.hitAt > CATAPULT.turnAfterLanding);
      const since = this.arena.time - this.turnFiredAt;
      if ((landed && since > 0.5) || since > CATAPULT.turnSettleSeconds) {
        this.turn = other(this.turn);
        this.turnFiredAt = null;
        const next = this.launchers[this.turn];
        // a frozen catapult stays frozen into its turn
        if (!next.frozen) next.phase = 'sweep';
        this.setArmed();
      }
    }
  }

  /** Each player's aiming tip over their catapult, until they have thrown once. */
  private fightTips(): void {
    for (const side of [0, 1] as Side[]) {
      if (this.cpu && side === 1) continue;
      const key = `fight${side}`;
      const l = this.launchers[side];
      if (this.thrown[side] || !l.ready) { this.coach.hide(key); continue; }
      const at = () => this.view.toScreen(xOf(side, CATAPULT.x), CATAPULT.pivotY + 2.4);
      const opts = { side };
      if (l.phase === 'charge') {
        this.coach.show(key, 'charge', t(this.touch ? 'coach.chargeTouch' : 'coach.chargeKey'), at, opts);
      } else {
        const text = !this.touch ? t('coach.aimKey', { key: `<kbd>${keyOf(side)}</kbd>` })
          : t(this.cpu ? 'coach.aimTouch' : side === 0 ? 'coach.aimLeft' : 'coach.aimRight');
        this.coach.show(key, 'aim', text, at, opts);
      }
    }
  }

  /** A player's first throw of the match: once everyone has thrown, aiming is learned; then the goal. */
  private afterFirstThrow(side: Side): void {
    if (this.thrown[side]) return;
    this.thrown[side] = true;
    const humans: Side[] = this.cpu ? [0] : [0, 1];
    if (humans.every((h) => this.thrown[h])) {
      this.coach.learn('aim');
      this.coach.learn('charge');
    }
    const rival = other(side);
    this.coach.show('goal', 'goal', t('coach.goal', { name: nameOf(rival) }), () => {
      const k = this.arena.king(rival);
      if (!k) return null;
      const p = k.body.translation();
      return this.view.toScreen(p.x, p.y + 1.7);
    }, { side, ttl: 6 });
  }

  /** Locks a launcher's aim, with a click if it took. */
  private press(side: Side): void {
    const l = this.launchers[side];
    const was = l.phase;
    l.press();
    if (was !== 'charge' && l.phase === 'charge') this.sfx.lock();
  }

  private fire(shot: Shot | null): void {
    if (!shot) return;
    this.sfx.launch((shot.speed - CATAPULT.minSpeed) / (CATAPULT.maxSpeed - CATAPULT.minSpeed));
    const dir = dirOf(shot.side);
    const massMul = this.roundTime > ROUND.blizzardAfter
      ? Math.min(ROUND.blizzardMaxMass, 1 + (this.roundTime - ROUND.blizzardAfter) * ROUND.blizzardMassPerSecond)
      : 1;
    const angles = shot.triple ? [-1, 0, 1].map((k) => shot.angle + k * CARDS.tripleSpreadDeg * Math.PI / 180) : [shot.angle];
    const speed = shot.ammo === 'firework' ? shot.speed * AMMO.firework.speedMul : shot.speed;
    const balls = angles.map((a) => {
      const m = Arena.muzzle(shot.side, a);
      return this.arena.addProjectile(shot.side, shot.ammo, m.x, m.y, dir * Math.cos(a) * speed, Math.sin(a) * speed, massMul);
    });
    this.trailBall[shot.side] = balls[Math.floor(balls.length / 2)];
    if (!(this.cpu && shot.side === 1)) this.afterFirstThrow(shot.side);
    this.trailNext[shot.side] = 0;
    this.view.clearTrail(shot.side);
    if (this.mode === 'turns') {
      this.turnFiredAt = this.arena.time;
      this.launchers[shot.side].armed = false;
    }
  }

  /** After each physics step: special ammo effects and the round's end. */
  private afterStep(): void {
    for (const imp of this.arena.impacts) {
      if (imp.ammo === 'cocoa') this.melt(imp.x, imp.y);
      if (imp.ammo === 'bigIce') this.view.shake(0.18);
      const rival = other(imp.owner);
      if (imp.ammo === 'frost' && imp.x * -dirOf(rival) > ARENA.edgeX) {
        this.launchers[rival].freeze(AMMO.frost.freezeSeconds);
        this.sfx.crunch('ice');
      }
    }
    const lost = ([0, 1] as Side[]).filter((s) => this.kingDown(s));
    if (lost.length) this.endRound(lost);
  }

  private melt(x: number, y: number): void {
    for (const e of this.arena.ents) {
      if (!e.alive || e.kind !== 'block') continue;
      const p = e.body.translation();
      if (Math.hypot(p.x - x, p.y - y) > AMMO.cocoa.meltRadius) continue;
      const mat = PIECES[e.piece!].material;
      if (mat === 'ice') this.arena.breakBlock(e);
      else if (mat === 'snow') e.hp -= AMMO.cocoa.snowDamage;
    }
    this.arena.ents = this.arena.ents.filter((e) => e.alive);
  }

  kingDown(side: Side): boolean {
    const k = this.arena.king(side);
    if (!k) return true;
    const p = k.body.translation();
    return p.y < ARENA.fallY || p.x * -dirOf(side) > ARENA.yardEnd || (k.impact ?? 0) >= MATERIALS.king.hp;
  }

  private endRound(lost: Side[]): void {
    this.phase = 'roundEnd';
    this.coach.clear();
    this.decidedAt = this.arena.time;
    this.showKeys(false);
    for (const l of this.launchers) { if (l.phase === 'charge') l.phase = 'sweep'; }
    this.bannerTimer = ROUND.endBannerSeconds;
    this.sfx.ko();
    if (lost.length === 2) {
      this.lastWinner = null;
      this.bannerEl.innerHTML = `${t('fight.bothDown')}<small>${t('fight.replayRound')}</small>`;
      return;
    }
    const winner = other(lost[0]);
    this.lastWinner = winner;
    this.score[winner]++;
    this.sfx.jingle(1);
    const k = this.arena.king(lost[0]);
    const kp = k?.body.translation();
    const how: Key = !kp || kp.y < ARENA.fallY ? 'fight.offHill'
      : kp.x * -dirOf(lost[0]) > ARENA.yardEnd ? 'fight.pushedOut' : 'fight.knockedOut';
    this.bannerEl.innerHTML = `${t('fight.takes', { name: nameOf(winner) })}<small>${t(how, { name: nameOf(lost[0]) })}</small>`;
  }

  private afterRoundBanner(): void {
    this.bannerEl.innerHTML = '';
    if (this.score[0] >= ROUND.winsNeeded || this.score[1] >= ROUND.winsNeeded) return this.startReplay();
    this.cleanupBetweenRounds();
    const loser = this.lastWinner === null ? 0 : other(this.lastWinner);
    const order: Side[] = this.lastWinner === null ? [0, 1] : [loser, this.lastWinner];
    for (const s of [0, 1] as Side[]) {
      const b: Budget = { ...BUILD.repairBudget };
      b.king = this.arena.king(s) ? 0 : 1;
      this.budgets[s] = b;
    }
    if (this.mode === 'cpu') {
      for (const p of REPAIR_PLAN) this.placeFromPlan(1, p);
      if (this.budgets[1].king) this.autoPlaceKing(1);
      this.sessions = [{ sides: [0], time: Infinity, repair: true, done: [false, true] }];
    } else if (this.touch) {
      this.sessions = [{ sides: [0, 1], time: BUILD.repairSimultaneousSeconds, repair: true, done: [false, false] }];
    } else {
      this.sessions = order.map((s) => ({ sides: [s], time: BUILD.repairTurnSeconds, repair: true, done: [s !== 0, s !== 1] as [boolean, boolean] }));
    }
    this.phase = 'build';
    this.arena.damageOn = false;
    this.nextSession();
  }

  /** Clears shots and debris, and takes away blocks that fell off their hill and kings out of their zone. */
  private cleanupBetweenRounds(): void {
    for (const e of [...this.arena.ents]) {
      if (!e.alive) continue;
      const p = e.body.translation();
      const u = p.x * -dirOf(e.owner);
      // a king shoved out of his build zone goes back to the tray, so next round does not start one bump from losing
      const fallen = p.y < ARENA.fallY || u < ARENA.edgeX || (e.kind === 'king' && (u < ARENA.zoneNear || u > ARENA.zoneFar));
      if (e.kind === 'projectile' || e.kind === 'debris' || e.kind === 'decoy' || fallen) this.arena.remove(e);
      else if (e.kind === 'king' && (e.impact ?? 0) >= MATERIALS.king.hp) this.arena.remove(e);
    }
    this.arena.ents = this.arena.ents.filter((e) => e.alive);
  }

  // =====================================================================
  // cards
  // =====================================================================

  private startCards(): void {
    const loser = this.lastWinner === null ? 0 : other(this.lastWinner);
    this.cardQueue = this.lastWinner === null ? [0, 1] : [loser, this.lastWinner];
    this.phase = 'cards';
    this.nextCardPick();
  }

  private nextCardPick(): void {
    const side = this.cardQueue[0];
    if (side === undefined) {
      this.overlay(false);
      return this.startRound();
    }
    this.hand = dealHand();
    this.cardTime = ROUND.cardPickSeconds;
    this.bannerEl.innerHTML = '';
    this.bannerTimer = 0;
    const o = this.overlayEl;
    o.innerHTML = '';
    o.className = `overlay p${side}`;
    this.overlay(true);
    o.append(el('div', 'who', t(this.lastWinner === other(side) ? 'cards.pickLoser' : 'cards.pick', { name: nameOf(side) })));
    this.cardClockEl = el('div', 'cardClock', '');
    const row = el('div', 'cards');
    this.hand.forEach((c, i) => {
      const card = el('div', 'card', `<div class="ic">${c.icon}</div><div class="kd">${t(`cards.${c.kind}`)}</div><div class="nm">${t(`cards.${c.id}.name`)}</div><div class="tx">${t(`cards.${c.id}.text`)}</div>${this.touch ? '' : `<kbd>${CARD_LABEL[side][i]}</kbd>`}`);
      card.onclick = () => this.pickCard(i);
      row.append(card);
    });
    o.append(row, this.cardClockEl);
    if (!(this.mode === 'cpu' && side === 1)) this.coach.show('card', 'card', t('coach.card'), row, { side, above: false });
    this.cpuCard = null;
    if (this.mode === 'cpu' && side === 1) {
      this.cardTime = 1.2;
      const blocks = (s: Side) => this.arena.ents.filter((e) => e.alive && e.kind === 'block' && e.owner === s).length;
      this.cpuCard = cpuPickCard(this.hand, this.cpuLevel, this.score[1] < this.score[0], blocks(1) / Math.max(1, blocks(0)));
    }
  }

  private pickCard(i: number): void {
    if (this.phase !== 'cards') return;
    const side = this.cardQueue.shift()!;
    this.sfx.click();
    if (!(this.mode === 'cpu' && side === 1)) this.coach.learn('card');
    this.pending[side].push(this.hand[i]);
    this.nextCardPick();
  }

  // =====================================================================
  // victory replay
  // =====================================================================

  private startReplay(): void {
    this.winnerOfMatch = this.score[0] >= ROUND.winsNeeded ? 0 : 1;
    this.replayLoser = other(this.winnerOfMatch);
    this.hideTop();
    if (!this.arena.rewindForReplay(this.decidedAt)) return this.showResults();
    this.phase = 'replay';
    this.replayT = 0;
    this.timeScale = REPLAY.timeScale;
    this.bannerEl.innerHTML = `<small>${t('end.replaySkip')}</small>`;
  }

  private endReplay(): void {
    if (this.phase !== 'replay') return;
    this.timeScale = 1;
    this.showResults();
  }

  private showResults(): void {
    this.phase = 'results';
    this.trackEnd('progression_completed', {
      winner: this.winnerOfMatch === 0 ? 'red' : 'blue',
      ...(this.mode === 'cpu' ? { won: this.winnerOfMatch === 0 } : {}),
    });
    this.matchesPlayed++;
    this.portal.gameplay(false);
    if (this.mode === 'cpu' && this.winnerOfMatch === 0) this.portal.achievement();
    this.sfx.rate = 1;
    this.sfx.fanfare();
    this.timeScale = 0.6;
    this.bannerEl.innerHTML = '';
    const o = this.overlayEl;
    o.className = `overlay p${this.winnerOfMatch}`;
    o.innerHTML = '';
    const vsCpu = this.mode === 'cpu';
    const title = vsCpu ? t(this.winnerOfMatch === 0 ? 'end.youWin' : 'end.cpuWins') : t('end.wins', { name: nameOf(this.winnerOfMatch) });
    o.append(el('h1', 'title', title));
    o.append(el('div', 'who', `${this.score[0]} – ${this.score[1]}`));
    const row = el('div', 'row menu');
    const again = el('button', 'btn big', t('end.rematch'));
    again.onclick = () => { this.sfx.click(); void this.begin(this.mode); };
    const menu = el('button', 'btn', t('end.menu'));
    menu.onclick = () => { this.arena.reset(); this.view.homeCamera(); this.timeScale = 1; this.showMenu(); };
    row.append(again, menu);
    o.append(row);
    this.overlay(true);
  }

  // =====================================================================
  // input
  // =====================================================================

  private bindInput(): void {
    window.addEventListener('keydown', (ev) => {
      if (ev.repeat) return;
      this.sfx.unlock();
      if (this.phase === 'replay') { this.endReplay(); return; }
      if (this.phase === 'fight') {
        const side = FIRE_KEYS.indexOf(ev.code);
        if ((side === 0 || side === 1) && !(this.cpu && side === 1)) {
          ev.preventDefault();
          this.press(side);
        }
      } else if (this.phase === 'cards') {
        const side = this.cardQueue[0];
        if (this.mode === 'cpu' && side === 1) return;
        const keys = [...CARD_KEYS[side], ...(side === 1 ? ['ArrowLeft', 'ArrowDown', 'ArrowRight'] : ['Digit1', 'Digit2', 'Digit3'])];
        const i = keys.indexOf(ev.code) % 3;
        if (i >= 0) this.pickCard(i);
      }
      if (ev.code === 'Space' || ev.code === 'Enter') ev.preventDefault();
    });
    window.addEventListener('keyup', (ev) => {
      if (this.phase !== 'fight') return;
      const side = FIRE_KEYS.indexOf(ev.code);
      if ((side === 0 || side === 1) && !(this.cpu && side === 1)) this.fire(this.launchers[side].release());
    });
    // the HUD's buttons sit above the canvas, so unlock audio on any touch or click in the window
    window.addEventListener('pointerdown', () => this.sfx.unlock(), true);
    const canvas = this.view.renderer.domElement;
    canvas.addEventListener('pointerdown', (ev) => {
      ev.preventDefault();
      if (this.phase === 'replay') { this.endReplay(); return; }
      if (this.phase === 'fight') {
        let side: Side = ev.clientX < window.innerWidth / 2 ? 0 : 1;
        if (this.cpu) side = 0;
        this.firePointers.set(ev.pointerId, side);
        this.press(side);
        return;
      }
      if (this.phase === 'build') {
        const w = this.view.toWorld(ev.clientX, ev.clientY);
        const side: Side = w.x < 0 ? 0 : 1;
        if (!this.canBuild(side)) return;
        const e = this.arena.pieceAt(w.x, w.y, side);
        if (!e || !e.piece) return;
        // pick it back up
        this.budgets[side][budgetKeyOf(e.piece)]++;
        const piece = e.piece;
        this.arena.remove(e);
        this.arena.ents = this.arena.ents.filter((x) => x.alive);
        this.startDrag(ev.pointerId, side, piece, ev.clientX, ev.clientY);
        this.refreshPalettes();
      }
    });
    window.addEventListener('pointermove', (ev) => {
      const d = this.drags.get(ev.pointerId);
      if (!d) return;
      const w = this.view.toWorld(ev.clientX, ev.clientY);
      d.x = w.x;
      d.y = w.y;
      this.updateDragGhost(d, ev.pointerId);
    });
    const up = (ev: PointerEvent) => {
      if (this.drags.has(ev.pointerId)) this.endDrag(ev.pointerId);
      const side = this.firePointers.get(ev.pointerId);
      if (side !== undefined) {
        this.firePointers.delete(ev.pointerId);
        if (this.phase === 'fight') this.fire(this.launchers[side].release());
      }
    };
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
  }

  // =====================================================================
  // HUD
  // =====================================================================

  private buildHud(): void {
    for (const side of [0, 1] as Side[]) {
      const root = el('div', `pinfo p${side}`);
      const name = el('div', 'name');
      const label = el('span', '', nameOf(side));
      const pips = el('span', 'pips');
      name.append(label, pips);
      const bar = el('i');
      const barWrap = el('div', 'bar');
      barWrap.append(bar);
      const status = el('div', 'status');
      root.append(name, barWrap, status);
      this.pinfo.push({ root, label, pips, bar, status });
    }
    const center = el('div', 'center');
    center.append(this.clockEl, this.subEl);
    this.topEl.append(this.pinfo[0].root, center, this.pinfo[1].root);
    for (const side of [0, 1] as Side[]) {
      const k = el('div', `keys p${side}`);
      this.keyEls.push(k);
    }
    const showMute = () => { this.muteEl.textContent = this.sfx.muted ? '🔇' : '🔊'; };
    this.muteEl.onclick = () => { this.sfx.setMuted(!this.sfx.muted); showMute(); this.sfx.click(); };
    showMute();
    this.hud.append(this.topEl, this.bannerEl, this.overlayEl, ...this.keyEls, this.muteEl);
    this.coach = new Coach(this.hud);
    this.relabel();
    // the tutorial funnel: one event per step as it is learned, then one once they all are
    const pageAt = performance.now();
    this.coach.onLearn = (step, learned) => {
      const fields = { ...this.matchFields(), seconds: Math.round((performance.now() - pageAt) / 1000) };
      this.portal.track('tutorial_step', { ...fields, step_id: step, step_index: STEPS.indexOf(step) + 1 });
      if (learned === STEPS.length) this.portal.track('tutorial_completed', fields);
    };
    this.kingHud = new KingHud(this.hud, this.pinfo.map((p) => p.bar.parentElement!), (_, dmg) => {
      this.sfx.kingHit(dmg / MATERIALS.king.hp);
      this.view.shake(Math.min(0.25, 0.4 * dmg / MATERIALS.king.hp));
    });
    this.hideTop();
  }

  private updateHud(): void {
    if (this.topEl.style.display === 'none') return;
    for (const side of [0, 1] as Side[]) {
      const info = this.pinfo[side];
      info.pips.innerHTML = Array.from({ length: ROUND.winsNeeded }, (_, i) => `<span class="${i < this.score[side] ? 'won' : ''}"></span>`).join('');
      const k = this.arena.king(side);
      const health = k ? Math.max(0, 1 - (k.impact ?? 0) / MATERIALS.king.hp) : 0;
      info.bar.style.width = `${health * 100}%`;
      const l = this.launchers[side];
      let status = '';
      if (this.phase === 'build' && this.session) {
        const b = this.budgets[side];
        status = this.session.sides.includes(side)
          ? (this.session.done[side] ? t('build.ready') : `${t('build.left', b)}${b.king ? ` · ${t('build.king')}` : ''}`)
          : t(this.mode === 'cpu' && side === 1 ? 'build.cpuBuilds' : 'build.waiting');
      } else if (this.phase === 'fight') {
        if (!l.armed) status = t('fight.waitTurn');
        else if (l.frozen) status = t('fight.frozen', { s: l.reloadLeft.toFixed(1) });
        else if (l.phase === 'reload') status = t('fight.reloading', { s: l.reloadLeft.toFixed(1) });
        else if (l.phase === 'charge') status = t('fight.power', { n: Math.round(l.power * 100) });
        else status = t('fight.aiming');
        const extras: string[] = [];
        if (l.ammo.length) extras.push(t('fight.ammoLeft', { n: l.ammo.length, ammo: t(`ammo.${l.ammo[0]}`) }));
        if (l.tripleNext) extras.push(t('fight.volley'));
        if (l.reloadMul > 1) extras.push(t('fight.slowGears'));
        if (this.arena.wind[side]) extras.push(t('fight.headwind'));
        if (extras.length) status += ` · ${extras.join(' · ')}`;
      }
      info.status.textContent = status;
      const chip = this.timerChips[side];
      if (chip && this.session) chip.textContent = `${Math.max(0, Math.ceil(this.session.time))}s`;
    }
    if (this.phase === 'build' && this.session) {
      this.clockEl.textContent = Number.isFinite(this.session.time) ? `${Math.max(0, Math.ceil(this.session.time))}` : '';
      this.subEl.textContent = t(this.session.repair ? 'build.phaseRepair' : 'build.phaseBuild');
    } else if (this.phase === 'fight' || this.phase === 'roundEnd') {
      const left = ROUND.blizzardAfter - this.roundTime;
      this.clockEl.textContent = left > 0 ? `${Math.ceil(left)}` : '❄';
      this.subEl.innerHTML = left > 0 ? t('fight.roundSmall', { n: this.round }) : `<span class="blizzard">${t('fight.blizzard')}</span>`;
      if (this.mode === 'turns' && this.phase === 'fight') this.subEl.innerHTML += `<br>${t('fight.turnOf', { name: nameOf(this.turn) })}`;
    }
  }

  private showKeys(on: boolean): void {
    for (const side of [0, 1] as Side[]) {
      const k = this.keyEls[side];
      if (!on || (this.cpu && side === 1)) { k.style.display = 'none'; continue; }
      k.style.display = '';
      k.innerHTML = this.touch
        ? t(this.cpu ? 'fight.keysTouchCpu' : side === 0 ? 'fight.keysTouchLeft' : 'fight.keysTouchRight')
        : t('fight.keysKey', { key: `<kbd>${keyOf(side)}</kbd>` });
    }
  }

  private banner(text: string, sub: string, seconds: number): void {
    this.bannerEl.innerHTML = `${text}<small>${sub}</small>`;
    this.bannerTimer = seconds;
  }

  private overlay(on: boolean): void {
    this.overlayEl.style.display = on ? '' : 'none';
    this.overlayEl.classList.toggle('on', on);
    if (!on) this.overlayEl.className = 'overlay';
  }

  private showTop(): void { this.topEl.style.display = ''; }
  private hideTop(): void {
    this.topEl.style.display = 'none';
    this.showKeys(false);
  }
}

