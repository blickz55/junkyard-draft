// The Steam bridge's handler, pure (no Electron, no Steam, no file): what the shell answers to the page's window.jdDesktop.steam
// calls. desktop/preload.cjs sends `jd:steam` with an op and its args, desktop/main.cjs checks the sender and hands them here,
// and game/src/render/steam.ts is the one module in the game that calls the preload.
//
// `load` returns the steamworks.js module (`() => require('steamworks.js')` in the shell) and is attempted only when `appId` is a
// positive integer, inside a try: the package is the owner's to install once an app id exists (desktop/README.md), so its absence
// is the normal state, and every op then answers false, status { available: false }. The same when the module loads but Steam does
// not answer (not running, another account's app). The client is initialised once and kept; a failure is kept too, so a shell
// without Steam pays for one try.
//
// Arguments are bounded before anything is loaded: an id (an achievement's or a stat's API name, a presence token) is 1 to 64
// characters of a-z, 0-9, _, . and -; a stat's value is a finite number; `args` is an array of exactly what the op takes. Anything
// else, and an unknown op, throws: a bug in the caller, not a Steam condition, and the page sees a rejected promise.
//
// What the ops do with a client (steamworks.js's names, so the owner's swap-in is the one require):
//   status            { available: true, appId }
//   unlock(id)        client.achievement.activate(id) === true
//   setStat(id, n)    client.stats.setInt(id, n) === true, then client.stats.store()
//   presence(key)     client.localplayer.setRichPresence('steam_display', '#' + key): the friends list shows the token's text
const ID = /^[a-z0-9_.-]{1,64}$/;
const ARITY = { status: 0, unlock: 1, setStat: 2, presence: 1 };

const isAppId = (v) => Number.isInteger(v) && v > 0;
const checkId = (op, v) => {
  if (typeof v !== 'string' || !ID.test(v)) throw new Error(`steam: ${op}: id must be 1 to 64 characters of a-z, 0-9, _, . and -`);
  return v;
};

/** The handler: (op, args) => the op's answer, synchronous (ipcMain.handle wraps it); throws on a bad call. */
function makeSteamHandler({ load, appId }) {
  const known = isAppId(appId) ? appId : null;
  let client = null;
  let failed = known == null;
  const connect = () => {
    if (client || failed) return client;
    try {
      client = load().init(known) || null;
    } catch {
      client = null;
    }
    if (!client) failed = true;
    return client;
  };
  const attempt = (fn) => {
    const c = connect();
    if (!c) return false;
    try {
      return fn(c) === true;
    } catch {
      return false;
    }
  };
  return function handle(op, args = []) {
    if (typeof op !== 'string' || !Object.hasOwn(ARITY, op)) throw new Error(`steam: unknown op ${JSON.stringify(typeof op === 'string' ? op : typeof op)}`);
    if (!Array.isArray(args) || args.length !== ARITY[op]) throw new Error(`steam: ${op} takes ${ARITY[op]} argument(s)`);
    switch (op) {
      case 'status':
        return connect() ? { available: true, appId: known } : { available: false };
      case 'unlock': {
        const id = checkId(op, args[0]);
        return attempt((c) => c.achievement.activate(id));
      }
      case 'setStat': {
        const id = checkId(op, args[0]);
        const n = args[1];
        if (typeof n !== 'number' || !Number.isFinite(n)) throw new Error('steam: setStat: n must be a finite number');
        return attempt((c) => {
          if (c.stats.setInt(id, n) !== true) return false;
          c.stats.store();
          return true;
        });
      }
      case 'presence': {
        const key = checkId(op, args[0]);
        return attempt((c) => {
          c.localplayer.setRichPresence('steam_display', `#${key}`);
          return true;
        });
      }
    }
  };
}

module.exports = { makeSteamHandler, ID, ARITY, isAppId };
