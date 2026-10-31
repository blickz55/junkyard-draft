/**
 * The community store (production roadmap 0.11.0): everything social lives in one SQLite file next to the board, on Node's
 * built-in node:sqlite; the board stays JSON until its own trigger fires. Migrations are numbered SQL modules under
 * server/migrations, compiled in so the verifier stays one file and a build cannot ship without them. They are applied at
 * start, each in one transaction and recorded with a hash: an applied one that changed or a gap in the numbers stops the start.
 * A database newer than this code runs as it is, because migrations only add and a rollback to the previous image has to keep
 * working.
 *
 * Free text reaches this store only through the moderation pipeline (0.11.2): nothing here looks at a body.
 */
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import type { DatabaseSync, StatementSync } from 'node:sqlite';
import { MIGRATIONS } from './migrations';
import { divisionSizes, placeDivisions, type DivisionMedal } from '../game/src/daily/divisions';

/** On first use: a static import prints Node's ExperimentalWarning in every tool and test that touches server/verify.ts. */
const sqlite = () => process.getBuiltinModule('node:sqlite');

export const COMMUNITY_DB = 'community.db';
export const MAX_THREAD_PAGE = 100;
/** How long /health may repeat its counts: it is exempt from the read limiter and counting walks an index. */
export const COUNTS_TTL_MS = 60_000;

export interface MigrationSource {
  version: number;
  name: string;
  up: string;
  down: string;
}
export interface Migration extends MigrationSource {
  hash: string;
}

/** Numbers run 1, 2, 3 with no gap, or nothing starts. */
export function hashMigrations(list: readonly MigrationSource[]): Migration[] {
  return list.map((m, i) => {
    if (m.version !== i + 1) throw new Error(`migration ${m.version}-${m.name} is out of sequence: expected ${i + 1}`);
    return { ...m, hash: createHash('sha256').update(m.up).digest('hex') };
  });
}

/**
 * Every column that holds a player id, and what forgetting the player does to its rows. `DELETE /me` and `/me/export` run on
 * this list; tests/community.test.ts walks the schema, so a new column cannot be left out of the right to be forgotten.
 * `private` columns are left out of the export: a block by someone else is theirs, and a link token is a credential.
 */
export const PLAYER_COLUMNS: readonly { table: string; column: string; forget: 'delete' | 'clear'; private?: boolean }[] = [
  { table: 'accounts', column: 'player_id', forget: 'delete' },
  { table: 'email_links', column: 'player_id', forget: 'delete', private: true },
  { table: 'threads', column: 'author_id', forget: 'clear' },
  { table: 'posts', column: 'author_id', forget: 'delete' },
  { table: 'reactions', column: 'player_id', forget: 'delete' },
  { table: 'views', column: 'viewer_id', forget: 'delete' },
  { table: 'friends', column: 'player_id', forget: 'delete' },
  { table: 'friends', column: 'other_id', forget: 'delete', private: true },
  { table: 'messages', column: 'sender_id', forget: 'delete' },
  { table: 'messages', column: 'recipient_id', forget: 'delete' },
  { table: 'notifications', column: 'player_id', forget: 'delete' },
  { table: 'push_subscriptions', column: 'player_id', forget: 'delete' },
  { table: 'reports', column: 'reporter_id', forget: 'delete' },
  { table: 'divisions', column: 'player_id', forget: 'clear' },
  { table: 'trophies', column: 'player_id', forget: 'delete' },
  { table: 'cosmetics', column: 'player_id', forget: 'delete' },
];

