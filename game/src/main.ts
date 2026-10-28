import RAPIER from '@dimforge/rapier3d-compat';
import { Game } from './game';
import { Bridge } from './platform/bridge';
import { initSaves, loadSave } from './platform/saves';
import { DEFAULT_LOCALE, detectLocale, loadLocale, setLocale } from './i18n';
import { LANG_KEY } from './game';
import { keepHudOnScreen } from './viewClip';

async function boot(): Promise<void> {
  // Bridge only exists in the Playgama build; elsewhere init() is false at once and nothing changes
  const bridge = new Bridge();
  const [, onPortal] = await Promise.all([RAPIER.init(), bridge.init()]);
  // the player's own pick, else the portal's language, else the browser's; English if a table fails to load
  await initSaves(bridge, onPortal);
  const locale = detectLocale([loadSave(LANG_KEY), bridge.language, ...navigator.languages]);
  setLocale((await loadLocale(locale)) ? locale : DEFAULT_LOCALE);
  const game = new Game(document.getElementById('app')!);
  keepHudOnScreen(document.getElementById('app')!, document.getElementById('hud')!);
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
  trackOrientation(bridge, game.touch);
}

/**
 * The menu funnel's first step, which no match event sees: what the player had in front of them
 * at load, and whether a phone held upright (covered by the turn-sideways screen) was turned.
 * Each event goes once per page.
 */
function trackOrientation(bridge: Bridge, touch: boolean): void {
  const upright = matchMedia('(orientation: portrait) and (pointer: coarse)');
  const loadedAt = performance.now();
  const seconds = () => Math.round((performance.now() - loadedAt) / 1000);
  bridge.track('menu_shown', { touch, portrait: upright.matches });
  let shown = false;
  let turned = false;
  const check = () => {
    if (upright.matches && !shown) {
      shown = true;
      bridge.track('rotate_prompt', { state: 'shown', seconds: seconds() });
    } else if (!upright.matches && shown && !turned) {
      turned = true;
      bridge.track('rotate_prompt', { state: 'turned', seconds: seconds() });
    }
  };
  check();
  upright.addEventListener('change', check);
}

void boot();
