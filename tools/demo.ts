/**
 * The whole game on this machine, for a person to play: a verifier on the game's default port with a data directory of its own, the
 * stand-ins for the classifier and the mail service, and made-up players on today's yard and this week's, so the boards and the talk
 * have something in them. Nothing leaves this machine: no mail is sent, no classifier is called. Every made-up player is called
 * Demo something, so a screenshot cannot pass for real people, and all of it lives in `.demo/`.
 *
 * Run the game beside it (`npm run dev:all`). Sign-in mail lands on http://127.0.0.1:4402 and the moderation queue is
 * http://127.0.0.1:4400/moderation/ with the token "demo". A post with the word "nasty" comes down, one with "pushy" goes to the queue.
 * When a person's game reaches a board, a few of the made-up players react to it and one answers, so the inbox has something to say.
 *   npm run demo [-- --fresh]
 */
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
// @ts-expect-error a plain JavaScript test helper
import { standIns } from '../tests/e2e/standins.mjs';
import { REACTIONS } from '../game/src/content/reactions';
import { RULES } from '../game/src/sim/rules';
import { Rng } from '../game/src/sim/rng';
import { replay, type Action } from '../game/src/sim/run';
import { exportReplay } from '../game/src/sim/replay';
import { RULES_VERSION } from '../game/src/sim/types';
import { playSeed, type SearchPolicy } from './autoplay-lib';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATA = path.join(ROOT, '.demo');
const VERIFIER = 'http://127.0.0.1:4400';
const MAILBOX_PORT = 4402;
const GAME = 'http://localhost:5173';
const NAMES = ['Ash', 'Bea', 'Cal', 'Dee', 'Eli', 'Fay', 'Gus', 'Hal', 'Ivy', 'Kit', 'Lou', 'Max'].map((n) => `Demo ${n}`);
const TALK = [
  'Second belt before round three was the difference for me.',
  'Anyone else jam the dock on the last shift?',
  'Kept the line short and it paid off.',
  'The offers late on were rough today.',
];
const ANSWERS = ['Nice line. How did you keep it moving at the end?', 'That is a tidy yard.'];

const token = (i: number) => createHash('sha256').update(`demo-${i}`).digest('hex').slice(0, 32);
const email = (i: number) => `demo-${i}@example.com`;
const isDemo = (player: string) => player.startsWith('Demo ');
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function call(method: string, route: string, bearer?: string, body?: unknown) {
  const res = await fetch(`${VERIFIER}${route}`, {
    method,
    headers: { ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}), 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, json: (await res.json().catch(() => ({}))) as Record<string, any> }; // eslint-disable-line @typescript-eslint/no-explicit-any
}

/** Twelve different games on a yard: the bot plays it, then each player stops building after a different round. */
function games(seed: string): Action[][] {
  const full = (['greedy', 'neutral'] as SearchPolicy[]).map((policy) => playSeed(seed, new Rng(`${seed}:demo:${policy}`), 12, { policy }).actions);
  const out: Action[][] = [];
  for (const actions of full)
    for (let stop = RULES.rounds; stop >= 1; stop--) {
      let round = 1;
      const cut = actions.filter((a) => {
        const keep = round <= stop || a.t === 'pick' || a.t === 'run' || a.t === 'next';
        if (a.t === 'next') round++;
        return keep;
      });
      try {
        replay(seed, cut, RULES_VERSION);
        out.push(cut);
      } catch {
        /* a pick that needed a build: one game fewer */
      }
    }
  return out;
}

const filled = new Set<string>();
/** Put the made-up players on a yard once. */
async function fill(route: '/daily' | '/weekly') {
  const { json: yard } = await call('GET', `${route}?limit=50`);
  const seed = yard.seed as string;
  if (filled.has(seed)) return;
  filled.add(seed);
  if (((yard.entries as { player: string }[]) ?? []).some((e) => isDemo(e.player))) return;
  const list = games(seed);
  const sent = await Promise.all(
    list.slice(0, NAMES.length).map(async (actions, i) => {
      const r = await call('POST', '/verify', token(i), { replay: exportReplay(replay(seed, actions, RULES_VERSION)), player: NAMES[i] });
      return r.status === 200 ? 1 : (console.log(`  ${NAMES[i]}: ${r.status} ${JSON.stringify(r.json).slice(0, 120)}`), 0);
    }),
  );
  console.log(`demo: ${sent.reduce((a: number, b) => a + b, 0)} made-up players on ${seed}`);
  if (route !== '/daily') return;
  const { json: board } = await call('GET', `${route}?limit=50`);
  const entries = (board.entries as { replayHash: string }[]) ?? [];
  for (const [n, e] of entries.slice(0, 5).entries())
    for (let i = 0; i < 3 + n; i++)
      await call('POST', '/react', token((n + i + 1) % NAMES.length), { hash: e.replayHash, emote: REACTIONS[(n + i) % REACTIONS.length].id });
  if ((board.talk?.posts ?? 0) < TALK.length) for (const [i, body] of TALK.entries()) await call('POST', '/posts', token(i), { key: board.date, body }); // a restart keeps the talk it had
}

