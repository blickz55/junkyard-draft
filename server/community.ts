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
export const MAX_INBOX_PAGE = 50;
/** A line stays this long after it was read (0.11.7); an unread one stays until it is. */
export const INBOX_READ_DAYS = 60;
/** How long /health may repeat its counts: it is exempt from the read limiter and counting walks an index. */
export const COUNTS_TTL_MS = 60_000;
/** The text of a removed post stays this long, for an appeal; then only the row is left. */
export const REMOVED_TEXT_DAYS = 90;
/** How many decisions and appeals the queue page lists at a time. */
export const MAX_QUEUE_PAGE = 100;

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
 * `private` columns are left out of the export: a block by someone else is theirs, and a link token is a credential. `omit` names
 * columns a player does not get: who the moderator was.
 */
export const PLAYER_COLUMNS: readonly { table: string; column: string; forget: 'delete' | 'clear'; private?: boolean; omit?: readonly string[] }[] = [
  { table: 'accounts', column: 'player_id', forget: 'delete' },
  { table: 'email_links', column: 'player_id', forget: 'delete', private: true },
  { table: 'device_keys', column: 'player_id', forget: 'delete', private: true },
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
  { table: 'moderation_actions', column: 'player_id', forget: 'clear', omit: ['actor', 'reason'] },
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
  triageCategory: string | null;
  triageScore: number | null;
  triagedAt: number | null;
  reasonCode: string | null;
  reviewedAt: number | null;
  editedAt: number | null;
  createdAt: number;
}
/** What others read: `queued` is up and waiting for a person, `hidden` and `deleted` are not up. */
const VISIBLE: readonly PostState[] = ['published', 'queued'];
export interface QueueItem extends Post {
  threadKind: ThreadKind;
  threadKey: string;
  reports: { reason: string; n: number }[];
}
export interface ModerationAction {
  id: number;
  actor: string;
  action: string;
  targetKind: 'post' | 'player' | 'settings';
  targetRef: string;
  playerId: string | null;
  reasonCode: string | null;
  note: string;
  createdAt: number;
  appealBody: string | null;
  appealedAt: number | null;
  appealResult: string | null;
  answeredAt: number | null;
}
export type AppealItem = ModerationAction & { body: string | null };
export interface AuthorRecord {
  posts: number;
  hidden: number;
  removed: number;
  mutedUntil: number | null;
  banned: boolean;
  trusted: boolean;
}
export interface MonthCounts {
  month: string;
  posts: number;
  hidden: number;
  removed: number;
  appeals: number;
  upheld: number;
  overturned: number;
}
export interface TriageUsage {
  calls: number;
  failures: number;
  inputTokens: number;
  outputTokens: number;
}
/** Why a player cannot write now. */
export type WriteBlock = { code: 'not-linked' } | { code: 'banned' } | { code: 'muted'; until: number };
export interface DivisionRow {
  period: string;
  division: number;
  name: string;
  place: number;
  size: number;
  score: number;
  medal: DivisionMedal | null;
}
export interface InboxRow {
  id: number;
  kind: string;
  payload: Record<string, unknown>;
  createdAt: number;
  read: boolean;
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
  triageCategory: r.triage_category as string | null,
  triageScore: r.triage_score as number | null,
  triagedAt: r.triaged_at as number | null,
  reasonCode: r.reason_code as string | null,
  reviewedAt: r.reviewed_at as number | null,
  editedAt: r.edited_at as number | null,
  createdAt: r.created_at as number,
});
const actionOf = (r: Record<string, unknown>): ModerationAction => ({
  id: r.id as number,
  actor: r.actor as string,
  action: r.action as string,
  targetKind: r.target_kind as ModerationAction['targetKind'],
  targetRef: r.target_ref as string,
  playerId: r.player_id as string | null,
  reasonCode: r.reason_code as string | null,
  note: r.reason as string,
  createdAt: r.created_at as number,
  appealBody: r.appeal_body as string | null,
  appealedAt: r.appealed_at as number | null,
  appealResult: r.appeal_result as string | null,
  answeredAt: r.answered_at as number | null,
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
  /** `post_count` counts what others can read, so a post joins it when it goes up and leaves when it comes down. */
  private tally(threadId: number, delta: number, at: number | null): void {
    this.sql('UPDATE threads SET post_count = post_count + ?, last_post_at = COALESCE(?, last_post_at) WHERE id = ?').run(delta, at, threadId);
  }
  /** The moderation pipeline writes with `hidden`: a post waits there for the classifier (server/moderation.ts). */
  addPost(threadId: number, authorId: string | null, body: string, replayHash: string | null = null, state: PostState = 'published'): Post {
    return this.transaction(() => {
      const at = this.now();
      const r = this.sql('INSERT INTO posts (thread_id, author_id, body, replay_hash, state, created_at) VALUES (?, ?, ?, ?, ?, ?) RETURNING *').get(
        threadId,
        authorId,
        body,
        replayHash,
        state,
        at,
      ) as Record<string, unknown>;
      if (VISIBLE.includes(state)) this.tally(threadId, 1, at);
      return postOf(r);
    });
  }
  post(id: number): Post | null {
    const r = this.sql('SELECT * FROM posts WHERE id = ?').get(id) as Record<string, unknown> | undefined;
    return r ? postOf(r) : null;
  }
  /**
   * A page of what a thread shows, oldest first: what is up, and for the viewer their own posts that are not. `next` is the `after`
   * of the following page, null on the last one.
   */
  threadPage(threadId: number, o: { after?: number; limit?: number; viewer?: string | null } = {}): { posts: Post[]; next: number | null } {
    const limit = Math.min(Math.max(1, o.limit ?? 50), MAX_THREAD_PAGE);
    const rows = this.sql(
      "SELECT * FROM posts INDEXED BY posts_thread WHERE thread_id = ? AND id > ? AND (state IN ('published', 'queued') OR (state = 'hidden' AND author_id = ?)) ORDER BY id LIMIT ?",
    ).all(threadId, o.after ?? 0, o.viewer ?? null, limit + 1) as Record<string, unknown>[];
    const posts = rows.slice(0, limit).map(postOf);
    return { posts, next: rows.length > limit ? posts[limit - 1].id : null };
  }

  /** Posts the classifier has not answered for, oldest first. */
  pendingPosts(limit: number): Post[] {
    return (this.sql("SELECT * FROM posts WHERE state = 'hidden' AND triaged_at IS NULL ORDER BY id LIMIT ?").all(limit) as Record<string, unknown>[]).map(
      postOf,
    );
  }
  /** The classifier's answer, or its absence: null when the post no longer waits for one. */
  settlePost(id: number, state: PostState, category: string | null, score: number | null, code: string | null = null): Post | null {
    return this.transaction(() => {
      const at = this.now();
      const r = this.sql(
        "UPDATE posts SET state = ?, triage_category = ?, triage_score = ?, reason_code = ?, triaged_at = ? WHERE id = ? AND state = 'hidden' AND triaged_at IS NULL RETURNING *",
      ).get(state, category, score, code, at, id) as Record<string, unknown> | undefined;
      if (!r) return null;
      if (VISIBLE.includes(state)) this.tally(r.thread_id as number, 1, r.created_at as number);
      return postOf(r);
    });
  }
  /** A decision on a post. `reviewed` when a person made it: reports alone are not a review. */
  movePost(id: number, state: PostState, code: string | null, reviewed: boolean): Post | null {
    return this.transaction(() => {
      const before = this.post(id);
      if (!before) return null;
      const r = this.sql(
        'UPDATE posts SET state = ?, reason_code = ?, reviewed_at = COALESCE(?, reviewed_at), triaged_at = COALESCE(triaged_at, ?) WHERE id = ? RETURNING *',
      ).get(state, code, reviewed ? this.now() : null, this.now(), id) as Record<string, unknown>;
      const was = VISIBLE.includes(before.state),
        is = VISIBLE.includes(state);
      if (was !== is) this.tally(before.threadId, is ? 1 : -1, null);
      return postOf(r);
    });
  }
  /** What a player last wrote and when, so the same words twice in a row can be refused. */
  lastPostOf(authorId: string): Pick<Post, 'body' | 'createdAt'> | null {
    const r = this.sql('SELECT body, created_at FROM posts WHERE author_id = ? ORDER BY id DESC LIMIT 1').get(authorId) as
      { body: string; created_at: number } | undefined;
    return r ? { body: r.body, createdAt: r.created_at } : null;
  }

  /** One report per reporter per post. False when this reporter had already reported it. */
  addReport(kind: 'post' | 'message', ref: number, reporterId: string, reason: string, established = false): boolean {
    return (
      Number(
        this.sql(
          'INSERT INTO reports (target_kind, target_ref, reporter_id, reason, established, created_at) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT DO NOTHING',
        ).run(kind, ref, reporterId, reason, established ? 1 : 0, this.now()).changes,
      ) > 0
    );
  }
  openReports(kind: 'post' | 'message', ref: number): { reason: string; established: boolean }[] {
    return (
      this.sql('SELECT reason, established FROM reports WHERE target_kind = ? AND target_ref = ? AND resolved_at IS NULL').all(kind, ref) as unknown as {
        reason: string;
        established: number;
      }[]
    ).map((r) => ({ reason: r.reason, established: r.established === 1 }));
  }
  resolveReports(kind: 'post' | 'message', ref: number): number {
    return Number(
      this.sql('UPDATE reports SET resolved_at = ? WHERE target_kind = ? AND target_ref = ? AND resolved_at IS NULL').run(this.now(), kind, ref).changes,
    );
  }

  /** What waits for a person, oldest first: anything the classifier or reports held up, anything with an open report. */
  moderationQueue(limit = MAX_QUEUE_PAGE): QueueItem[] {
    const rows = this.sql(
      `SELECT p.*, t.kind AS thread_kind, t.key AS thread_key FROM posts p JOIN threads t ON t.id = p.thread_id
       WHERE (p.state IN ('queued', 'hidden') AND p.triaged_at IS NOT NULL AND p.reviewed_at IS NULL)
          OR p.id IN (SELECT target_ref FROM reports WHERE target_kind = 'post' AND resolved_at IS NULL)
       ORDER BY p.id LIMIT ?`,
    ).all(Math.min(Math.max(1, limit), MAX_QUEUE_PAGE)) as Record<string, unknown>[];
    return rows.map((r) => {
      const post = postOf(r);
      const reports = new Map<string, number>();
      for (const { reason } of this.openReports('post', post.id)) reports.set(reason, (reports.get(reason) ?? 0) + 1);
      return {
        ...post,
        threadKind: r.thread_kind as ThreadKind,
        threadKey: r.thread_key as string,
        reports: [...reports].map(([reason, n]) => ({ reason, n })),
      };
    });
  }
  /** How many posts wait for a person and since when (null: none). */
  queueStats(): { waiting: number; oldest: number | null } {
    const r = this.sql(
      `SELECT COUNT(*) AS n, MIN(created_at) AS oldest FROM posts
       WHERE (state IN ('queued', 'hidden') AND triaged_at IS NOT NULL AND reviewed_at IS NULL)
          OR id IN (SELECT target_ref FROM reports WHERE target_kind = 'post' AND resolved_at IS NULL)`,
    ).get() as { n: number; oldest: number | null };
    return { waiting: r.n, oldest: r.oldest };
  }

  /** One row per decision (0.11.2): the player it is about can appeal it. Returns its id. */
  addAction(a: {
    actor: string;
    action: string;
    targetKind: ModerationAction['targetKind'];
    targetRef: string | number;
    playerId?: string | null;
    code?: string | null;
    note?: string;
  }): number {
    return Number(
      this.sql(
        'INSERT INTO moderation_actions (actor, action, target_kind, target_ref, player_id, reason_code, reason, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      ).run(a.actor, a.action, a.targetKind, String(a.targetRef), a.playerId ?? null, a.code ?? null, a.note ?? '', this.now()).lastInsertRowid,
    );
  }
  action(id: number): ModerationAction | null {
    const r = this.sql('SELECT * FROM moderation_actions WHERE id = ?').get(id) as Record<string, unknown> | undefined;
    return r ? actionOf(r) : null;
  }
  /** The latest decisions, newest first. */
  recentActions(limit = 30): ModerationAction[] {
    return (
      this.sql("SELECT * FROM moderation_actions WHERE target_kind <> 'settings' ORDER BY id DESC LIMIT ?").all(
        Math.min(Math.max(1, limit), MAX_QUEUE_PAGE),
      ) as Record<string, unknown>[]
    ).map(actionOf);
  }
  /** An appeal is one sentence on one decision, once. False when it was already appealed. */
  fileAppeal(id: number, body: string): boolean {
    return (
      Number(
        this.sql('UPDATE moderation_actions SET appeal_body = ?, appealed_at = ? WHERE id = ? AND appealed_at IS NULL').run(body, this.now(), id).changes,
      ) > 0
    );
  }
  answerAppeal(id: number, result: 'upheld' | 'overturned'): boolean {
    return (
      Number(
        this.sql('UPDATE moderation_actions SET appeal_result = ?, answered_at = ? WHERE id = ? AND appealed_at IS NOT NULL AND answered_at IS NULL').run(
          result,
          this.now(),
          id,
        ).changes,
      ) > 0
    );
  }
  /** Appeals waiting for an answer, oldest first, with the words of the post they are about. */
  openAppeals(limit = MAX_QUEUE_PAGE): AppealItem[] {
    const rows = this.sql(
      `SELECT a.*, p.body AS post_body FROM moderation_actions a LEFT JOIN posts p ON a.target_kind = 'post' AND p.id = CAST(a.target_ref AS INTEGER)
       WHERE a.appealed_at IS NOT NULL AND a.answered_at IS NULL ORDER BY a.appealed_at LIMIT ?`,
    ).all(Math.min(Math.max(1, limit), MAX_QUEUE_PAGE)) as Record<string, unknown>[];
    return rows.map((r) => ({ ...actionOf(r), body: r.post_body as string | null }));
  }
  /** Open appeals on decisions about one post. */
  appealsOnPost(postId: number): number[] {
    return (
      this.sql("SELECT id FROM moderation_actions WHERE target_kind = 'post' AND target_ref = ? AND appealed_at IS NOT NULL AND answered_at IS NULL").all(
        String(postId),
      ) as unknown as { id: number }[]
    ).map((r) => r.id);
  }

  /** Why this player cannot write now, or null. Writing needs a linked email (roadmap §4, identity has two levels). */
  writeBlock(playerId: string): WriteBlock | null {
    const r = this.sql('SELECT email_hash, muted_until, banned_at FROM accounts WHERE player_id = ?').get(playerId) as
      { email_hash: string | null; muted_until: number | null; banned_at: number | null } | undefined;
    if (!r?.email_hash) return { code: 'not-linked' };
    if (r.banned_at !== null || this.sql('SELECT 1 FROM banned_emails WHERE email_hash = ?').get(r.email_hash)) return { code: 'banned' };
    return r.muted_until !== null && r.muted_until > this.now() ? { code: 'muted', until: r.muted_until } : null;
  }
  setMute(playerId: string, until: number | null): void {
    this.sql('UPDATE accounts SET muted_until = ? WHERE player_id = ?').run(until, playerId);
  }
  /** A ban holds the player and the address: signing out or deleting the account does not lift it. */
  setBan(playerId: string, banned: boolean): void {
    const at = this.now();
    const hash = this.emailOf(playerId);
    this.sql('UPDATE accounts SET banned_at = ? WHERE player_id = ?').run(banned ? at : null, playerId);
    if (!hash) return;
    if (banned) this.sql('INSERT INTO banned_emails (email_hash, created_at) VALUES (?, ?) ON CONFLICT DO NOTHING').run(hash, at);
    else this.sql('DELETE FROM banned_emails WHERE email_hash = ?').run(hash);
  }
  isTrusted(playerId: string): boolean {
    const r = this.sql('SELECT trusted, email_hash FROM accounts WHERE player_id = ?').get(playerId) as
      { trusted: number; email_hash: string | null } | undefined;
    return !!r?.trusted && r.email_hash !== null;
  }
  setTrusted(playerId: string, trusted: boolean): boolean {
    return Number(this.sql('UPDATE accounts SET trusted = ? WHERE player_id = ?').run(trusted ? 1 : 0, playerId).changes) > 0;
  }
  trustedPlayers(): string[] {
    return (this.sql('SELECT player_id FROM accounts WHERE trusted = 1').all() as unknown as { player_id: string }[]).map((r) => r.player_id);
  }
  /** What a moderator wants to know about the author of a post. */
  authorRecord(playerId: string): AuthorRecord {
    const r = this.sql(
      "SELECT COUNT(*) AS posts, COALESCE(SUM(state = 'hidden'), 0) AS hidden, COALESCE(SUM(state = 'deleted'), 0) AS removed FROM posts WHERE author_id = ?",
    ).get(playerId) as { posts: number; hidden: number; removed: number };
    const a = this.sql('SELECT muted_until, banned_at FROM accounts WHERE player_id = ?').get(playerId) as
      { muted_until: number | null; banned_at: number | null } | undefined;
    return { ...r, mutedUntil: a?.muted_until ?? null, banned: this.writeBlock(playerId)?.code === 'banned', trusted: this.isTrusted(playerId) };
  }
  /** The posts a ban took down, for when the ban turns out to be wrong. */
  postsTakenWithBan(playerId: string, banAction: number): number[] {
    return (
      this.sql("SELECT target_ref FROM moderation_actions WHERE action = 'ban-hide' AND player_id = ? AND id < ? ORDER BY id DESC").all(
        playerId,
        banAction,
      ) as unknown as {
        target_ref: string;
      }[]
    ).map((r) => Number(r.target_ref));
  }
  /** Every post of a player that is up comes down, for a ban. Returns their ids. */
  visiblePostsOf(playerId: string): number[] {
    return (this.sql("SELECT id FROM posts WHERE author_id = ? AND state IN ('published', 'queued')").all(playerId) as unknown as { id: number }[]).map(
      (r) => r.id,
    );
  }
  /** The words of a post removed long ago go; the row stays for the counts. Returns how many went. */
  purgeRemoved(): number {
    return Number(
      this.sql("UPDATE posts SET body = '' WHERE state = 'deleted' AND body <> '' AND created_at < ?").run(this.now() - REMOVED_TEXT_DAYS * 86_400_000).changes,
    );
  }

  /** The counts the policy page publishes (roadmap §4.2), one row per month, newest first; a month with nothing to show has no row. */
  monthlyCounts(months = 12): MonthCounts[] {
    const month = (column: string) => `strftime('%Y-%m', ${column} / 1000, 'unixepoch')`;
    const rows = this.sql(
      `SELECT month, SUM(posts) AS posts, SUM(hidden) AS hidden, SUM(removed) AS removed, SUM(appeals) AS appeals, SUM(upheld) AS upheld, SUM(overturned) AS overturned FROM (
         SELECT ${month('created_at')} AS month, 1 AS posts, 0 AS hidden, 0 AS removed, 0 AS appeals, 0 AS upheld, 0 AS overturned FROM posts
         UNION ALL SELECT ${month('created_at')}, 0, action IN ('auto-hide', 'report-hide', 'hide', 'ban-hide'), action = 'delete', 0, 0, 0 FROM moderation_actions WHERE target_kind = 'post'
         UNION ALL SELECT ${month('appealed_at')}, 0, 0, 0, 1, 0, 0 FROM moderation_actions WHERE appealed_at IS NOT NULL
         UNION ALL SELECT ${month('answered_at')}, 0, 0, 0, 0, appeal_result = 'upheld', appeal_result = 'overturned' FROM moderation_actions WHERE answered_at IS NOT NULL
       ) GROUP BY month ORDER BY month DESC LIMIT ?`,
    ).all(Math.min(Math.max(1, months), 36));
    return rows.map((r) => ({ ...r })) as unknown as MonthCounts[];
  }
  /** Half the posts a person reviewed since then took less than this; null when there are none. */
  medianReviewMs(since: number): number | null {
    const n = (this.sql('SELECT COUNT(*) AS n FROM posts WHERE reviewed_at >= ?').get(since) as { n: number }).n;
    if (!n) return null;
    return (
      this.sql('SELECT reviewed_at - created_at AS ms FROM posts WHERE reviewed_at >= ? ORDER BY ms LIMIT 1 OFFSET ?').get(since, Math.floor((n - 1) / 2)) as {
        ms: number;
      }
    ).ms;
  }

  /** The numbers the owner set; what they have not set stays at the default. */
  moderationSettings<T extends Record<string, number>>(defaults: T): T {
    const out: Record<string, number> = { ...defaults };
    for (const r of this.sql('SELECT key, value FROM moderation_settings').all() as unknown as { key: string; value: number }[])
      if (r.key in out) out[r.key] = r.value;
    return out as T;
  }
  saveModerationSettings(values: Record<string, number>): void {
    const at = this.now();
    for (const [key, value] of Object.entries(values))
      this.sql(
        'INSERT INTO moderation_settings (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at',
      ).run(key, value, at);
  }
  /** A day of the classifier's work, for the budget. */
  recordUsage(day: string, u: Partial<TriageUsage>): void {
    this.sql(
      `INSERT INTO triage_usage (day, calls, failures, input_tokens, output_tokens) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT (day) DO UPDATE SET calls = calls + excluded.calls, failures = failures + excluded.failures,
         input_tokens = input_tokens + excluded.input_tokens, output_tokens = output_tokens + excluded.output_tokens`,
    ).run(day, u.calls ?? 0, u.failures ?? 0, u.inputTokens ?? 0, u.outputTokens ?? 0);
  }
  /** The classifier's work since a day, that day included. */
  usageSince(day: string): TriageUsage {
    const r = this.sql(
      'SELECT COALESCE(SUM(calls), 0) AS calls, COALESCE(SUM(failures), 0) AS failures, COALESCE(SUM(input_tokens), 0) AS i, COALESCE(SUM(output_tokens), 0) AS o FROM triage_usage WHERE day >= ?',
    ).get(day) as { calls: number; failures: number; i: number; o: number };
    return { calls: r.calls, failures: r.failures, inputTokens: r.i, outputTokens: r.o };
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
      this.notify(ownerId, 'reactions', { hash });
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
          JSON.stringify({ period, division: p.division, name: p.key, place: p.place, size: p.size, score, medal: p.medal }),
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

  /** A line for a player's inbox (0.11.7). The same line while it is unread is one line, so a batch stays a batch. */
  notify(playerId: string, kind: string, payload: Record<string, unknown>): void {
    const text = JSON.stringify(payload);
    if (this.sql('SELECT 1 FROM notifications WHERE player_id = ? AND kind = ? AND read_at IS NULL AND payload = ?').get(playerId, kind, text)) return;
    this.sql('INSERT INTO notifications (player_id, kind, payload, created_at) VALUES (?, ?, ?, ?)').run(playerId, kind, text, this.now());
  }
  /** A player's latest lines, newest first, and how many are unread. */
  inbox(playerId: string, limit = 30): { items: InboxRow[]; unread: number } {
    const rows = this.sql('SELECT id, kind, payload, created_at, read_at FROM notifications WHERE player_id = ? ORDER BY id DESC LIMIT ?').all(
      playerId,
      Math.min(Math.max(1, limit), MAX_INBOX_PAGE),
    ) as unknown as { id: number; kind: string; payload: string; created_at: number; read_at: number | null }[];
    const unread = (this.sql('SELECT COUNT(*) AS n FROM notifications WHERE player_id = ? AND read_at IS NULL').get(playerId) as { n: number }).n;
    return {
      items: rows.map((r) => ({
        id: r.id,
        kind: r.kind,
        payload: JSON.parse(r.payload) as Record<string, unknown>,
        createdAt: r.created_at,
        read: r.read_at !== null,
      })),
      unread,
    };
  }
  /** Everything unread is read now; lines read long ago go. Returns how many were unread. */
  markRead(playerId: string): number {
    const at = this.now();
    this.sql('DELETE FROM notifications WHERE player_id = ? AND read_at IS NOT NULL AND read_at < ?').run(playerId, at - INBOX_READ_DAYS * 86_400_000);
    return Number(this.sql('UPDATE notifications SET read_at = ? WHERE player_id = ? AND read_at IS NULL').run(at, playerId).changes);
  }

  /** A one-time link (0.11.1): only hashes are kept. Links long dead go now, so the table stays small. */
  startLink(tokenHash: string, emailHash: string, playerId: string, ttlMs: number): void {
    const at = this.now();
    this.sql('DELETE FROM email_links WHERE expires_at < ?').run(at - 86_400_000);
    this.sql('INSERT INTO email_links (token_hash, email_hash, player_id, created_at, expires_at) VALUES (?, ?, ?, ?, ?)').run(
      tokenHash,
      emailHash,
      playerId,
      at,
      at + ttlMs,
    );
  }
  /** Use a link, once: the address's hash, or null when it is unknown, spent or expired. */
  takeLink(tokenHash: string): string | null {
    const at = this.now();
    const r = this.sql('UPDATE email_links SET used_at = ? WHERE token_hash = ? AND used_at IS NULL AND expires_at >= ? RETURNING email_hash').get(
      at,
      tokenHash,
      at,
    ) as { email_hash: string } | undefined;
    return r?.email_hash ?? null;
  }
  /** The player an address belongs to. */
  playerByEmail(emailHash: string): string | null {
    return (this.sql('SELECT player_id FROM accounts WHERE email_hash = ?').get(emailHash) as { player_id: string } | undefined)?.player_id ?? null;
  }
  /** The hash of the address a player linked, or null. */
  emailOf(playerId: string): string | null {
    return (this.sql('SELECT email_hash FROM accounts WHERE player_id = ?').get(playerId) as { email_hash: string | null } | undefined)?.email_hash ?? null;
  }
  isLinked(playerId: string): boolean {
    return this.emailOf(playerId) !== null;
  }
  hasAccount(playerId: string): boolean {
    return !!this.sql('SELECT 1 FROM accounts WHERE player_id = ?').get(playerId);
  }
  bindEmail(playerId: string, emailHash: string): void {
    const at = this.now();
    this.sql(
      'INSERT INTO accounts (player_id, email_hash, linked_at, created_at) VALUES (?, ?, ?, ?) ON CONFLICT (player_id) DO UPDATE SET email_hash = excluded.email_hash, linked_at = excluded.linked_at',
    ).run(playerId, emailHash, at, at);
  }
  /** A device signed in: from now on the hash of its key stands for this player. */
  addDeviceKey(keyId: string, playerId: string): void {
    this.sql('INSERT INTO device_keys (key_id, player_id, created_at) VALUES (?, ?, ?) ON CONFLICT (key_id) DO UPDATE SET player_id = excluded.player_id').run(
      keyId,
      playerId,
      this.now(),
    );
  }
  /** Who a device key stands for, when it signed in as someone else. Called on every request with a key. */
  playerOfKey(keyId: string): string | null {
    return (this.sql('SELECT player_id FROM device_keys WHERE key_id = ?').get(keyId) as { player_id: string } | undefined)?.player_id ?? null;
  }
  deviceKeysOf(playerId: string): string[] {
    return (this.sql('SELECT key_id FROM device_keys WHERE player_id = ?').all(playerId) as unknown as { key_id: string }[]).map((r) => r.key_id);
  }
  /** Forget the address and what travelled with it. The device asking stays this player; the others go back to being themselves. */
  unlink(playerId: string, keepKey: string): boolean {
    return this.transaction(() => {
      if (!this.isLinked(playerId)) return false;
      this.sql('UPDATE accounts SET email_hash = NULL, linked_at = NULL, sync_blob = NULL WHERE player_id = ?').run(playerId);
      this.sql('DELETE FROM email_links WHERE player_id = ?').run(playerId);
      this.sql('DELETE FROM device_keys WHERE player_id = ? AND key_id <> ?').run(playerId, keepKey);
      return true;
    });
  }
  syncBlob(playerId: string): string | null {
    return (this.sql('SELECT sync_blob FROM accounts WHERE player_id = ?').get(playerId) as { sync_blob: string | null } | undefined)?.sync_blob ?? null;
  }
  saveSync(playerId: string, blob: string): void {
    this.sql('UPDATE accounts SET sync_blob = ? WHERE player_id = ?').run(blob, playerId);
  }

  /** Everything stored under a player, for `/me/export`. */
  exportPlayer(playerId: string): Record<string, Record<string, unknown>[]> {
    const out: Record<string, Record<string, unknown>[]> = {};
    for (const c of PLAYER_COLUMNS) {
      if (c.private) continue;
      const rows = this.sql(`SELECT * FROM ${c.table} WHERE ${c.column} = ?`).all(playerId) as Record<string, unknown>[];
      for (const r of rows) for (const k of c.omit ?? []) delete r[k];
      if (rows.length) out[c.table] = [...(out[c.table] ?? []), ...rows];
    }
    return out;
  }
  /** `DELETE /me`: their rows go, what others read keeps its place with no name on it. Returns the rows touched. */
  forget(playerId: string): number {
    return this.transaction(() => {
      this.sql(
        "UPDATE threads SET post_count = post_count - (SELECT COUNT(*) FROM posts p WHERE p.thread_id = threads.id AND p.author_id = ? AND p.state IN ('published', 'queued')) WHERE id IN (SELECT thread_id FROM posts WHERE author_id = ?)",
      ).run(playerId, playerId);
      let n = 0;
      // what they wrote to a moderator goes with them, and an appeal still open has nobody left to answer; the decision stays in the log with no name on it
      n += Number(
        this.sql(
          "UPDATE moderation_actions SET appeal_body = NULL, appeal_result = COALESCE(appeal_result, 'withdrawn'), answered_at = COALESCE(answered_at, ?) WHERE player_id = ? AND appealed_at IS NOT NULL",
        ).run(this.now(), playerId).changes,
      );
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
