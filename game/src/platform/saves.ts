// Every save goes through here: Bridge storage on Playgama (as its checklist asks), localStorage only
// where Bridge is missing (dev, other hosts). Bridge storage is asynchronous while the game reads its
// saves synchronously, so `initSaves` reads every key once at boot, before the game is built; reads
// then come from that cache and writes go to Bridge at once (the game writes rarely).

import type { Bridge } from './bridge';

/** Every key the game keeps, read in one call at boot. */
export const SAVE_KEYS = ['snowfort.cpu', 'snowfort.lang', 'snowfort.muted', 'snowfort.coach', 'snowfort.blueprint2.0', 'snowfort.blueprint2.1'];

interface Store {
  get(key: string): string | null;
  set(key: string, value: string): void;
}

const browser: Store = {
  get: (key) => {
    try { return localStorage.getItem(key); } catch { return null; }
  },
  set: (key, value) => {
    try { localStorage.setItem(key, value); } catch { /* storage may be blocked */ }
  },
};

let store: Store = browser;

/** Switches saves to Bridge storage when Bridge came up; call once, after `bridge.init()`. */
export async function initSaves(bridge: Bridge, onPortal: boolean): Promise<void> {
  if (!onPortal) return;
  const cache = await bridge.load(SAVE_KEYS);
  store = {
    get: (key) => cache.get(key) ?? null,
    set: (key, value) => {
      cache.set(key, value);
      bridge.save(key, value);
    },
  };
}

export function loadSave(key: string): string | null {
  return store.get(key);
}

export function writeSave(key: string, value: string): void {
  store.set(key, value);
}
