/**
 * What `render/steam` resolves to in a web build (`editionPlugin` in scripts/esbuild-config.mjs): the same exports as steam.ts
 * with no bridge behind them, so a web build never reads `window.jdDesktop.steam` and `tools/bundle-size.ts --forbid` stays
 * clean. Keep the two files' exports the same; an importer compiles against steam.ts and runs against this one.
 */
import type { SteamBridge, SteamStatus } from './steam';

export type { SteamBridge, SteamStatus };
/** What every call answers without a bridge. */
export const NO_STEAM: SteamBridge = {
  status: () => Promise.resolve({ available: false }),
  unlock: () => Promise.resolve(false),
  setStat: () => Promise.resolve(false),
  presence: () => Promise.resolve(false),
};
/** The web edition: never a bridge. */
export const steam = (): SteamBridge => NO_STEAM;
