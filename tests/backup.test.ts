// Production roadmap 0.8.3: backups never carry the secret or a temp file, carry a hash manifest, prune by count; the restore drill
// unpacks, verifies hashes, starts a verifier on the copy and serves the archive's entries; a tampered archive fails the drill.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { Verifier, EventStore, playerIdFromToken } from '../server/verify';
import { backup, restoreDrill, listDataFiles, isRcloneTarget, archiveNameFor, ROOT } from '../tools/backup-lib';
import { apply, newRun } from '../game/src/sim/run';
import { encodeReplay, exportReplay } from '../game/src/sim/replay';
import { RULES } from '../game/src/sim/rules';

function finishedRun(seed: string, rotations = 0) {
  const s = newRun(seed);
  for (let r = 1; r <= RULES.rounds; r++) {
    apply(s, { t: 'pick', i: s.offers.indexOf('crusher') >= 0 ? s.offers.indexOf('crusher') : 0 });
    if (r === 1) {
      const conv = s.layout.machines.find((m) => m.x === 2 && m.y === 2)!;
      apply(s, { t: 'unplace', id: conv.id });
      apply(s, { t: 'place', id: s.bin[0].id, x: 2, y: 2, dir: 0 });
      const other = s.layout.machines.find((m) => m.x === 3 && m.y === 2)!;
      for (let k = 0; k < rotations; k++) apply(s, { t: 'rotate', id: other.id });
    }
    apply(s, { t: 'run' });
    apply(s, { t: 'next' });
  }
  return s;
}
const hasTar = spawnSync('tar', ['--version'], { encoding: 'utf8' }).status === 0;

/** A data directory with hot entries, a claimed player, a cold month, an audit row, events, a secret and a stray temp file. */
function fixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jd-bk-data-'));
  const file = path.join(dir, 'board.json');
  const v = new Verifier(file, { dailySecret: 'fixture-secret' });
  const tOld = new Date('2030-01-10T10:00:00Z');
  const tNow = new Date('2030-03-12T10:00:00Z');
  const pid = playerIdFromToken('a'.repeat(32))!;
  const other = playerIdFromToken('b'.repeat(32))!;
  assert.ok(v.claim(pid, 'Archivist', tOld).ok && v.claim(other, 'Reporter', tOld).ok);
  for (let i = 0; i < 4; i++) assert.ok(v.submit(encodeReplay(exportReplay(finishedRun('hot-seed', i))), `anon ${i}`, null, tNow).recorded);
  assert.ok(v.submit(encodeReplay(exportReplay(finishedRun('mine-seed'))), 'x', pid, tNow).recorded);
  const rec = v.dailyRecord('2030-01-10', tOld)!;
  assert.ok(v.submit(encodeReplay(exportReplay(finishedRun(rec.seed))), 'x', pid, tOld).recorded);
  assert.deepEqual(v.splitCold(tNow).moved, ['2030-01-10']);
  assert.ok(v.report(other, { playerId: pid }, 'spam', tNow).ok); // one audit row in moderation.jsonl
  new EventStore(path.join(dir, 'events.jsonl')).append(
    { installId: 'c'.repeat(32), consent: true, events: [{ name: 'app_start', at: tNow.toISOString() }] } as unknown as Parameters<EventStore['append']>[0],
    '10.0.0.1',
    tNow,
  );
  fs.writeFileSync(path.join(dir, 'daily-secret'), 'fixture-secret\n');
  fs.writeFileSync(path.join(dir, '.board-1-2-3.tmp'), '{}');
  return { dir, v, hot: v.board('hot-seed', 10).length + v.board('mine-seed', 10).length };
}

test(
  '0.8.3 backup: the archive holds the board, cold month, index, audit and events with a hash manifest, never the secret or a temp file; local targets prune by count; rclone targets are recognised',
  { skip: !hasTar && 'tar not on PATH' },
  () => {
    const { dir, hot } = fixture();
    assert.deepEqual(
      listDataFiles(dir),
      ['board.json', 'cold/2030-01.json', 'cold/index.json', 'events.jsonl', 'moderation.jsonl'],
      'the secret and the temp file are not listed',
    );
    const out = fs.mkdtempSync(path.join(os.tmpdir(), 'jd-bk-out-'));
    const t1 = new Date('2030-03-12T03:17:00Z');
    const r1 = backup(dir, { target: out, keep: 2, now: t1 });
    assert.equal(path.basename(r1.archive), 'jd-backup-20300312T031700Z.tar.gz');
    assert.equal(archiveNameFor(t1), path.basename(r1.archive));
    assert.equal(r1.files, 5);
    assert.ok(r1.bytes > 200 && fs.existsSync(r1.archive));
    assert.deepEqual(r1.pruned, []);
    const listing = spawnSync('tar', ['-tzf', path.basename(r1.archive)], { cwd: out, encoding: 'utf8' })
      .stdout.split(/\r?\n/)
      .filter(Boolean)
      .map((l) => l.replace(/\\/g, '/'))
      .sort();
    assert.deepEqual(listing, ['board.json', 'cold/2030-01.json', 'cold/index.json', 'events.jsonl', 'manifest.json', 'moderation.jsonl']);
    assert.ok(!listing.includes('daily-secret') && !listing.some((l) => l.endsWith('.tmp')));
    // prune: the third archive removes the oldest
    backup(dir, { target: out, keep: 2, now: new Date('2030-03-13T03:17:00Z') });
    const r3 = backup(dir, { target: out, keep: 2, now: new Date('2030-03-14T03:17:00Z') });
    assert.deepEqual(r3.pruned, ['jd-backup-20300312T031700Z.tar.gz']);
    assert.deepEqual(
      fs
        .readdirSync(out)
        .filter((f) => f.endsWith('.tar.gz'))
        .sort(),
      ['jd-backup-20300313T031700Z.tar.gz', 'jd-backup-20300314T031700Z.tar.gz'],
    );
    assert.ok(!fs.readdirSync(out).some((f) => f.endsWith('.part')), 'no half-copied archive left behind');
    assert.equal(isRcloneTarget('storagebox:junkyard'), true);
    assert.equal(isRcloneTarget('C:\\backups'), false);
    assert.equal(isRcloneTarget('/var/backups'), false);
    assert.equal(isRcloneTarget('b2:bucket/path'), true);
    assert.throws(() => backup(fs.mkdtempSync(path.join(os.tmpdir(), 'jd-empty-')), { target: out }), /no board\.json/);
    assert.ok(hot >= 5);
  },
);

