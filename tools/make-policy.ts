/**
 * Regenerate the policy documents (PLAN-v3 0.6.5): game/public/policy.json (shipped with the game and rendered by the
 * in-game panel) and docs/POLICY.md, both from tools/policy-lib.ts; and (0.8.6) the legal texts from tools/legal-lib.ts:
 * game/public/legal.json (bundled, the Privacy & data panel) and game/public/legal/{privacy,terms,guidelines}.html. `--check` writes nothing and exits 1 when either
 * committed file differs from what the code says (what tests/policy.test.ts asserts as well).
 *   node --import tsx tools/make-policy.ts [--check]
 */
import fs from 'node:fs';
import path from 'node:path';
import { buildPolicy, renderPolicyMarkdown, policyJson, POLICY_JSON_PATH, POLICY_MD_PATH } from './policy-lib';
import { buildLegal, legalJson, renderLegalHtml, legalHtmlPath, LEGAL_JSON_PATH } from './legal-lib';

const check = process.argv.includes('--check');
const p = buildPolicy();
const legal = buildLegal();
const want: [string, string][] = [
  [POLICY_JSON_PATH, policyJson(p)],
  [POLICY_MD_PATH, renderPolicyMarkdown(p)],
  [LEGAL_JSON_PATH, legalJson(legal)],
  ...legal.docs.map((d): [string, string] => [legalHtmlPath(d.id), renderLegalHtml(d, legal)]),
];
let stale = 0;
for (const [rel, text] of want) {
  const file = path.resolve(rel);
  const have = fs.existsSync(file) ? fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n') : null;
  if (have === text) {
    console.log(`up to date  ${rel}`);
    continue;
  }
  stale++;
  if (check) {
    console.log(`STALE       ${rel}`);
    continue;
  }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
  console.log(`wrote       ${rel}`);
}
if (check && stale) {
  console.error(`${stale} policy file(s) stale: run node --import tsx tools/make-policy.ts`);
  process.exitCode = 1;
}
