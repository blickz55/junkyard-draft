import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createState, reduce, snapshot, TOOL_CALL_LIMIT } from '../control-room/state.mjs';

const hook = (event, extra = {}) => ({ ts: '2026-01-01T00:00:00Z', kind: 'hook', event, session_id: 's1', ...extra });

test('tool start does not mark success; PostToolUse marks ok; failure counts', () => {
  const st = createState();
  reduce(st, hook('PreToolUse', { tool_name: 'Bash', tool_use_id: 't1', input: { command: 'npm test' } }), 1);
  assert.equal(st.toolCalls.t1.ok, null);
  reduce(st, hook('PostToolUse', { tool_name: 'Bash', tool_use_id: 't1', response: { exit_code: 0 } }), 2);
  assert.equal(st.toolCalls.t1.ok, true);
  reduce(st, hook('PreToolUse', { tool_name: 'Bash', tool_use_id: 't2' }), 3);
  reduce(st, hook('PostToolUseFailure', { tool_name: 'Bash', tool_use_id: 't2', error: 'boom' }), 4);
  assert.equal(st.toolCalls.t2.ok, false);
  assert.equal(st.counts.failures, 1);
  assert.equal(st.agents['main:s1'].failures, 1);
});

test('subagent lifecycle links spawn description, parent and final result', () => {
  const st = createState();
  reduce(
    st,
    hook('PreToolUse', { tool_name: 'Agent', tool_use_id: 'a1', input: { description: 'Audit scoring', subagent_type: 'general-purpose', model: 'sonnet' } }),
    1,
  );
  reduce(st, hook('SubagentStart', { agent_id: 'ag-1', agent_type: 'general-purpose' }), 2);
  const a = st.agents['agent:ag-1'];
  assert.equal(a.task, 'Audit scoring');
  assert.equal(a.parent, 'main:s1');
  assert.equal(a.modelConfigured, 'sonnet');
  assert.equal(a.modelObserved, null, 'observed model stays unavailable unless runtime reports it');
  assert.equal(a.status, 'running');
  reduce(st, hook('SubagentStop', { agent_id: 'ag-1', last_message: 'Scoring is fine.' }), 3);
  assert.equal(a.status, 'stopped');
  assert.equal(a.result, 'Scoring is fine.');
  assert.equal(snapshot(st).agents.length, 2);
});

test('reported objective attributes later hook events to its task; failed check returns to implement is recorded', () => {
  const st = createState();
  reduce(st, { ts: 't', kind: 'reported', event: 'cr.task', id: 'G1', title: 'Sim', stage: 'implement', status: 'active' }, 1);
  reduce(st, { ts: 't', kind: 'reported', event: 'cr.objective', task: 'G1', title: 'Build sim', stage: 'implement' }, 2);
  reduce(st, hook('PreToolUse', { tool_name: 'Edit', tool_use_id: 'e1', input: { file: 'game/src/sim/x.ts' } }), 3);
  assert.equal(st.feed.at(-1).task, 'G1');
  reduce(st, { ts: 't', kind: 'reported', event: 'cr.check', task: 'G1', name: 'unit', command: 'npm test', result: 'fail' }, 4);
  assert.ok(st.tasks.G1.lastFailedCheck);
  reduce(st, { ts: 't', kind: 'reported', event: 'cr.task', id: 'G1', stage: 'implement', status: 'active', note: 'returned after failed unit' }, 5);
  assert.equal(st.tasks.G1.history.length, 2);
});

test('tool-call history is bounded (review): thousands of starts keep at most the newest TOOL_CALL_LIMIT entries', () => {
  const s = createState();
  for (let i = 0; i < TOOL_CALL_LIMIT + 500; i++)
    reduce(s, {
      ts: new Date(1_700_000_000_000 + i).toISOString(),
      kind: 'hook',
      event: 'PreToolUse',
      session_id: 'sess',
      tool_name: 'Bash',
      tool_use_id: `t${i}`,
      input: { command: 'echo' },
    });
  const ids = Object.keys(s.toolCalls);
  assert.equal(ids.length, TOOL_CALL_LIMIT);
  assert.equal(ids[0], 't500', 'the oldest entries were dropped');
  assert.equal(ids[ids.length - 1], `t${TOOL_CALL_LIMIT + 499}`);
});

test('malformed and unknown events do not break the reducer', () => {
  const st = createState();
  reduce(st, null, 1);
  reduce(st, {}, 2);
  reduce(st, hook('SomethingNew'), 3);
  assert.equal(st.feed.length, 1);
});
