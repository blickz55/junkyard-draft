// The private test link: what stands behind it (deploy/test-link/worker.ts) on a stand-in for its database, and the report that reads it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import worker, { cleanAnswers, makeCode, type Answers, type Env } from '../deploy/test-link/worker';
import { LESSONS } from '../game/src/content/lessons';
import { render, stepLabel, summarize, type EventRow, type FeedbackRow } from '../tools/playtest-lib';
import { standInD1 } from './e2e/d1';

const INSTALL = 'a'.repeat(32);
const ANSWERS: Answers = { goal: 'Make the money the job asks for', clear: 4, fun: 3, back: 'yes', worst: 'Which way the belts go', pay: 'no' };
const AT = '2026-11-01T12:00:00.000Z';

function place() {
  const DB = standInD1();
  return { DB, env: { DB, ASSETS: { fetch: async () => new Response('the game') } } satisfies Env };
}
const post = (env: Env, route: string, body: unknown) =>
  worker.fetch(new Request(`https://link.test${route}`, { method: 'POST', body: typeof body === 'string' ? body : JSON.stringify(body) }), env);
const batch = (events: unknown[], over: object = {}) => ({ installId: INSTALL, consent: true, events, ...over });

test('play data: what the fixed list allows is kept, a batch sent twice counts once, and nothing else gets in', async () => {
  const { DB, env } = place();
  const events = [
    { name: 'app_start', at: AT, id: 'b'.repeat(16) },
    { name: 'tutorial_step_start', props: { n: 2 }, at: AT, id: 'c'.repeat(16) },
  ];
  assert.equal((await post(env, '/events', batch(events))).status, 200);
  assert.equal((await post(env, '/events', batch(events))).status, 200);
  const rows = DB.rows<{ name: string; props: string; install: string }>('SELECT * FROM events ORDER BY name');
  assert.deepEqual(
    rows.map((r) => r.name),
    ['app_start', 'tutorial_step_start'],
  );
  assert.equal(rows[1].install, INSTALL);
  assert.deepEqual(JSON.parse(rows[1].props), { n: 2 });
  assert.equal((await post(env, '/events', batch(events, { consent: false }))).status, 422);
  assert.equal((await post(env, '/events', batch([{ name: 'made_up', at: AT }]))).status, 422);
  assert.equal((await post(env, '/events', 'not json')).status, 422);
  assert.equal((await post(env, '/events', 'x'.repeat(70 * 1024))).status, 422);
  assert.equal(DB.rows('SELECT * FROM events').length, 2);
  assert.ok(!DB.rows<{ name: string }>("SELECT name FROM pragma_table_info('events')").some((c) => /ip|addr|agent/i.test(c.name)), 'no address is kept');
});

test('the survey: a code comes back, a device keeps its first one, and half an answer is not kept', async () => {
  const { DB, env } = place();
  const res = await post(env, '/feedback', { install: INSTALL, tester: 'pro-123', answers: ANSWERS });
  const { code } = (await res.json()) as { code: string };
  assert.match(code, /^[A-Z2-9]{4}-[A-Z2-9]{4}$/);
  const again = await post(env, '/feedback', { install: INSTALL, answers: { ...ANSWERS, fun: 1 } });
  assert.equal(((await again.json()) as { code: string }).code, code);
  const rows = DB.rows<{ tester: string; answers: string }>('SELECT * FROM feedback');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].tester, 'pro-123');
  assert.deepEqual(JSON.parse(rows[0].answers), ANSWERS);
  const other = await post(env, '/feedback', { install: 'not an id', tester: 'not an id either!', answers: ANSWERS });
  assert.notEqual(((await other.json()) as { code: string }).code, code, 'a browser that asks not to be tracked has no id and still gets a code');
  assert.deepEqual(
    DB.rows('SELECT install, tester FROM feedback WHERE install IS NULL').map((r) => ({ ...(r as object) })),
    [{ install: null, tester: null }],
  );
  assert.equal((await post(env, '/feedback', { install: INSTALL, answers: { ...ANSWERS, goal: ' ' } })).status, 422);
  assert.equal((await post(env, '/feedback', 'not json')).status, 422);
});

test('the answers are checked one by one', () => {
  assert.deepEqual(cleanAnswers({ ...ANSWERS, goal: `  ${ANSWERS.goal}  `, extra: 'dropped' }), ANSWERS);
  for (const bad of [
    null,
    'text',
    {},
    { ...ANSWERS, clear: 0 },
    { ...ANSWERS, fun: 6 },
    { ...ANSWERS, fun: 2.5 },
    { ...ANSWERS, clear: '3' },
    { ...ANSWERS, back: 'perhaps' },
    { ...ANSWERS, pay: undefined },
    { ...ANSWERS, worst: '' },
    { ...ANSWERS, worst: 7 },
    { ...ANSWERS, goal: 'x'.repeat(1001) },
  ])
    assert.equal(cleanAnswers(bad), null, JSON.stringify(bad));
});

