import RAPIER from '@dimforge/rapier3d-compat';
import { Game } from './game';

async function boot(): Promise<void> {
  await RAPIER.init();
  const game = new Game(document.getElementById('app')!);
  let last = performance.now();
  const tick = (now: number) => {
    game.frame((now - last) / 1000);
    last = now;
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

void boot();
