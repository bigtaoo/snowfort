import { Vector3 } from 'three';
import {
  AMMO, ARENA, BUILD, CARDS, CATAPULT, CPU, MATERIALS, PHYSICS, PIECES, REPLAY, ROUND,
  budgetKeyOf, type Budget, type PieceId,
} from './config';
import { Arena, type AmmoId, type Entity, type Side } from './arena';
import { View } from './view';
import { Sfx } from './audio';
import { KingHud } from './kingHud';
import { Launcher, type Shot } from './launcher';
import { dealHand, type Card } from './cards';
import { CpuShooter, PRESET_FORTS, REPAIR_PLAN, type CpuLevel, type Placement } from './cpu';

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

const NAMES = ['Red', 'Blue'];
const FIRE_KEYS = ['Space', 'Enter'];
const FIRE_LABEL = ['Space', 'Enter'];
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
  private bannerTimer = 0;
  private cardQueue: Side[] = [];
  private hand: Card[] = [];
  private cardTime = 0;
  private pending: [Card[], Card[]] = [[], []];
  /** Alternate-turn mode: whose shot it is, and how long since they fired. */
  private turn: Side = 0;
  private turnFiredAt: number | null = null;
  private replayT = 0;
  private replayLoser: Side = 0;
  private winnerOfMatch: Side = 0;

  // HUD
  private hud = document.getElementById('hud')!;
  private topEl = el('div', 'top');
  private pinfo: { root: HTMLElement; pips: HTMLElement; bar: HTMLElement; status: HTMLElement }[] = [];
  private kingHud!: KingHud;
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
    this.view.render();
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
        if (this.cardTime <= 0) this.pickCard(Math.floor(Math.random() * 3));
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
    for (const s of [0, 1] as Side[]) {
      const l = this.launchers[s];
      const showAim = this.phase === 'fight';
      this.view.setCatapult(s, l.angle, l.phase === 'charge' ? l.power : null, l.phase === 'charge', showAim && l.ready);
    }
    this.updateHud();
  }

  // =====================================================================
  // menu / match flow
  // =====================================================================

  private showMenu(): void {
    this.phase = 'menu';
    this.hideTop();
    this.clearPalettes();
    this.overlay(true);
    const o = this.overlayEl;
    o.innerHTML = '';
    o.append(el('h1', 'title', 'Snow Fort Showdown'));
    const menu = el('div', 'menu');
    const add = (label: string, fn: () => void, cls = 'btn') => {
      const b = el('button', cls, label);
      b.onclick = () => { this.sfx.click(); fn(); };
      return b;
    };
    menu.append(add('2 Players — fire at will', () => this.startMatch('simul'), 'btn big'));
    menu.append(add('2 Players — take turns', () => this.startMatch('turns')));
    const row = el('div', 'row');
    for (const lv of Object.keys(CPU.levels) as CpuLevel[]) {
      row.append(add(`vs CPU · ${lv}`, () => { this.cpuLevel = lv; this.startMatch('cpu'); }));
    }
    menu.append(row);
    o.append(menu);
    o.append(el('div', 'help', this.touch
      ? 'Build: drag pieces from your tray onto your side. Fight: touch and hold your half of the screen to lock the aim and charge, let go to throw. Knock the rival snow king off his hill or pound him to win the round. First to 3.'
      : `Build: drag pieces from the tray onto your side (click a placed piece to pick it up again). Fight: <b>${NAMES[0]}</b> <kbd>Space</kbd>, <b>${NAMES[1]}</b> <kbd>Enter</kbd> — press to lock the swinging aim, hold to charge, release to throw. Knock the rival snow king off his hill or pound him to win the round. First to 3.`));
  }

  startMatch(mode: Mode): void {
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
    this.cpu = mode === 'cpu' ? new CpuShooter(1, this.cpuLevel) : null;
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
    const who = s.sides.length === 2 ? 'Both players' : NAMES[s.sides[0]];
    this.banner(s.repair ? `${who}: repair!` : `${who}: build your fort!`, s.sides.length === 2 ? 'Drag pieces onto your own side' : 'Drag pieces from the tray', 2);
  }

  private endSession(): void {
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
        const b = el('button', '', `<span class="sw" style="background:#${(spec.material === 'king' ? 0xffffff : MATERIALS[spec.material].color).toString(16).padStart(6, '0')};${piece === 'plankV' ? 'width:8px;height:22px' : piece === 'plankH' ? 'height:7px;width:30px' : ''}"></span>${spec.label}<span class="n"></span>`);
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
          const b = el('button', '', 'Last<br>fort');
          b.onclick = () => this.loadPlan(side, bp);
          pal.append(b);
        }
        const r = el('button', '', 'Random<br>fort');
        r.onclick = () => this.loadPlan(side, PRESET_FORTS[Math.floor(Math.random() * PRESET_FORTS.length)]);
        pal.append(r);
      }
      const done = el('button', 'done', 'Done');
      done.onclick = () => { if (this.session) this.session.done[side] = true; };
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
    this.turn = this.lastWinner === null ? 0 : other(this.lastWinner);
    this.turnFiredAt = null;
    this.setArmed();
    this.phase = 'fight';
    this.firePointers.clear();
    this.showKeys(true);
    this.sfx.bell();
    this.banner(`Round ${this.round}`, this.mode === 'turns' ? `${NAMES[this.turn]} throws first` : 'Fire at will!', 1.6);
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
      const mine = this.arena.ents.some((e) => e.kind === 'projectile' && e.owner === this.turn);
      const since = this.arena.time - this.turnFiredAt;
      if ((!mine && since > 1.2) || since > CATAPULT.turnSettleSeconds) {
        this.turn = other(this.turn);
        this.turnFiredAt = null;
        this.launchers[this.turn].phase = 'sweep';
        this.setArmed();
      }
    }
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
    for (const a of angles) {
      const m = Arena.muzzle(shot.side, a);
      this.arena.addProjectile(shot.side, shot.ammo, m.x, m.y, dir * Math.cos(a) * speed, Math.sin(a) * speed, massMul);
    }
    if (this.mode === 'turns') {
      this.turnFiredAt = this.arena.time;
      this.launchers[shot.side].armed = false;
    }
  }

  /** After each physics step: special ammo effects and the round's end. */
  private afterStep(): void {
    for (const imp of this.arena.impacts) if (imp.ammo === 'cocoa') this.melt(imp.x, imp.y);
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
    this.decidedAt = this.arena.time;
    this.showKeys(false);
    for (const l of this.launchers) { if (l.phase === 'charge') l.phase = 'sweep'; }
    this.bannerTimer = ROUND.endBannerSeconds;
    this.sfx.ko();
    if (lost.length === 2) {
      this.lastWinner = null;
      this.bannerEl.innerHTML = 'Both kings down!<small>Replay the round</small>';
      return;
    }
    const winner = other(lost[0]);
    this.lastWinner = winner;
    this.score[winner]++;
    this.sfx.jingle(1);
    const k = this.arena.king(lost[0]);
    const kp = k?.body.translation();
    const how = !kp || kp.y < ARENA.fallY ? 'king off the hill'
      : kp.x * -dirOf(lost[0]) > ARENA.yardEnd ? 'king pushed out of the yard' : 'king knocked out';
    this.bannerEl.innerHTML = `${NAMES[winner]} takes the round!<small>${NAMES[lost[0]]}'s ${how}</small>`;
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

  /** Clears shots and debris, and takes away kings and blocks that fell off their hill. */
  private cleanupBetweenRounds(): void {
    for (const e of [...this.arena.ents]) {
      if (!e.alive) continue;
      const p = e.body.translation();
      const u = p.x * -dirOf(e.owner);
      const fallen = p.y < ARENA.fallY || u < ARENA.edgeX || (e.kind === 'king' && u > ARENA.yardEnd);
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
    const o = this.overlayEl;
    o.innerHTML = '';
    o.className = `overlay p${side}`;
    this.overlay(true);
    o.append(el('div', 'who', `${NAMES[side]}, pick a card${this.lastWinner === other(side) ? ' (loser picks first)' : ''}`));
    const row = el('div', 'cards');
    this.hand.forEach((c, i) => {
      const card = el('div', 'card', `<div class="ic">${c.icon}</div><div class="kd">${c.kind}</div><div class="nm">${c.name}</div><div class="tx">${c.text}</div>${this.touch ? '' : `<kbd>${CARD_LABEL[side][i]}</kbd>`}`);
      card.onclick = () => this.pickCard(i);
      row.append(card);
    });
    o.append(row);
    if (this.mode === 'cpu' && side === 1) {
      this.cardTime = 1.2;
    }
  }

  private pickCard(i: number): void {
    if (this.phase !== 'cards') return;
    const side = this.cardQueue.shift()!;
    this.sfx.click();
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
    this.bannerEl.innerHTML = `<small>Replay — tap or press any key to skip</small>`;
  }

  private endReplay(): void {
    if (this.phase !== 'replay') return;
    this.timeScale = 1;
    this.showResults();
  }

  private showResults(): void {
    this.phase = 'results';
    this.sfx.rate = 1;
    this.sfx.fanfare();
    this.timeScale = 0.6;
    this.bannerEl.innerHTML = '';
    const o = this.overlayEl;
    o.className = `overlay p${this.winnerOfMatch}`;
    o.innerHTML = '';
    const vsCpu = this.mode === 'cpu';
    const title = vsCpu ? (this.winnerOfMatch === 0 ? 'You beat the CPU!' : 'The CPU wins!') : `${NAMES[this.winnerOfMatch]} wins!`;
    o.append(el('h1', 'title', title));
    o.append(el('div', 'who', `${this.score[0]} – ${this.score[1]}`));
    const row = el('div', 'row menu');
    const again = el('button', 'btn big', 'Rematch');
    again.onclick = () => { this.sfx.click(); this.startMatch(this.mode); };
    const menu = el('button', 'btn', 'Menu');
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
      const label = el('span', '', NAMES[side]);
      const pips = el('span', 'pips');
      name.append(label, pips);
      const bar = el('i');
      const barWrap = el('div', 'bar');
      barWrap.append(bar);
      const status = el('div', 'status');
      root.append(name, barWrap, status);
      this.pinfo.push({ root, pips, bar, status });
    }
    const center = el('div', 'center');
    center.append(this.clockEl, this.subEl);
    this.topEl.append(this.pinfo[0].root, center, this.pinfo[1].root);
    for (const side of [0, 1] as Side[]) {
      const k = el('div', `keys p${side}`);
      this.keyEls.push(k);
    }
    const showMute = () => { this.muteEl.textContent = this.sfx.muted ? '🔇' : '🔊'; };
    this.muteEl.title = 'Sound on/off';
    this.muteEl.onclick = () => { this.sfx.setMuted(!this.sfx.muted); showMute(); this.sfx.click(); };
    showMute();
    this.hud.append(this.topEl, this.bannerEl, this.overlayEl, ...this.keyEls, this.muteEl);
    this.kingHud = new KingHud(this.hud, this.pinfo.map((p) => p.bar.parentElement!), (_, dmg) => this.sfx.kingHit(dmg / MATERIALS.king.hp));
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
          ? (this.session.done[side] ? 'done' : `${b.snow} snow · ${b.ice} ice · ${b.plank} planks${b.king ? ' · king!' : ''}`)
          : (this.mode === 'cpu' && side === 1 ? 'CPU builds…' : 'waiting');
      } else if (this.phase === 'fight') {
        if (!l.armed) status = 'waiting for turn';
        else if (l.phase === 'reload') status = `reloading ${l.reloadLeft.toFixed(1)}s`;
        else if (l.phase === 'charge') status = `power ${Math.round(l.power * 100)}%`;
        else status = 'aiming…';
        const extras: string[] = [];
        if (l.ammo.length) extras.push(`${l.ammo.length}× ${ammoName(l.ammo[0])}`);
        if (l.tripleNext) extras.push('volley');
        if (l.reloadMul > 1) extras.push('slow gears');
        if (this.arena.wind[side]) extras.push('headwind');
        if (extras.length) status += ` · ${extras.join(' · ')}`;
      }
      info.status.textContent = status;
      const chip = this.timerChips[side];
      if (chip && this.session) chip.textContent = `${Math.max(0, Math.ceil(this.session.time))}s`;
    }
    if (this.phase === 'build' && this.session) {
      this.clockEl.textContent = Number.isFinite(this.session.time) ? `${Math.max(0, Math.ceil(this.session.time))}` : '';
      this.subEl.textContent = this.session.repair ? 'repair' : 'build';
    } else if (this.phase === 'fight' || this.phase === 'roundEnd') {
      const left = ROUND.blizzardAfter - this.roundTime;
      this.clockEl.textContent = left > 0 ? `${Math.ceil(left)}` : '❄';
      this.subEl.innerHTML = left > 0 ? `round ${this.round}` : '<span class="blizzard">BLIZZARD</span>';
      if (this.mode === 'turns' && this.phase === 'fight') this.subEl.innerHTML += `<br>${NAMES[this.turn]}'s turn`;
    }
  }

  private showKeys(on: boolean): void {
    for (const side of [0, 1] as Side[]) {
      const k = this.keyEls[side];
      if (!on || (this.cpu && side === 1)) { k.style.display = 'none'; continue; }
      k.style.display = '';
      k.innerHTML = this.touch
        ? (this.cpu ? 'Hold anywhere: lock aim + charge, release: throw' : `Hold the ${side === 0 ? 'left' : 'right'} half`)
        : `<kbd>${FIRE_LABEL[side]}</kbd> press: lock aim · hold: charge · release: throw`;
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

const ammoName = (a: AmmoId) => ({ snowball: 'snowball', bigIce: 'ice boulder', split: 'split shot', cocoa: 'cocoa', firework: 'firework' })[a];
