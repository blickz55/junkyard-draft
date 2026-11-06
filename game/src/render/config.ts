/**
 * Where the client talks to (production roadmap 0.8.0). The verifier URL is baked at build time
 * (`import.meta.env.VERIFIER_URL`). The `?verifier=` query override exists for development and tests; honouring it in a
 * hosted build would let any link send the device token (the player's only secret) to a host of the link's choosing, so
 * the override counts only in dev builds and on pages served from a loopback host. The Electron shell loads `file://`
 * (hostname empty), so it always uses the baked URL. The pure helpers take their inputs as arguments so Node tests can
 * pin the rule without a browser.
 */
const LOOPBACK_HOST = /^(127\.0\.0\.1|localhost|\[::1\])$/i;
export const isLoopbackHost = (hostname: string): boolean => LOOPBACK_HOST.test(hostname);
/** Overrides count in dev builds and on loopback pages only. */
export const overrideAllowedFor = (dev: boolean, hostname: string): boolean => dev || isLoopbackHost(hostname);
/** The verifier for a page: the `?verifier=` http(s) URL when overrides are allowed, else the baked default. A trailing slash is dropped. */
export function pickVerifierUrl(search: string, allowed: boolean, baked: string): string {
  if (!allowed) return baked;
  const v = new URLSearchParams(search).get('verifier');
  if (!v || !/^https?:\/\/[^\s/?#]+/i.test(v)) return baked;
  return v.replace(/\/+$/, '');
}
export const overrideAllowed = (): boolean => overrideAllowedFor(import.meta.env.DEV, location.hostname);
/** What a tester build bakes (scripts/build-test.mjs): nothing answers there, so the game's offline paths carry it, and its words say what it is. */
export const NO_SERVER = 'https://verify.invalid';
export const isTestEdition = (): boolean => import.meta.env.VERIFIER_URL === NO_SERVER;
export const verifierUrl = (): string => pickVerifierUrl(location.search, overrideAllowed(), import.meta.env.VERIFIER_URL);
/**
 * The edition a build is for (`import.meta.env.EDITION`, scripts/esbuild-config.mjs): `web`, the product, or `steam`, the depot's
 * build (scripts/build-steam.mjs). For runtime branches only (a word or a button that differs on Steam). It is not a tree-shaking
 * gate: esbuild does not fold a call through a helper, so a module guarded by `if (isSteamEdition())` would still be bundled. What
 * keeps the Steam bridge out of a web build is `editionPlugin` there, which resolves `render/steam` to steam-none.ts, and the one
 * inline `import.meta.env.EDITION === 'steam'` guard in main.ts, which esbuild does fold.
 */
export const isSteamEditionFor = (edition: string): boolean => edition === 'steam';
export const isSteamEdition = (): boolean => isSteamEditionFor(import.meta.env.EDITION);
