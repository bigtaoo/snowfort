import { defineConfig, type Plugin } from 'vite';

// The build is the Playgama upload (`npm run pack` zips game/dist/ with index.html at the root):
//  - relative base, since the portal serves it from a folder of its own;
//  - the Bridge SDK <script> (Playgama's CDN, stable v2) ahead of the game's module, build only, so
//    dev runs without it (every Bridge call is then a no-op);
//  - playgama-bridge-config.json next to index.html, where Bridge reads it from.
// The build fails if the tag never made it in, rather than ship a build Playgama refuses.

const SDK_TAG = '<script src="https://bridge.playgama.com/v2/stable/playgama-bridge.js"></script>';
/** Interstitials no closer than three minutes apart: they only come between matches anyway. */
const BRIDGE_CONFIG = { advertisement: { minimumDelayBetweenInterstitial: 180 } };

const playgama = (): Plugin => {
  let applied = false;
  return {
    name: 'playgama-bridge',
    apply: 'build',
    transformIndexHtml(html) {
      const out = html.replace('<script type="module"', `${SDK_TAG}\n    <script type="module"`);
      applied = out.includes('bridge.playgama.com');
      return out;
    },
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: 'playgama-bridge-config.json', source: JSON.stringify(BRIDGE_CONFIG, null, 2) });
    },
    closeBundle() {
      if (!applied) throw new Error('vite.config.ts: index.html never got the Playgama Bridge script');
    },
  };
};

export default defineConfig({
  base: './',
  server: { host: true },
  plugins: [playgama()],
});
