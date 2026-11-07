// The record file's handler (desktop/record-file.cjs), pure, over a stand-in file system: a missing, corrupt, oversized or odd
// file loads as null and never throws; a save writes a temporary file and renames it over the record, so the old file stands until
// the new one is whole; what is written holds the record's keys and nothing else, so a device key or a token handed to it never
// reaches the disk; and a call out of bounds throws, because that is a bug in the caller.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { makeRecordHandler, cleanRecord, RECORD_KEYS, PROGRESS_KEYS, MAX_BYTES, ARITY } = require('../desktop/record-file.cjs');

const FILE = 'C:\\Users\\sam\\AppData\\Roaming\\Junkyard Draft\\record.json';

/** A file system in a Map that records every call; `failWrite` makes writeFileSync throw after the temp file exists. */
function fakeFs({ files = {}, failWrite = false } = {}) {
  const disk = new Map(Object.entries(files));
  const dirs = new Set();
  const calls = [];
  return {
    disk,
    dirs,
    calls,
    statSync: (p) => {
      calls.push(['stat', p]);
      if (!disk.has(p)) throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
      return { size: Buffer.byteLength(disk.get(p), 'utf8') };
    },
    readFileSync: (p) => {
      calls.push(['read', p]);
      if (!disk.has(p)) throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
      return disk.get(p);
    },
    mkdirSync: (p, o) => {
      calls.push(['mkdir', p, o]);
      dirs.add(p);
    },
    writeFileSync: (p, text) => {
      calls.push(['write', p]);
      if (failWrite) throw new Error('disk full');
      disk.set(p, text);
    },
    renameSync: (from, to) => {
      calls.push(['rename', from, to]);
      disk.set(to, disk.get(from));
      disk.delete(from);
    },
  };
}
const record = (extra = {}) => ({
  format: 1,
  game: 'junkyard-draft',
  savedAt: '2030-01-02T03:04:05.000Z',
  rules: 12,
  record: {
    settings: { volume: 0.5 },
    bests: { overall: null, bySeed: {}, runs: 2 },
    stars: {},
    days: ['2030-01-01'],
    dailies: [],
    medals: [],
    standings: [],
    watched: [],
    kinds: {},
  },
  ...extra,
});

test('record file: load answers null for a missing, unreadable, corrupt, oversized or odd file, never a throw', () => {
  const none = makeRecordHandler({ fs: fakeFs(), file: FILE });
  assert.equal(none('load', []), null, 'missing');
  assert.equal(makeRecordHandler({ fs: fakeFs({ files: { [FILE]: '{"format":1,' } }), file: FILE })('load', []), null, 'corrupt JSON');
  assert.equal(makeRecordHandler({ fs: fakeFs({ files: { [FILE]: '[1,2,3]' } }), file: FILE })('load', []), null, 'an array is not a record');
  assert.equal(makeRecordHandler({ fs: fakeFs({ files: { [FILE]: '"text"' } }), file: FILE })('load', []), null, 'a string is not a record');
  assert.equal(makeRecordHandler({ fs: fakeFs({ files: { [FILE]: 'null' } }), file: FILE })('load', []), null);
  const big = makeRecordHandler({ fs: fakeFs({ files: { [FILE]: JSON.stringify(record()) } }), file: FILE, maxBytes: 10 });
  assert.equal(big('load', []), null, 'over the cap: not even read');
  const broken = fakeFs();
  broken.readFileSync = () => {
    throw new Error('EACCES');
  };
  broken.statSync = () => ({ size: 1 });
  assert.equal(makeRecordHandler({ fs: broken, file: FILE })('load', []), null, 'a read that fails is no file');
});

test('record file: load gives the parsed file back as it is; the path may be a function, asked on every call', () => {
  const r = record({ token: 'should-not-matter-on-load' });
  let asked = 0;
  const handle = makeRecordHandler({
    fs: fakeFs({ files: { [FILE]: JSON.stringify(r) } }),
    file: () => {
      asked++;
      return FILE;
    },
  });
  assert.deepEqual(handle('load', []), r, 'what is on disk comes back whole: the page validates it');
  assert.deepEqual(handle('load', []), r);
  assert.equal(asked, 2, 'the path is resolved per call (the shell reads userData lazily)');
});

