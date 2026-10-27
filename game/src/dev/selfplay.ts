/**
 * Dev-only self-play: CPU against CPU at full speed, for balance numbers. Never imported by the game.
 * In the dev server's console:
 *   const sp = await import('/src/dev/selfplay.ts');
 *   sp.run([[10, 60]], 4);            // runs in the background
 *   sp.results;                       // poll until results.done
 */
import { CpuShooter, randomFort } from '../cpu';
import type { Side } from '../arena';

type Mode = 'turns' | 'cpu';

export interface RoundLog { time: number; shots: number; loser: Side }
export interface MatchLog { score: [number, number]; fight: number; rounds: RoundLog[] }

export const results: { done: boolean; matches: Record<string, MatchLog[]>; errors: string[] } = { done: true, matches: {}, errors: [] };

const game = () => (window as any).__sf;

export async function match(l0: number, l1: number, mode: Mode = 'cpu'): Promise<MatchLog> {
  const g = game();
  g.view.render = () => {};
  g.sfx.muted = true;
  // self-play must not move the real player's CPU level
  g.keepProgress = false;
  const log: MatchLog = { score: [0, 0], fight: 0, rounds: [] };
  const endRound = g.endRound.bind(g);
  g.endRound = (lost: Side[]) => {
    log.rounds.push({ time: g.roundTime, shots: g.launchers[0].shots + g.launchers[1].shots, loser: lost[0] });
    endRound(lost);
  };
  g.startMatch(mode);
  const s0 = new CpuShooter(0, l0);
  g.cpu = new CpuShooter(1, l1);
  const dt = 1 / 60;
  try {
    for (let i = 0; i < 150000; i++) {
      if (g.phase === 'build' && g.session) {
        for (const side of g.session.sides) {
          if (g.session.done[side]) continue;
          if (!g.session.repair) g.loadPlan(side, randomFort());
          g.session.done[side] = true;
        }
      }
      if (g.phase === 'cards' && g.cardQueue.length) g.pickCard(Math.floor(Math.random() * 3));
      if (g.phase === 'replay') { g.endReplay(); break; }
      if (g.phase === 'results') break;
      if (g.phase === 'fight') {
        log.fight += dt;
        const l = g.launchers[0];
        const act = s0.update(dt, l, g.arena);
        if (act.press) g.press(0);
        if (act.release) g.fire(l.release());
      }
      g.frame(dt);
      if (i % 600 === 0) await new Promise((r) => setTimeout(r, 0));
    }
  } finally {
    delete g.endRound;
  }
  log.score = [g.score[0], g.score[1]];
  return log;
}

/** Plays `n` matches per pairing in the background; read `results`. */
export function run(pairs: [number, number][], n = 4, mode: Mode = 'cpu'): void {
  results.done = false;
  results.matches = {};
  results.errors = [];
  const onErr = (ev: ErrorEvent) => results.errors.push(ev.message);
  window.addEventListener('error', onErr);
  void (async () => {
    try {
      for (const [a, b] of pairs) {
        const key = `${a} v ${b}`;
        results.matches[key] = [];
        for (let i = 0; i < n; i++) results.matches[key].push(await match(a, b, mode));
      }
    } catch (e) {
      results.errors.push(String(e));
    } finally {
      window.removeEventListener('error', onErr);
      results.done = true;
    }
  })();
}

/** One line per pairing: rounds won by each side and the average fight time per match. */
export function summary(): string[] {
  return Object.entries(results.matches).map(([k, ms]) => {
    const w0 = ms.reduce((a, m) => a + m.score[0], 0);
    const w1 = ms.reduce((a, m) => a + m.score[1], 0);
    const fight = ms.reduce((a, m) => a + m.fight, 0) / Math.max(1, ms.length);
    const fast = ms.flatMap((m) => m.rounds).filter((r) => r.shots <= 2).length;
    return `${k}: rounds ${w0}-${w1}, fight ${fight.toFixed(0)}s/match, ${fast} rounds in ≤2 shots`;
  });
}
