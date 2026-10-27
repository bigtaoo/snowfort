// The Playgama Bridge SDK (v2, https://wiki.playgama.com/playgama/bridge-sdk), trimmed down from
// Holy Kicker's wrapper (D:\standing\client\src\platform\playgama\bridge.ts). The script only exists
// in the Playgama build; in dev, under an adblocker or if it never answers, every call is a no-op,
// every throw or rejection is swallowed and init() gives up after INIT_WAIT_MS.

type Listener = (...args: unknown[]) => void;

interface BridgeShape {
  initialize?: () => unknown;
  platform?: {
    id?: string;
    language?: string;
    isAudioEnabled?: boolean;
    sendMessage?: (message: string) => unknown;
    on?: (event: string, cb: Listener) => unknown;
  };
  advertisement?: {
    isInterstitialSupported?: boolean;
    showInterstitial?: (placement?: string) => unknown;
    on?: (event: string, cb: Listener) => unknown;
  };
  analytics?: { send?: (event: string, data?: Record<string, string | number | boolean>) => unknown };
}

const INIT_WAIT_MS = 5000;
/** An interstitial that never reports its end is given up after this long. */
const AD_WAIT_MS = 60_000;

async function settle(fn: () => unknown): Promise<unknown> {
  try {
    return await fn();
  } catch {
    return undefined;
  }
}

export class Bridge {
  private sdk: BridgeShape | null = null;
  private adDone: (() => void) | null = null;

  /** Runs initialize(); false without the script, on a rejection or after INIT_WAIT_MS. */
  async init(): Promise<boolean> {
    const sdk = (globalThis as { bridge?: BridgeShape }).bridge;
    if (!sdk || typeof sdk.initialize !== 'function') return false;
    const done = settle(async () => {
      await sdk.initialize?.();
      return true;
    });
    const ok = (await Promise.race([done, new Promise((r) => setTimeout(() => r(false), INIT_WAIT_MS))])) === true;
    if (ok) {
      this.sdk = sdk;
      void settle(() => sdk.advertisement?.on?.('interstitial_state_changed', (s) => {
        if (s === 'closed' || s === 'failed') this.endAd();
      }));
    }
    return ok;
  }

  get platformId(): string | null {
    return this.sdk?.platform?.id ?? null;
  }

  /** The player's language as the platform reports it (ISO 639-1), null without it. */
  get language(): string | null {
    const v = this.sdk?.platform?.language;
    return typeof v === 'string' && v ? v : null;
  }

  /** game_ready, gameplay_started, gameplay_stopped, player_got_achievement. */
  send(message: string): void {
    void settle(() => this.sdk?.platform?.sendMessage?.(message));
  }

  /** One event for Playgama's own telemetry (Bridge 2.3.0 and newer; a no-op before). */
  track(event: string, data?: Record<string, string | number | boolean>): void {
    void settle(() => this.sdk?.analytics?.send?.(event, data));
  }

  /** The platform asks the game to stop (an ad, its own overlay) and to go on again. */
  onPause(cb: (paused: boolean) => void): void {
    void settle(() => this.sdk?.platform?.on?.('pause_state_changed', (p) => cb(p === true)));
  }

  /** The platform's sound switch: called now with whether to mute, then on every change. */
  onMute(cb: (muted: boolean) => void): void {
    if (!this.sdk) return;
    cb(this.sdk.platform?.isAudioEnabled === false);
    void settle(() => this.sdk?.platform?.on?.('audio_state_changed', (on) => cb(on === false)));
  }

  /** One interstitial; resolves once it closed or failed (Bridge's cooldown fails it at once). */
  interstitial(): Promise<void> {
    const ad = this.sdk?.advertisement;
    if (!ad || ad.isInterstitialSupported !== true || this.adDone) return Promise.resolve();
    return new Promise((resolve) => {
      const timer = setTimeout(() => this.endAd(), AD_WAIT_MS);
      this.adDone = () => {
        clearTimeout(timer);
        resolve();
      };
      Promise.resolve().then(() => ad.showInterstitial?.()).catch(() => this.endAd());
    });
  }

  private endAd(): void {
    const done = this.adDone;
    this.adDone = null;
    done?.();
  }
}
