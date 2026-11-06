/**
 * The Steam bridge, the Steam edition only (scripts/build-steam.mjs): the one module that reads `window.jdDesktop.steam`, which the
 * Electron shell's preload exposes (desktop/preload.cjs) and desktop/steam-bridge.cjs answers over IPC. Every call resolves: with no
 * bridge (a browser, the web edition in the shell, a shell without steamworks.js or an app id) `status()` says `{ available: false }`
 * and the rest `false`, and a refused call (an id out of bounds, a bridge that threw) resolves the same way, so a caller never has to
 * know what stands behind it. Nothing here touches scores, saves or the rules.
 *
 * A web build never carries this file: `editionPlugin` (scripts/esbuild-config.mjs) resolves `render/steam` to steam-none.ts there,
 * and `tools/bundle-size.ts --forbid` fails on the output if it ever did (tests/editions.test.mjs). The same four exports live in
 * steam-none.ts, so an importer compiles against either.
 */
export interface SteamStatus {
  available: boolean;
  /** the app id the shell knows, when Steam answered */
  appId?: number;
}
export interface SteamBridge {
  /** whether Steam stands behind the shell, and the app id when it does */
  status(): Promise<SteamStatus>;
  /** unlock an achievement by its API name; true when Steam took it */
  unlock(id: string): Promise<boolean>;
  /** set a stat by its API name; true when Steam took it */
  setStat(id: string, n: number): Promise<boolean>;
  /** what the friends list shows the player doing: a rich-presence token the shell prefixes with `#` */
  presence(key: string): Promise<boolean>;
}
interface DesktopWindow {
  jdDesktop?: { steam?: { [K in keyof SteamBridge]: (...args: Parameters<SteamBridge[K]>) => Promise<unknown> } };
}

/** What every call answers without a bridge. */
export const NO_STEAM: SteamBridge = {
  status: () => Promise.resolve({ available: false }),
  unlock: () => Promise.resolve(false),
  setStat: () => Promise.resolve(false),
  presence: () => Promise.resolve(false),
};
/** An IPC answer as a yes or a no: the shell answers `true`, and anything else (a refusal, a throw, an odd value) is a no. */
const yes = (p: Promise<unknown>): Promise<boolean> => p.then((v) => v === true).catch(() => false);

/** The bridge for this page: the shell's when the preload exposed one, else the no-op set. */
export function steam(): SteamBridge {
  const bridge = (window as unknown as DesktopWindow).jdDesktop?.steam;
  if (!bridge) return NO_STEAM;
  return {
    status: () =>
      Promise.resolve()
        .then(() => bridge.status())
        .then((v) => {
          const s = v as Partial<SteamStatus> | null;
          return s && s.available === true ? { available: true, ...(typeof s.appId === 'number' ? { appId: s.appId } : {}) } : { available: false };
        })
        .catch(() => ({ available: false })),
    unlock: (id) => yes(Promise.resolve().then(() => bridge.unlock(id))),
    setStat: (id, n) => yes(Promise.resolve().then(() => bridge.setStat(id, n))),
    presence: (key) => yes(Promise.resolve().then(() => bridge.presence(key))),
  };
}