test(
  "0.8.3 restore drill: a fresh verifier on the restored copy answers the archive's counts and serves sampled entries hot and cold; a tampered archive fails on its hash",
  { skip: !hasTar && 'tar not on PATH', timeout: 120_000 },
  async () => {
    const { dir, hot } = fixture();
    const out = fs.mkdtempSync(path.join(os.tmpdir(), 'jd-bk-out-'));
    const r = backup(dir, { target: out, keep: 0 });
    const drill = await restoreDrill(r.archive, { sample: 4 });
    assert.deepEqual(drill.problems, [], JSON.stringify(drill, null, 1));
    assert.equal(drill.ok, true);
    assert.equal(drill.manifestFiles, 5);
    assert.deepEqual(drill.hashMismatches, []);
    assert.equal(drill.archiveEntries, hot, "the cold day left the hot board; the archive's hot entries are what /health counts");
    assert.equal(drill.restoredEntries, hot);
    assert.equal(drill.sampled.length, 4);
    assert.ok(drill.sampled.every((s) => s.served && s.scoreMatches));
    assert.equal((drill.restoredHealth as { cold: { days: number } }).cold.days, 1, 'the cold month came along');
    assert.equal(drill.restoredTo, null, 'the scratch directory is removed');
    // tamper: unpack, change one byte of the board, re-pack with the old manifest → the drill refuses before starting anything
    const work = fs.mkdtempSync(path.join(os.tmpdir(), 'jd-bk-tamper-'));
    assert.equal(spawnSync('tar', ['-xzf', path.basename(r.archive), '-C', work], { cwd: out }).status, 0);
    const boardFile = path.join(work, 'board.json');
    fs.writeFileSync(boardFile, fs.readFileSync(boardFile, 'utf8').replace('"score": ', '"score":  '));
    const bad = path.join(out, 'tampered.tar.gz');
    assert.equal(
      spawnSync(
        'tar',
        ['-czf', 'tampered.tar.gz', '-C', work, 'board.json', 'cold/2030-01.json', 'cold/index.json', 'events.jsonl', 'moderation.jsonl', 'manifest.json'],
        { cwd: out },
      ).status,
      0,
    );
    const failed = await restoreDrill(bad, { sample: 1 });
    assert.equal(failed.ok, false);
    assert.equal(failed.hashMismatches.length, 1);
    assert.match(failed.hashMismatches[0], /^board\.json/);
    assert.equal(failed.restoredHealth, null, 'nothing was started');
    const missing = await restoreDrill(path.join(out, 'nope.tar.gz'));
    assert.equal(missing.ok, false);
    assert.match(missing.problems[0], /not found/);
  },
);

test(
  '0.8.3 the two command lines: backup prints a JSON report and exits 0; the drill on its archive exits 0; the drill on a missing archive exits 1',
  { skip: !hasTar && 'tar not on PATH', timeout: 120_000 },
  () => {
    const { dir } = fixture();
    const out = fs.mkdtempSync(path.join(os.tmpdir(), 'jd-bk-out-'));
    const b = spawnSync(process.execPath, ['--import', 'tsx', path.join(ROOT, 'tools', 'backup.ts'), dir, '--out', out, '--keep', '3'], {
      cwd: ROOT,
      encoding: 'utf8',
    });
    assert.equal(b.status, 0, b.stderr);
    const rep = JSON.parse(b.stdout) as { archive: string; files: number };
    assert.equal(rep.files, 5);
    assert.ok(fs.existsSync(rep.archive));
    const d = spawnSync(process.execPath, ['--import', 'tsx', path.join(ROOT, 'tools', 'restore-drill.ts'), rep.archive, '--sample', '2'], {
      cwd: ROOT,
      encoding: 'utf8',
    });
    assert.equal(d.status, 0, d.stdout + d.stderr);
    assert.match(d.stdout, /^OK {3}restored \d+ entries, 2 sampled/m);
    const m = spawnSync(process.execPath, ['--import', 'tsx', path.join(ROOT, 'tools', 'restore-drill.ts'), path.join(out, 'missing.tar.gz')], {
      cwd: ROOT,
      encoding: 'utf8',
    });
    assert.equal(m.status, 1);
    assert.match(m.stdout, /FAIL archive not found/);
    const u = spawnSync(process.execPath, ['--import', 'tsx', path.join(ROOT, 'tools', 'backup.ts')], { cwd: ROOT, encoding: 'utf8' });
    assert.equal(u.status, 2);
  },
);