/** A person's game on today's board gets an answer, so the inbox, the reactions and the friends list can be seen working. */
const answered = new Set<string>();
const befriended = new Set<string>();
async function answer() {
  const { json: board } = await call('GET', '/daily?limit=50');
  const people = ((board.entries as { player: string; replayHash: string }[]) ?? []).filter((e) => !isDemo(e.player));
  for (const e of people) {
    if (!answered.has(e.replayHash)) {
      answered.add(e.replayHash);
      for (let i = 0; i < 3; i++) await call('POST', '/react', token(i), { hash: e.replayHash, emote: REACTIONS[i].id });
      await call('POST', '/posts', token(answered.size % 4), { key: e.replayHash, body: ANSWERS[answered.size % ANSWERS.length] });
    }
    // a friend request needs the other side signed in, which a person may do after the game
    if (!befriended.has(e.replayHash) && (await call('POST', '/friends/request', token(answered.size % 4), { hash: e.replayHash })).status === 200)
      befriended.add(e.replayHash);
  }
}

const mailbox = (mails: { to: string[] | string; subject: string; text: string }[]) => {
  const rows = mails
    .slice()
    .reverse()
    .map((m) => {
      const link = /https?:\S+/.exec(m.text)?.[0] ?? '';
      const here = link.replace(GAME, 'http://127.0.0.1:5173');
      return `<li>${String(m.to).replace(/[<>&]/g, '')}: <a href="${link}">open it in this game (localhost)</a> or <a href="${here}">on 127.0.0.1</a></li>`;
    });
  return `<!doctype html><meta charset="utf-8"><meta http-equiv="refresh" content="3"><title>Demo mailbox</title><body style="font:16px system-ui;margin:24px">
<h1>Demo mailbox</h1><p>Sign-in mail lands here instead of being sent. Use the link that matches the address your game is open on.</p><ul>${rows.join('') || '<li>Nothing yet.</li>'}</ul>`;
};

async function main() {
  if (process.argv.includes('--fresh')) fs.rmSync(DATA, { recursive: true, force: true });
  fs.mkdirSync(DATA, { recursive: true });
  const stand = await standIns({ port: MAILBOX_PORT, page: mailbox });
  const verifier = spawn(process.execPath, ['--import', 'tsx', path.join(ROOT, 'server/verify.ts')], {
    stdio: 'inherit',
    env: {
      ...process.env,
      ...stand.env,
      PORT: '4400',
      BOARD_FILE: path.join(DATA, 'board.json'),
      MODERATION_TOKEN: 'demo',
      SITE_URL: GAME,
      RATE_LIMIT: '100000',
      PLAYER_RATE_LIMIT: '100000',
      READ_RATE_LIMIT: '100000',
      WRITE_RATE_LIMIT: '100000',
      POST_RATE_LIMIT: '100000',
    },
  });
  const stop = () => {
    verifier.kill();
    process.exit(0);
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
  verifier.on('exit', () => process.exit(1));
  for (;;) {
    const up = await fetch(`${VERIFIER}/health`).then(
      (r) => r.ok,
      () => false,
    );
    if (up) break;
    await wait(300);
  }
  // the ones who write sign in with email, through the stand-in, the way a player does
  for (let i = 0; i < TALK.length; i++) {
    await call('POST', '/link/start', token(i), { email: email(i) });
    for (let tries = 0; tries < 50 && !stand.mails.some((m: { to: unknown }) => String(m.to) === email(i)); tries++) await wait(50);
    const mail = stand.mails.findLast((m: { to: unknown }) => String(m.to) === email(i));
    const link = /#link=([\w-]+)/.exec(mail?.text ?? '')?.[1];
    if (link) await call('POST', '/link/verify', token(i), { token: link });
  }
  stand.mails.length = 0;
  for (let i = 0; i < NAMES.length; i++) await call('POST', '/identity', token(i), { name: NAMES[i] });
  await fill('/daily');
  await fill('/weekly');
  console.log(`\n  demo ready. Game: ${GAME}   Mailbox: http://127.0.0.1:${MAILBOX_PORT}   Moderation: ${VERIFIER}/moderation/ (token: demo)\n`);
  for (;;) {
    await wait(15_000);
    await Promise.all([fill('/daily'), fill('/weekly'), answer()]).catch((e) => console.log(`demo: ${(e as Error).message}`));
  }
}
void main();