export type ThreadKind = 'daily' | 'weekly' | 'run' | 'hub';
export type PostState = 'published' | 'queued' | 'hidden' | 'deleted';
export interface Thread {
  id: number;
  kind: ThreadKind;
  key: string;
  title: string | null;
  postCount: number;
  lastPostAt: number | null;
  createdAt: number;
}
export interface Post {
  id: number;
  threadId: number;
  authorId: string | null;
  body: string;
  replayHash: string | null;
  state: PostState;
  editedAt: number | null;
  createdAt: number;
}
export interface DivisionRow {
  period: string;
  division: number;
  name: string;
  place: number;
  size: number;
  score: number;
  medal: DivisionMedal | null;
}
export interface CommunityCounts {
  accounts: number;
  threads: number;
  posts: number;
}
export interface CommunityOptions {
  migrations?: readonly MigrationSource[];
  now?: () => number;
  /** false leaves the schema as it is (the operator's tool going down); default true */
  migrate?: boolean;
}

const threadOf = (r: Record<string, unknown>): Thread => ({
  id: r.id as number,
  kind: r.kind as ThreadKind,
  key: r.key as string,
  title: r.title as string | null,
  postCount: r.post_count as number,
  lastPostAt: r.last_post_at as number | null,
  createdAt: r.created_at as number,
});
const postOf = (r: Record<string, unknown>): Post => ({
  id: r.id as number,
  threadId: r.thread_id as number,
  authorId: r.author_id as string | null,
  body: r.body as string,
  replayHash: r.replay_hash as string | null,
  state: r.state as PostState,
  editedAt: r.edited_at as number | null,
  createdAt: r.created_at as number,
});

export class CommunityStore {
  private readonly db: DatabaseSync;
  private readonly now: () => number;
  private readonly statements = new Map<string, StatementSync>();
  private counted: { at: number; counts: CommunityCounts } | null = null;
  readonly migrations: Migration[];

  constructor(
    readonly file: string,
    opts: CommunityOptions = {},
  ) {
    this.now = opts.now ?? Date.now;
    this.migrations = hashMigrations(opts.migrations ?? MIGRATIONS);
    fs.mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
    this.db = new (sqlite().DatabaseSync)(file, { timeout: 2000 });
    this.db.exec('PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL;');
    this.db.exec(
      'CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, name TEXT NOT NULL, hash TEXT NOT NULL, applied_at INTEGER NOT NULL)',
    );
    if (opts.migrate !== false) this.migrate();
  }
  close(): void {
    this.statements.clear();
    this.db.close();
  }

