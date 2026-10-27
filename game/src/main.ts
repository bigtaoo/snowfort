import RAPIER from '@dimforge/rapier3d-compat';
import { Game } from './game';
import { Bridge } from './platform/bridge';

async function boot(): Promise<void> {
  // Bridge only exists in the Playgama build; elsewhere init() is false at once and nothing changes
  const bridge = new Bridge();
  const [, onPortal] = await Promise.all([RAPIER.init(), bridge.init()]);
  const game = new Game(document.getElementById('app')!);
  if (onPortal) {
    let hostMuted = false;
    let paused = false;
    let playing = false;
    const sound = () => game.sfx.setHostMuted(hostMuted || paused);
    bridge.onMute((m) => { hostMuted = m; sound(); });
    bridge.onPause((p) => { paused = p; game.paused = p; sound(); });
    game.portal = {
      gameplay: (on) => {
        if (on !== playing) bridge.send(on ? 'gameplay_started' : 'gameplay_stopped');
        playing = on;
      },
      achievement: () => bridge.send('player_got_achievement'),
      betweenMatches: async () => {
        // the ad has the screen and the sound; Bridge also sends its own pause around it
        game.sfx.setHostMuted(true);
        await bridge.interstitial();
        sound();
      },
    };
    console.info(`[snowfort] Playgama Bridge: ${bridge.platformId}`);
  }
  let last = performance.now();
  const tick = (now: number) => {
    if (!game.paused) game.frame((now - last) / 1000);
    last = now;
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
  bridge.send('game_ready');
}

void boot();