test('record file: save writes a temporary file beside the record and renames it over, after making the folder', () => {
  const fs = fakeFs();
  const handle = makeRecordHandler({ fs, file: FILE });
  assert.equal(handle('save', [record()]), true);
  const written = JSON.parse(fs.disk.get(FILE));
  assert.deepEqual(written, record());
  assert.ok(!fs.disk.has(`${FILE}.tmp`), 'the temporary file is gone after the rename');
  assert.deepEqual(
    fs.calls.map((c) => c[0]),
    ['mkdir', 'write', 'rename'],
    'folder, temp file, rename: in that order',
  );
  assert.deepEqual(fs.calls[0].slice(1), ['C:\\Users\\sam\\AppData\\Roaming\\Junkyard Draft', { recursive: true }]);
  assert.deepEqual(fs.calls[1].slice(1), [`${FILE}.tmp`]);
  assert.deepEqual(fs.calls[2].slice(1), [`${FILE}.tmp`, FILE]);
  assert.match(fs.disk.get(FILE), /^\{\n {2}"format": 1,/, 'pretty-printed: a person can read it');
  const posix = fakeFs();
  makeRecordHandler({ fs: posix, file: '/home/sam/.config/Junkyard Draft/record.json' })('save', [record()]);
  assert.equal(posix.calls[0][1], '/home/sam/.config/Junkyard Draft', 'a posix path finds its folder too');
  assert.deepEqual(handle('load', []), record(), 'what was saved loads back');
});

test('record file: a write that fails leaves the old record in place', () => {
  const fs = fakeFs({ files: { [FILE]: JSON.stringify(record({ savedAt: 'old' })) }, failWrite: true });
  const handle = makeRecordHandler({ fs, file: FILE });
  assert.throws(() => handle('save', [record({ savedAt: 'new' })]), /disk full/);
  assert.equal(JSON.parse(fs.disk.get(FILE)).savedAt, 'old', 'the record on disk is the old one, whole');
  assert.ok(!fs.calls.some((c) => c[0] === 'rename'), 'no rename after a failed write');
});

test('record file: only the record reaches the disk: a device key, a token or any other field handed to save is dropped', () => {
  const fs = fakeFs();
  const handle = makeRecordHandler({ fs, file: FILE });
  const smuggled = record({
    token: 'deadbeefdeadbeefdeadbeefdeadbeef',
    identity: { token: 'cafebabecafebabecafebabecafebabe', playerId: 'p1' },
    'jd.identity.v1': { token: 'feedfacefeedfacefeedfacefeedface' },
    linked: true,
  });
  smuggled.record.token = '0123456789abcdef0123456789abcdef';
  smuggled.record.identity = { token: 'fedcba9876543210fedcba9876543210' };
  smuggled.record.__proto__ = { polluted: true };
  assert.equal(handle('save', [smuggled]), true);
  const text = fs.disk.get(FILE);
  for (const secret of ['deadbeef', 'cafebabe', 'feedface', '0123456789abcdef', 'fedcba98', 'polluted', 'linked', 'identity', 'token'])
    assert.ok(!text.includes(secret), `${secret} never reaches the disk`);
  const written = JSON.parse(text);
  assert.deepEqual(Object.keys(written), RECORD_KEYS);
  assert.deepEqual(Object.keys(written.record), PROGRESS_KEYS);
  assert.equal(Object.getPrototypeOf(cleanRecord(smuggled).record), Object.prototype, 'no prototype pollution through a parsed __proto__ key');
  const bare = cleanRecord({ format: 1, record: 'not an object', extra: 1 });
  assert.deepEqual(bare, { format: 1 }, 'a record that is not an object is dropped with the rest');
  assert.deepEqual(cleanRecord({ record: { days: ['2030-01-01'], secret: 'x' } }), { record: { days: ['2030-01-01'] } }, 'a partial record keeps what it has');
});

test('record file: bounds and unknown ops throw, before the disk is touched', () => {
  const fs = fakeFs();
  const handle = makeRecordHandler({ fs, file: FILE });
  assert.throws(() => handle('explode', []), /unknown op "explode"/);
  assert.throws(() => handle(undefined, []), /unknown op/);
  assert.throws(() => handle('__proto__', []), /unknown op/);
  assert.throws(() => handle('load', 'x'), /takes 0 argument/);
  assert.throws(() => handle('load', [1]), /takes 0 argument/);
  assert.throws(() => handle('save', []), /takes 1 argument/);
  assert.throws(() => handle('save', [{}, {}]), /takes 1 argument/);
  for (const bad of [null, undefined, 'text', 42, [1], true]) assert.throws(() => handle('save', [bad]), /data must be an object/, JSON.stringify(bad));
  assert.throws(() => makeRecordHandler({ fs, file: FILE, maxBytes: 20 })('save', [record()]), /over 20 bytes/);
  assert.deepEqual(fs.calls, [], 'nothing on disk was touched by a refused call');
  assert.equal(MAX_BYTES, 1024 * 1024);
  assert.deepEqual(ARITY, { load: 0, save: 1 });
});
