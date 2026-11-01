// A stand-in for Cloudflare's D1 on node:sqlite: the test link's worker runs here against its real schema, never against the real database.
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import type { Db, Statement } from '../../deploy/test-link/worker';

export function standInD1(): Db & { rows<T>(sql: string, ...args: SQLInputValue[]): T[] } {
  const db = new DatabaseSync(':memory:');
  db.exec(fs.readFileSync(path.resolve(import.meta.dirname, '../../deploy/test-link/schema.sql'), 'utf8'));
  const statement = (sql: string, args: SQLInputValue[] = []): Statement => ({
    bind: (...values) => statement(sql, values as SQLInputValue[]),
    run: async () => db.prepare(sql).run(...args),
    first: async <T>() => (db.prepare(sql).get(...args) as T | undefined) ?? null,
  });
  return {
    prepare: (sql) => statement(sql),
    batch: async (list) => {
      for (const s of list) await s.run();
    },
    rows: <T>(sql: string, ...args: SQLInputValue[]) => db.prepare(sql).all(...args) as T[],
  };
}