  private sql(text: string): StatementSync {
    let s = this.statements.get(text);
    if (!s) this.statements.set(text, (s = this.db.prepare(text)));
    return s;
  }
  private transaction<T>(fn: () => T): T {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const out = fn();
      this.db.exec('COMMIT');
      return out;
    } catch (e) {
      this.db.exec('ROLLBACK');
      throw e;
    }
  }

  /** The highest migration applied. */
  get version(): number {
    return (this.sql('SELECT COALESCE(MAX(version), 0) AS v FROM schema_migrations').get() as { v: number }).v;
  }
  /** Applies what is missing, up to `target`. Returns the versions it ran. */
  migrate(target = this.migrations.length): number[] {
    const applied = this.db.prepare('SELECT version, name, hash FROM schema_migrations ORDER BY version').all() as unknown as {
      version: number;
      name: string;
      hash: string;
    }[];
    for (const a of applied) {
      const m = this.migrations[a.version - 1];
      if (m && m.hash !== a.hash) throw new Error(`migration ${a.version}-${a.name} was changed after it was applied: write a new one instead`);
    }
    const ran: number[] = [];
    for (const m of this.migrations.slice(applied.length, target)) {
      this.transaction(() => {
        this.db.exec(m.up);
        this.db.prepare('INSERT INTO schema_migrations (version, name, hash, applied_at) VALUES (?, ?, ?, ?)').run(m.version, m.name, m.hash, this.now());
      });
      ran.push(m.version);
    }
    this.statements.clear();
    return ran;
  }
  /** Runs the down files from the top until `target` is the highest applied. Returns the versions it reversed. */
  rollback(target: number): number[] {
    const ran: number[] = [];
    for (let v = this.version; v > target; v--) {
      const m = this.migrations[v - 1];
      if (!m) throw new Error(`no down file for migration ${v}: the database is newer than this code`);
      this.statements.clear();
      this.transaction(() => {
        this.db.exec(m.down);
        this.db.prepare('DELETE FROM schema_migrations WHERE version = ?').run(v);
      });
      ran.push(v);
    }
    return ran;
  }

  /** The thread for a daily, a week, a run or a hub topic, made on first use. */
  threadFor(kind: ThreadKind, key: string, title: string | null = null): Thread {
    this.sql('INSERT INTO threads (kind, key, title, created_at) VALUES (?, ?, ?, ?) ON CONFLICT (kind, key) DO NOTHING').run(kind, key, title, this.now());
    return threadOf(this.sql('SELECT * FROM threads WHERE kind = ? AND key = ?').get(kind, key) as Record<string, unknown>);
  }
  addPost(threadId: number, authorId: string | null, body: string, replayHash: string | null = null): Post {
    return this.transaction(() => {
      const at = this.now();
      const r = this.sql('INSERT INTO posts (thread_id, author_id, body, replay_hash, created_at) VALUES (?, ?, ?, ?, ?) RETURNING *').get(
        threadId,
        authorId,
        body,
        replayHash,
        at,
      ) as Record<string, unknown>;
      this.sql('UPDATE threads SET post_count = post_count + 1, last_post_at = ? WHERE id = ?').run(at, threadId);
      return postOf(r);
    });
  }
  /** A page of a thread's published posts, oldest first. `next` is the `after` of the following page, null on the last one. */
  threadPage(threadId: number, o: { after?: number; limit?: number } = {}): { posts: Post[]; next: number | null } {
    const limit = Math.min(Math.max(1, o.limit ?? 50), MAX_THREAD_PAGE);
    const rows = this.sql("SELECT * FROM posts WHERE thread_id = ? AND state = 'published' AND id > ? ORDER BY id LIMIT ?").all(
      threadId,
      o.after ?? 0,
      limit + 1,
    ) as Record<string, unknown>[];
    const posts = rows.slice(0, limit).map(postOf);
    return { posts, next: rows.length > limit ? posts[limit - 1].id : null };
  }

  /**
   * A player's reaction to a run (0.11.3): one per player per run, a new one replaces it, null takes it back. The run's owner
   * gets one unread line per run however many people react, never one for their own.
   */
  react(hash: string, playerId: string, emote: string | null, ownerId: string | null = null): void {
    this.transaction(() => {
      if (emote === null) {
        this.sql('DELETE FROM reactions WHERE replay_hash = ? AND player_id = ?').run(hash, playerId);
        return;
      }
      const at = this.now();
      this.sql(
        'INSERT INTO reactions (replay_hash, player_id, emote, created_at) VALUES (?, ?, ?, ?) ON CONFLICT (replay_hash, player_id) DO UPDATE SET emote = excluded.emote, created_at = excluded.created_at',
      ).run(hash, playerId, emote, at);
      if (!ownerId || ownerId === playerId) return;
      const payload = JSON.stringify({ hash });
      const unread = this.sql("SELECT 1 FROM notifications WHERE player_id = ? AND kind = 'reactions' AND read_at IS NULL AND payload = ?").get(
        ownerId,
        payload,
      );
      if (!unread) this.sql("INSERT INTO notifications (player_id, kind, payload, created_at) VALUES (?, 'reactions', ?, ?)").run(ownerId, payload, at);
    });
  }
  /** The counts per emote on each of these runs; a run nobody reacted to is not in the map. */
  reactionsOn(hashes: readonly string[]): Map<string, Record<string, number>> {
    const out = new Map<string, Record<string, number>>();
    const rows = this.sql(
      'SELECT replay_hash, emote, COUNT(*) AS n FROM reactions WHERE replay_hash IN (SELECT value FROM json_each(?)) GROUP BY replay_hash, emote',
    ).all(JSON.stringify(hashes)) as unknown as { replay_hash: string; emote: string; n: number }[];
    for (const r of rows) out.set(r.replay_hash, { ...out.get(r.replay_hash), [r.emote]: r.n });
    return out;
  }
  reactionOf(hash: string, playerId: string): string | null {
    const r = this.sql('SELECT emote FROM reactions WHERE replay_hash = ? AND player_id = ?').get(hash, playerId) as { emote: string } | undefined;
    return r?.emote ?? null;
  }

  /** A player watched a run (0.11.4): the same viewer twice is one viewer who watched twice. */
  sawRun(hash: string, viewerId: string): void {
    const at = this.now();
    this.sql(
      'INSERT INTO views (replay_hash, viewer_id, first_at, last_at) VALUES (?, ?, ?, ?) ON CONFLICT (replay_hash, viewer_id) DO UPDATE SET times = times + 1, last_at = excluded.last_at',
    ).run(hash, viewerId, at, at);
  }
  seenBy(hash: string): { times: number; players: number } {
    return this.sql('SELECT COALESCE(SUM(times), 0) AS times, COUNT(*) AS players FROM views WHERE replay_hash = ?').get(hash) as {
      times: number;
      players: number;
    };
  }

  /**
   * A day's divisions, computed once when it closes (0.11.11). `ranked` is the final board, one row per player, best first.
   * Medals and a place in a top division add to trophies that never decay, and each player gets one line for the inbox.
   * Returns the placements written: 0 for a day already closed, or a day nobody played.
   */
  closeDay(period: string, ranked: readonly { playerId: string; score: number }[]): number {
    return this.transaction(() => {
      if (this.sql('SELECT 1 FROM divisions WHERE period = ? LIMIT 1').get(period)) return 0;
      const at = this.now();
      const placed = placeDivisions(ranked);
      const several = divisionSizes(ranked.length).length > 1;
      const trophy = (playerId: string, kind: string) =>
        this.sql(
          'INSERT INTO trophies (player_id, kind, count, last_at) VALUES (?, ?, 1, ?) ON CONFLICT (player_id, kind) DO UPDATE SET count = count + 1, last_at = excluded.last_at',
        ).run(playerId, kind, at);
      for (const p of placed) {
        const { playerId, score } = p.player;
        this.sql('INSERT INTO divisions (period, division, name, player_id, place, score, medal) VALUES (?, ?, ?, ?, ?, ?, ?)').run(
          period,
          p.division,
          p.key,
          playerId,
          p.place,
          score,
          p.medal,
        );
        if (p.medal) trophy(playerId, `medal-${p.medal}`);
        if (several && p.division === 0) trophy(playerId, 'top-division');
        this.sql("INSERT INTO notifications (player_id, kind, payload, created_at) VALUES (?, 'division', ?, ?)").run(
          playerId,
          JSON.stringify({ period, name: p.key, place: p.place, size: p.size, medal: p.medal }),
          at,
        );
      }
      return placed.length;
    });
  }
  /** A player's latest placements, newest first. */
  divisionsOf(playerId: string, limit = 7): DivisionRow[] {
    return this.sql(
      'SELECT period, division, name, place, score, medal, (SELECT COUNT(*) FROM divisions o WHERE o.period = d.period AND o.division = d.division) AS size FROM divisions d WHERE player_id = ? ORDER BY id DESC LIMIT ?',
    )
      .all(playerId, Math.min(Math.max(1, limit), 50))
      .map((r) => ({ ...r })) as unknown as DivisionRow[];
  }
  /** One division's final board, in order. A forgotten player's row stays with no id. */
  divisionBoard(period: string, division: number): (Omit<DivisionRow, 'size'> & { playerId: string | null })[] {
    return (
      this.sql('SELECT period, division, name, player_id, place, score, medal FROM divisions WHERE period = ? AND division = ? ORDER BY place').all(
        period,
        division,
      ) as unknown as (Omit<DivisionRow, 'size'> & { player_id: string | null })[]
    ).map(({ player_id, ...r }) => ({ ...r, playerId: player_id }));
  }
  trophiesOf(playerId: string): Record<string, number> {
    const rows = this.sql('SELECT kind, count FROM trophies WHERE player_id = ?').all(playerId) as unknown as { kind: string; count: number }[];
    return Object.fromEntries(rows.map((r) => [r.kind, r.count]));
  }

  /** Everything stored under a player, for `/me/export`. */
  exportPlayer(playerId: string): Record<string, Record<string, unknown>[]> {
    const out: Record<string, Record<string, unknown>[]> = {};
    for (const c of PLAYER_COLUMNS) {
      if (c.private) continue;
      const rows = this.sql(`SELECT * FROM ${c.table} WHERE ${c.column} = ?`).all(playerId) as Record<string, unknown>[];
      if (rows.length) out[c.table] = [...(out[c.table] ?? []), ...rows];
    }
    return out;
  }
  /** `DELETE /me`: their rows go, what others read keeps its place with no name on it. Returns the rows touched. */
  forget(playerId: string): number {
    return this.transaction(() => {
      this.sql(
        "UPDATE threads SET post_count = post_count - (SELECT COUNT(*) FROM posts p WHERE p.thread_id = threads.id AND p.author_id = ? AND p.state = 'published') WHERE id IN (SELECT thread_id FROM posts WHERE author_id = ?)",
      ).run(playerId, playerId);
      let n = 0;
      // reports on what is about to go: nothing left to review
      n += Number(
        this.sql("DELETE FROM reports WHERE target_kind = 'post' AND target_ref IN (SELECT id FROM posts WHERE author_id = ?)").run(playerId).changes,
      );
      n += Number(
        this.sql("DELETE FROM reports WHERE target_kind = 'message' AND target_ref IN (SELECT id FROM messages WHERE sender_id = ? OR recipient_id = ?)").run(
          playerId,
          playerId,
        ).changes,
      );
      for (const c of PLAYER_COLUMNS) {
        const statement =
          c.forget === 'delete' ? `DELETE FROM ${c.table} WHERE ${c.column} = ?` : `UPDATE ${c.table} SET ${c.column} = NULL WHERE ${c.column} = ?`;
        n += Number(this.sql(statement).run(playerId).changes);
      }
      return n;
    });
  }

  private counts(): CommunityCounts {
    const at = this.now();
    if (this.counted && at - this.counted.at < COUNTS_TTL_MS) return this.counted.counts;
    const count = (table: string) => (this.sql(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n;
    const counts = { accounts: count('accounts'), threads: count('threads'), posts: count('posts') };
    this.counted = { at, counts };
    return counts;
  }
  /** What `/health` reports: the size on disk, the schema and the counts. */
  health(): CommunityCounts & { bytes: number; schema: number } {
    const size = (f: string) => (fs.existsSync(f) ? fs.statSync(f).size : 0);
    return { bytes: size(this.file) + size(`${this.file}-wal`), schema: this.version, ...this.counts() };
  }
}

/** A consistent copy of a live database. A plain file copy of a database in WAL mode can tear; VACUUM INTO cannot. */
export function snapshotDatabase(file: string, dest: string): void {
  const db = new (sqlite().DatabaseSync)(file, { readOnly: true, timeout: 5000 });
  try {
    db.prepare('VACUUM INTO ?').run(dest);
  } finally {
    db.close();
  }
}

/** What an archived database holds, without migrating or writing to it. */
export function inspectDatabase(file: string): CommunityCounts & { integrity: string; schema: number } {
  const db = new (sqlite().DatabaseSync)(file, { readOnly: true });
  try {
    const schema = (db.prepare('SELECT COALESCE(MAX(version), 0) AS v FROM schema_migrations').get() as { v: number }).v;
    const count = (table: string) => (schema ? (db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n : 0);
    return {
      integrity: (db.prepare('PRAGMA integrity_check').get() as { integrity_check: string }).integrity_check,
      schema,
      accounts: count('accounts'),
      threads: count('threads'),
      posts: count('posts'),
    };
  } finally {
    db.close();
  }
}
