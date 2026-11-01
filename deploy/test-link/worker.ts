/**
 * What stands behind the private test link (npm run deploy:test): two routes on Cloudflare Pages and a small D1 database. /events takes
 * the game's play data, held to the same fixed vocabulary as the verifier, and /feedback takes the survey and hands back a completion
 * code. Everything else is the static game, because `_routes.json` sends only these two here. No address is stored. Rows are read with
 * tools/playtest-report.ts, by the owner only.
 */
import { validateBatch } from '../../game/src/telemetry/events';

export interface Statement {
  bind(...values: unknown[]): Statement;
  run(): Promise<unknown>;
  first<T>(): Promise<T | null>;
}
export interface Db {
  prepare(sql: string): Statement;
  batch(list: Statement[]): Promise<unknown>;
}
export interface Env {
  DB: Db;
  ASSETS: { fetch(request: Request): Promise<Response> };
}
export interface Answers {
  goal: string;
  clear: number;
  fun: number;
  back: string;
  worst: string;
  pay: string;
}

const MAX_BODY = 64 * 1024;
const MAX_TEXT = 1000;
const INSTALL = /^[0-9a-f]{32}$/;
const TESTER = /^[\w-]{1,64}$/;
const YES_NO = ['yes', 'maybe', 'no'];
const CODE_LETTERS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

async function read(request: Request): Promise<unknown> {
  const text = await request.text();
  if (text.length > MAX_BODY) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/** A code a tester can paste back where they signed up: eight letters and digits nobody can misread. */
export function makeCode(): string {
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  const letters = Array.from(bytes, (b) => CODE_LETTERS[b % CODE_LETTERS.length]).join('');
  return `${letters.slice(0, 4)}-${letters.slice(4)}`;
}

/** The survey as it may be stored, or null when it is not one. */
export function cleanAnswers(raw: unknown): Answers | null {
  const a = raw as Partial<Record<keyof Answers, unknown>> | null;
  if (!a || typeof a !== 'object') return null;
  const scale = (v: unknown) => Number.isInteger(v) && (v as number) >= 1 && (v as number) <= 5;
  const text = (v: unknown) => typeof v === 'string' && v.trim().length > 0 && v.length <= MAX_TEXT;
  if (!text(a.goal) || !text(a.worst) || !scale(a.clear) || !scale(a.fun)) return null;
  if (!YES_NO.includes(a.back as string) || !YES_NO.includes(a.pay as string)) return null;
  return {
    goal: (a.goal as string).trim(),
    clear: a.clear as number,
    fun: a.fun as number,
    back: a.back as string,
    worst: (a.worst as string).trim(),
    pay: a.pay as string,
  };
}

export async function takeEvents(request: Request, env: Env): Promise<Response> {
  const batch = validateBatch(await read(request));
  if (typeof batch === 'string') return json(422, { ok: false });
  const received = new Date().toISOString();
  await env.DB.batch(
    batch.events.map((e) =>
      env.DB.prepare('INSERT OR IGNORE INTO events (install, id, name, props, at, received) VALUES (?, ?, ?, ?, ?, ?)').bind(
        batch.installId,
        e.id ?? null,
        e.name,
        JSON.stringify(e.props ?? {}),
        e.at,
        received,
      ),
    ),
  );
  return json(200, { ok: true });
}

export async function takeFeedback(request: Request, env: Env): Promise<Response> {
  const body = (await read(request)) as { install?: unknown; tester?: unknown; answers?: unknown } | null;
  const answers = cleanAnswers(body?.answers);
  if (!answers) return json(422, { ok: false });
  const install = typeof body?.install === 'string' && INSTALL.test(body.install) ? body.install : null;
  const tester = typeof body?.tester === 'string' && TESTER.test(body.tester) ? body.tester : null;
  if (install) {
    // one set of answers from a device: a second send gets the first code back
    const seen = await env.DB.prepare('SELECT code FROM feedback WHERE install = ?').bind(install).first<{ code: string }>();
    if (seen) return json(200, { ok: true, code: seen.code });
  }
  const code = makeCode();
  await env.DB.prepare('INSERT INTO feedback (code, install, tester, answers, received) VALUES (?, ?, ?, ?, ?)')
    .bind(code, install, tester, JSON.stringify(answers), new Date().toISOString())
    .run();
  return json(200, { ok: true, code });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const { pathname } = new URL(request.url);
    if (request.method === 'POST' && pathname === '/events') return takeEvents(request, env);
    if (request.method === 'POST' && pathname === '/feedback') return takeFeedback(request, env);
    return env.ASSETS.fetch(request);
  },
};
