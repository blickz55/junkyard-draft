// Control Room hook collector: redaction must remove the credential itself, not append a label to it (review F02).
// The synthetic tokens are assembled at runtime so no token-shaped literal sits in the repository (push protection
// scans file contents); none of them is or was a real credential.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { redact } from '../.claude/hooks/redact.mjs';

const join = (...parts) => parts.join('');
const SYNTHETIC = {
  anthropic: join('sk-ant-', 'api03-SYNTHETICKEYVALUE0123456789abcdef'),
  openai: join('sk-', 'SYNTHETIC0123456789ABCDEFGH'),
  github: join('ghp_', 'SYNTHETIC0123456789abcdefghij'),
  githubPat: join('github_pat_', 'SYNTHETIC_0123456789abcdef'),
  aws: join('AKIA', 'SYNTHETIC0123456'),
  slack: join('xox', 'b-', '1234567890-', 'SYNTHETICTOKEN'),
  bearer: join('eyJhbGciOiJIUzI1NiJ9.', 'SYNTHETIC.PAYLOAD'),
  password: 'hunter2hunter2',
  urlPass: 'p4ssw0rd-synthetic',
};

test('redact: whole-match tokens vanish from headers, assignments, URLs, commands, responses and error excerpts', () => {
  const samples = [
    `Authorization: Bearer ${SYNTHETIC.bearer}`,
    `export ANTHROPIC_API_KEY=${SYNTHETIC.anthropic}`,
    `curl -H "x-api-key: ${SYNTHETIC.openai}" https://api.example.test`,
    `git remote set-url origin https://alice:${SYNTHETIC.urlPass}@github.com/alice/repo.git`,
    `token=${SYNTHETIC.github} password="${SYNTHETIC.password}" aws=${SYNTHETIC.aws}`,
    `{"error":"bad token ${SYNTHETIC.slack} for ${SYNTHETIC.githubPat}"}`,
    `Error: request failed with ${SYNTHETIC.anthropic} in the body`,
  ];
  for (const s of samples) {
    const r = redact(s);
    for (const [name, secret] of Object.entries(SYNTHETIC)) assert.ok(!r.includes(secret), `${name} survived in: ${r}`);
    assert.ok(r.includes('[redacted]'), `something was redacted in: ${r}`);
  }
});

test('redact: harmless labels and hosts stay readable; ordinary text is untouched', () => {
  assert.equal(redact(`Authorization: Bearer ${SYNTHETIC.bearer}`), 'Authorization: Bearer [redacted]');
  assert.equal(redact(`password=${SYNTHETIC.password} next`), 'password=[redacted] next');
  assert.equal(redact(`https://alice:${SYNTHETIC.urlPass}@github.com/alice/repo.git`), 'https://alice:[redacted]@github.com/alice/repo.git');
  assert.equal(redact(`key ${SYNTHETIC.anthropic} end`), 'key [redacted] end', 'a bare key becomes the marker alone, never key+marker');
  assert.equal(redact('npm test passed 81/81; see docs/STATUS.md'), 'npm test passed 81/81; see docs/STATUS.md');
  assert.equal(redact('skip-this and sk-short'), 'skip-this and sk-short', 'short look-alikes are not keys');
});
