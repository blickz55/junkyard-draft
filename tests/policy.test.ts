import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { buildPolicy, renderPolicyMarkdown, policyJson, POLICY_JSON_PATH, POLICY_MD_PATH } from '../tools/policy-lib';
import { RULES_VERSION } from '../game/src/sim/types';
import { TIE_BREAK, PROTOCOL } from '../server/verify';

const read = (p: string) => fs.readFileSync(p, 'utf8').replace(/\r\n/g, '\n');

test('policy (PLAN-v3 0.6.5): the committed policy.json and POLICY.md are exactly what the code generates; they name the current rules version and the tie rule', () => {
  const p = buildPolicy();
  assert.equal(policyJson(p), read(POLICY_JSON_PATH), `${POLICY_JSON_PATH} is stale: run node --import tsx tools/make-policy.ts`);
  assert.equal(renderPolicyMarkdown(p), read(POLICY_MD_PATH), `${POLICY_MD_PATH} is stale: run node --import tsx tools/make-policy.ts`);
  assert.equal(p.rulesVersion, RULES_VERSION);
  assert.equal(p.protocol, PROTOCOL);
  assert.equal(p.tieBreak, TIE_BREAK);
  const committed = JSON.parse(read(POLICY_JSON_PATH)) as {
    rulesVersion: number;
    tieBreak: string;
    sections: { title: string; lines: string[] }[];
    rules: { rerollCost: number };
  };
  assert.equal(committed.rulesVersion, RULES_VERSION);
  assert.equal(committed.tieBreak, TIE_BREAK);
  assert.equal(committed.rules.rerollCost, 40);
  assert.deepEqual(
    committed.sections.map((s) => s.title),
    ['Rules', 'Verification', 'The daily', 'Medals', 'Identity and your data', 'Play statistics (opt-in)', 'Abuse limits'],
  );
  assert.ok(committed.sections.every((s) => s.lines.length > 0 && s.lines.every((l) => l.length > 20)));
  assert.deepEqual(buildPolicy(), p, 'deterministic');
  assert.doesNotMatch(policyJson(p), /\d{4}-\d{2}-\d{2}T/, 'no timestamps: the document is a function of the source');
});
