// The record file's handler, pure (no Electron; the file system comes in as an argument): what the shell answers to the page's
// window.jdDesktop.record calls. desktop/preload.cjs sends `jd:record` with an op and its args, desktop/main.cjs checks the sender
// and hands them here, and game/src/render/recordfile.ts is the one module in the game that calls the preload.
//
// The file is the player's record as the game syncs it between devices (SyncData in game/src/render/storage.ts, packed by
// recordfile.ts: { format, game, savedAt, rules, record }), one JSON file under Electron's userData (desktop/README.md). Steam
// Auto-Cloud can carry that folder between machines with no Steam code in the shell, and the web game saves and opens the same file.
//
//   load()      the file parsed, or null: missing, unreadable, not JSON, not an object or over the cap. Never thrown: a corrupt file
//               is no file, and the page validates what it gets (validateSync) before a byte of it is merged.
//   save(data)  the record written whole: a temporary file beside it, then a rename, so a crash mid-write leaves the old file intact.
//               Only the keys a record has are written (RECORD_KEYS at the top, PROGRESS_KEYS inside `record`): the device key, a
//               bearer token or anything else that is not the record never reaches the disk, whatever the caller sends.
//
// A call out of bounds throws, as a bug in the caller: an unknown op, the wrong number of arguments, a `data` that is not a plain
// object, or a record over the cap (MAX_BYTES, eight times what the account copy may be).
const RECORD_KEYS = ['format', 'game', 'savedAt', 'rules', 'record'];
const PROGRESS_KEYS = ['settings', 'bests', 'stars', 'days', 'dailies', 'medals', 'standings', 'watched', 'kinds'];
const MAX_BYTES = 1024 * 1024;
const ARITY = { load: 0, save: 1 };

const isPlainObject = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
/** `o` with only the keys in `keys`, as a fresh object (a key such as __proto__ never gets through: the list names what does). */
const keep = (o, keys) => Object.fromEntries(keys.filter((k) => Object.hasOwn(o, k)).map((k) => [k, o[k]]));

/** The record's shape with nothing else in it: the known top-level keys, and inside `record` the progress keys only. */
function cleanRecord(data) {
  const out = keep(data, RECORD_KEYS);
  if (Object.hasOwn(out, 'record')) {
    if (isPlainObject(out.record)) out.record = keep(out.record, PROGRESS_KEYS);
    else delete out.record;
  }
  return out;
}

/**
 * The handler: (op, args) => the op's answer, synchronous (ipcMain.handle wraps it); throws on a bad call. `fs` is the file system
 * (node:fs, or a stand-in in tests); `file` is the path, or a function that gives it (the shell asks Electron for userData lazily).
 */
function makeRecordHandler({ fs, file, maxBytes = MAX_BYTES }) {
  const pathOf = () => (typeof file === 'function' ? file() : file);
  return function handle(op, args = []) {
    if (typeof op !== 'string' || !Object.hasOwn(ARITY, op)) throw new Error(`record: unknown op ${JSON.stringify(typeof op === 'string' ? op : typeof op)}`);
    if (!Array.isArray(args) || args.length !== ARITY[op]) throw new Error(`record: ${op} takes ${ARITY[op]} argument(s)`);
    const target = pathOf();
    switch (op) {
      case 'load': {
        let text;
        try {
          if (fs.statSync(target).size > maxBytes) return null;
          text = fs.readFileSync(target, 'utf8');
        } catch {
          return null;
        }
        try {
          const parsed = JSON.parse(text);
          return isPlainObject(parsed) ? parsed : null;
        } catch {
          return null;
        }
      }
      case 'save': {
        const data = args[0];
        if (!isPlainObject(data)) throw new Error('record: save: data must be an object');
        const text = JSON.stringify(cleanRecord(data), null, 2);
        if (Buffer.byteLength(text, 'utf8') > maxBytes) throw new Error(`record: save: over ${maxBytes} bytes`);
        const dir = target.slice(0, Math.max(target.lastIndexOf('/'), target.lastIndexOf('\\')));
        if (dir) fs.mkdirSync(dir, { recursive: true });
        const tmp = `${target}.tmp`;
        fs.writeFileSync(tmp, text, 'utf8');
        fs.renameSync(tmp, target);
        return true;
      }
    }
  };
}

module.exports = { makeRecordHandler, cleanRecord, RECORD_KEYS, PROGRESS_KEYS, MAX_BYTES, ARITY };
