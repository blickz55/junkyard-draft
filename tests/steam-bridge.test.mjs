// The Steam bridge's handler (desktop/steam-bridge.cjs), pure: without steamworks.js (the normal state until the owner installs it)
// or without an app id every op is a quiet no; with a module the ops forward to it with their arguments, once initialised; and a
// call out of bounds or an unknown op throws, because that is a bug in the caller, not a Steam condition.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { makeSteamHandler, ID, ARITY, isAppId } = require('../desktop/steam-bridge.cjs');

/** A steamworks.js stand-in that records every call. */
function fakeModule({ activate = true, setInt = true, initThrows = false } = {}) {
  const calls = [];
  const client = {
    achievement: {
      activate: (id) => {
        calls.push(['activate', id]);
        return activate;
      },
    },
    stats: {
      setInt: (id, n) => {
        calls.push(['setInt', id, n]);
        return setInt;
      },
      store: () => {
        calls.push(['store']);
        return true;
      },
    },
    localplayer: {
      setRichPresence: (key, value) => {
        calls.push(['setRichPresence', key, value]);
      },
    },
  };
  return {
    calls,
    init: (appId) => {
      calls.push(['init', appId]);
      if (initThrows) throw new Error('Steam is not running');
      return client;
    },
  };
}

test('steam bridge: no module (require throws): status unavailable, every op a quiet no, load tried once', async () => {
  let loads = 0;
  const handle = makeSteamHandler({
    load: () => {
      loads++;
      throw new Error("Cannot find module 'steamworks.js'");
    },
    appId: 480,
  });
  assert.deepEqual(await handle('status', []), { available: false });
  assert.equal(await handle('unlock', ['first-ingot']), false);
  assert.equal(await handle('setStat', ['ingots', 12]), false);
  assert.equal(await handle('presence', ['home']), false);
  assert.deepEqual(await handle('status', []), { available: false });
  assert.equal(loads, 1, 'a shell without Steam pays for one try');
});

test('steam bridge: no app id: the module is never loaded', () => {
  for (const appId of [null, undefined, 0, -1, 1.5, '480', NaN]) {
    const handle = makeSteamHandler({
      load: () => {
        throw new Error('must not be called');
      },
      appId,
    });
    assert.deepEqual(handle('status', []), { available: false }, String(appId));
    assert.equal(handle('unlock', ['x']), false);
  }
  assert.equal(isAppId(480), true);
  assert.equal(isAppId('480'), false);
});

test('steam bridge: a module that loads but whose init throws (Steam not running) answers the same', () => {
  const mod = fakeModule({ initThrows: true });
  const handle = makeSteamHandler({ load: () => mod, appId: 480 });
  assert.deepEqual(handle('status', []), { available: false });
  assert.equal(handle('presence', ['home']), false);
  assert.deepEqual(mod.calls, [['init', 480]], 'one init, then nothing');
});

test('steam bridge: a fake module: ops forward with their args, the client initialised once', () => {
  const mod = fakeModule();
  const handle = makeSteamHandler({ load: () => mod, appId: 480 });
  assert.deepEqual(handle('status', []), { available: true, appId: 480 });
  assert.equal(handle('unlock', ['first-ingot']), true);
  assert.equal(handle('setStat', ['ingots.sold', 12]), true);
  assert.equal(handle('presence', ['home']), true);
  assert.deepEqual(mod.calls, [
    ['init', 480],
    ['activate', 'first-ingot'],
    ['setInt', 'ingots.sold', 12],
    ['store'],
    ['setRichPresence', 'steam_display', '#home'],
  ]);
  assert.deepEqual(handle('status', []), { available: true, appId: 480 });
  assert.equal(mod.calls.filter((c) => c[0] === 'init').length, 1, 'init once');
});

test('steam bridge: what Steam refuses comes back false, never thrown', () => {
  const mod = fakeModule({ activate: false, setInt: false });
  const handle = makeSteamHandler({ load: () => mod, appId: 480 });
  assert.equal(handle('unlock', ['nope']), false);
  assert.equal(handle('setStat', ['nope', 1]), false);
  assert.ok(!mod.calls.some((c) => c[0] === 'store'), 'no store after a refused setInt');
  const throwing = makeSteamHandler({
    load: () => ({
      init: () => ({
        achievement: {
          activate: () => {
            throw new Error('boom');
          },
        },
      }),
    }),
    appId: 1,
  });
  assert.equal(throwing('unlock', ['x']), false, 'a throwing client is a no');
});

test('steam bridge: bounds and unknown ops throw, before anything is loaded', () => {
  let loads = 0;
  const handle = makeSteamHandler({
    load: () => {
      loads++;
      return fakeModule();
    },
    appId: 480,
  });
  assert.throws(() => handle('explode', []), /unknown op "explode"/);
  assert.throws(() => handle(undefined, []), /unknown op/);
  assert.throws(() => handle('__proto__', []), /unknown op/);
  assert.throws(() => handle('status', 'x'), /takes 0 argument/);
  assert.throws(() => handle('unlock', []), /takes 1 argument/);
  assert.throws(() => handle('unlock', ['a', 'b']), /takes 1 argument/);
  for (const bad of ['', 'A', 'has space', 'é', 'x'.repeat(65), 'semi;colon', 42, null, {}])
    assert.throws(() => handle('unlock', [bad]), /id must be 1 to 64 characters/, JSON.stringify(bad));
  assert.throws(() => handle('presence', ['#home']), /id must be/, 'the shell adds the # itself');
  for (const bad of [NaN, Infinity, -Infinity, '12', null, undefined]) assert.throws(() => handle('setStat', ['ingots', bad]), /finite number/, String(bad));
  assert.equal(loads, 0, 'nothing loaded for a refused call');
  assert.equal(ID.test('x'.repeat(64)), true);
  assert.equal(ID.test('a.b_c-d9'), true);
  assert.deepEqual(ARITY, { status: 0, unlock: 1, setStat: 2, presence: 1 });
});