test('a code has no letter a person could misread', () => {
  const codes = new Set(Array.from({ length: 200 }, makeCode));
  assert.equal(codes.size, 200);
  for (const c of codes) assert.match(c, /^[A-HJKMNP-Z2-9]{4}-[A-HJKMNP-Z2-9]{4}$/);
});

test('whatever is not one of the two routes is the game', async () => {
  const { env } = place();
  for (const r of [
    new Request('https://link.test/'),
    new Request('https://link.test/events'),
    new Request('https://link.test/other', { method: 'POST', body: '{}' }),
  ])
    assert.equal(await (await worker.fetch(r, env)).text(), 'the game');
});

test('every lesson step reads as what the tester was asked to do', () => {
  for (const lesson of LESSONS) {
    assert.equal(stepLabel((lesson.n - 1) * 100 + 99), `Lesson ${lesson.n}: the last screen`);
    lesson.shifts.forEach((shift, s) => {
      assert.ok(shift.moves.length <= 6, 'more moves than the numbering has room for (render/guide.ts)');
      const base = (lesson.n - 1) * 100 + s * 10;
      for (const k of [1, 8, 9, ...shift.moves.map((_, i) => 2 + i)])
        assert.match(stepLabel(base + k), new RegExp(`^Lesson ${lesson.n}, shift ${s + 1}: [a-z]+ the |^Lesson ${lesson.n}, shift ${s + 1}: (reading|buy) `));
    });
  }
  const said = new Map<string, string>();
  for (const [n, what] of [
    [1, 'pick'],
    [8, 'start'],
    [9, 'result'],
  ] as const)
    said.set(what, stepLabel(n));
  assert.equal(said.get('start'), 'Lesson 1, shift 1: start the shift');
  assert.equal(said.get('result'), 'Lesson 1, shift 1: reading the result');
  assert.equal(stepLabel(5000), 'Step 5000', 'a number from another version of the lessons still prints');
  assert.equal(stepLabel(95), 'Lesson 1: step 95');
  assert.equal(stepLabel(3), 'Lesson 1, shift 1: step 3');
});

const at = (minutes: number, day = 1) => new Date(Date.UTC(2026, 10, day, 12, minutes)).toISOString();
const row = (install: string, name: string, props: object, time: string): EventRow => ({ install, name, props: JSON.stringify(props), at: time });
const FINISHED = 'd'.repeat(32);
const STUCK = 'e'.repeat(32);
const LOOKED = 'f'.repeat(32);
const IN_GAME = '1'.repeat(32);
const EVENTS: EventRow[] = [
  // finished a lesson and a game, played again, came back the next day
  row(FINISHED, 'app_start', {}, at(0)),
  row(FINISHED, 'game_begin', { kind: 'lesson-1' }, at(0)),
  row(FINISHED, 'tutorial_step_start', { n: 2 }, at(1)),
  row(FINISHED, 'tutorial_step_complete', { n: 2 }, at(2)),
  row(FINISHED, 'lesson_done', { n: 1 }, at(3)),
  row(FINISHED, 'game_begin', { kind: 'daily' }, at(4)),
  row(FINISHED, 'round_complete', { n: 1 }, at(5)),
  row(FINISHED, 'game_complete', { mode: 'daily' }, at(6)),
  row(FINISHED, 'game_begin', { kind: 'practice' }, at(7)),
  row(FINISHED, 'round_complete', { n: 1 }, at(8)),
  row(FINISHED, 'tip_opened', { id: 'x' }, at(9)),
  row(FINISHED, 'app_start', {}, at(0, 2)),
  row(FINISHED, 'session_end', { minutes: 1 }, at(1, 2)),
  // stopped on a step of the first lesson, which took a long time
  row(STUCK, 'app_start', {}, at(0)),
  row(STUCK, 'game_begin', { kind: 'lesson-1' }, at(0)),
  row(STUCK, 'tutorial_step_start', { n: 2 }, at(1)),
  row(STUCK, 'tutorial_step_complete', { n: 2 }, at(5)),
  row(STUCK, 'tutorial_step_start', { n: 8 }, at(5)),
  row(STUCK, 'session_end', { minutes: 5 }, at(6)),
  // opened it and left
  row(LOOKED, 'app_start', {}, at(0)),
  // left a game on its third shift, having watched a recording to its end before
  row(IN_GAME, 'app_start', {}, at(0)),
  row(IN_GAME, 'game_complete', { mode: 'replay' }, at(1)),
  row(IN_GAME, 'game_begin', { kind: 'practice' }, at(2)),
  row(IN_GAME, 'round_complete', { n: 1 }, at(3)),
  row(IN_GAME, 'round_complete', { n: 2 }, at(4)),
];
const FEEDBACK: FeedbackRow[] = [
  { code: 'AAAA-BBBB', install: FINISHED, tester: 'pro-1', answers: JSON.stringify(ANSWERS), received: at(10) },
  { code: 'CCCC-DDDD', install: null, tester: null, answers: JSON.stringify({ ...ANSWERS, clear: 2, fun: 5, back: 'maybe', pay: 'yes' }), received: at(11) },
];

