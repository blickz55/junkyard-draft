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
export const verifierUrl = (): string => pickVerifierUrl(location.search, overrideAllowed(), import.meta.env.VERIFIER_URL);
