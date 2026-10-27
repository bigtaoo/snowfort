import RAPIER from '@dimforge/rapier3d-compat';
import { Game } from './game';
import { Bridge } from './platform/bridge';
import { DEFAULT_LOCALE, detectLocale, loadLocale, setLocale } from './i18n';
import { LANG_KEY } from './game';

async function boot(): Promise<void> {
  // Bridge only exists in the Playgama build; elsewhere init() is false at once and nothing changes
  const bridge = new Bridge();
  const [, onPortal] = await Promise.all([RAPIER.init(), bridge.init()]);
  // the player's own pick, else the portal's language, else the browser's; English if a table fails to load
  let saved: string | null = null;
  try { saved = localStorage.getItem(LANG_KEY); } catch { /* storage may be blocked */ }
  const locale = detectLocale([saved, bridge.language, ...navigator.languages]);
  setLocale((await loadLocale(locale)) ? locale : DEFAULT_LOCALE);
  const game = new Game(document.getElementById('app')!);
  if (onPortal) {
    let hostMuted = false;
    let paused = false;
    let playing = false;
    const sound = () => game.sfx.setHostMuted(hostMuted || paused);
    const pause = (p: boolean) => { paused = p; game.paused = p; sound(); };
    bridge.onMute((m) => { hostMuted = m; sound(); });
    bridge.onPause(pause);
    // a pause whose resume never came (seen after an interstitial) would freeze the game for good:
    // a player touching or typing in it is playing, so it runs again
    for (const type of ['pointerdown', 'keydown']) window.addEventListener(type, () => { if (paused) pause(false); }, true);
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
        // the ad is over, whether or not Bridge sends its resume
        pause(false);
      },
      track: (event, data) => bridge.track(event, data),
    };
    console.info(`[snowfort] Playgama Bridge: ${bridge.platformId}`);
  }
  let last = performance.now();
  let reported = false;
  const tick = (now: number) => {
    // the next frame is booked first: a throw in this one must not stop the game for good
    requestAnimationFrame(tick);
    const dt = (now - last) / 1000;
    last = now;
    if (game.paused) return;
    try {
      game.frame(dt);
    } catch (e) {
      if (reported) return;
      reported = true;
      console.error('[snowfort] frame failed', e);
      bridge.track('frame_error', { message: String(e).slice(0, 200), phase: game.phase });
    }
  };
  requestAnimationFrame(tick);
  bridge.send('game_ready');
}

void boot();