test('the report: how far they got, where they stopped, what held them up and what they said', () => {
  const s = summarize(EVENTS, FEEDBACK);
  assert.equal(s.testers, 4);
  assert.deepEqual(Object.fromEntries(s.milestones.map((m) => [m.label, m.testers])), {
    'Opened the game': 4,
    'Started lesson 1': 2,
    'Finished lesson 1': 1,
    'Finished lesson 2': 0,
    'Finished lesson 3': 0,
    'Started a real game': 2,
    'Finished a real game': 1,
    'Played again after that': 1,
    'Came back on a later day': 1,
    'Answered the survey': 1,
  });
  assert.deepEqual(s.stops, [
    { where: 'Lesson 1, shift 1: start the shift', testers: 1 },
    { where: 'On Home, never started anything', testers: 1 },
    { where: 'Practice yard, shift 2', testers: 1 },
    { where: 'Practice yard, shift 3', testers: 1 },
  ]);
  assert.deepEqual(s.slowest, [{ step: stepLabel(2), seconds: 240, testers: 2 }]);
  assert.equal(s.answered, 2);
  assert.equal(s.clear, 3);
  assert.equal(s.fun, 4);
  assert.deepEqual(s.back, { yes: 1, maybe: 1, no: 0 });
  assert.deepEqual(s.pay, { yes: 1, maybe: 0, no: 1 });
  assert.deepEqual(
    s.answers.map((a) => [a.code, a.tester, a.minutes, a.stopped]),
    [
      ['AAAA-BBBB', 'pro-1', 10, 'Practice yard, shift 2'],
      ['CCCC-DDDD', null, null, null],
    ],
  );
  const text = render(s);
  assert.match(text, /^PLAYTEST: 4 testers, 2 answered the survey, about 6 minutes of play for the middle tester/);
  assert.match(text, /Finished a real game +1 +25 %/);
  assert.match(text, /AAAA-BBBB \(pro-1\): clear 4, fun 3, back yes, pay no\n {4}Played 10 min\. Stopped: Practice yard, shift 2\n {4}Goal: Make the money/);
  assert.match(text, /CCCC-DDDD: clear 2, fun 5, back maybe, pay yes\n {4}No play data/);
});

test('the report says where a lesson or a game was finished, and has something to say before anyone has come', () => {
  const ended = (install: string, list: [string, object][]) => list.map(([name, props], i) => row(install, name, props, at(i)));
  const s = summarize(
    [
      ...ended(FINISHED, [
        ['game_begin', { kind: 'lesson-3' }],
        ['lesson_done', { n: 3 }],
        ['tutorial_step_complete', { n: 299 }],
      ]),
      ...ended(STUCK, [
        ['game_begin', { kind: 'daily' }],
        ['game_complete', { mode: 'daily' }],
      ]),
      ...ended(LOOKED, [['game_begin', { kind: 'daily' }]]),
    ],
    [],
  );
  assert.deepEqual(
    s.stops.map((x) => x.where),
    ['Finished a game, then left', 'Finished lesson 3, then left', "Today's yard, shift 1"],
  );
  assert.match(
    render(summarize([row(LOOKED, 'tutorial_step_start', { n: 2 }, at(0)), row(LOOKED, 'tutorial_step_complete', { n: 2 }, at(1))], [])),
    /^PLAYTEST: 1 tester,[^]*\(1 tester\)/,
  );
  const empty = render(summarize([], []));
  assert.match(empty, /^PLAYTEST: 0 testers/);
  assert.match(empty, /WHERE THEY STOPPED\n {2}nobody yet/);
  assert.match(empty, /How clear: - of 5/);
});
