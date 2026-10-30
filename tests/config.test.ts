// Production roadmap 0.8.0: the `?verifier=` override counts only in dev builds and on loopback pages; a hosted build
// keeps its baked verifier whatever the link says, and challenge links never carry the parameter there.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isLoopbackHost, overrideAllowedFor, pickVerifierUrl } from '../game/src/render/config';
import { buildChallengeLink } from '../game/src/render/challenge';

const BAKED = 'https://verifier.example';

test('loopback hosts are the only pages where the override counts in a production build', () => {
  for (const h of ['127.0.0.1', 'localhost', 'LOCALHOST', '[::1]']) assert.equal(isLoopbackHost(h), true, h);
  for (const h of ['junkyarddraft.com', '127.0.0.1.evil.invalid', 'localhost.evil.invalid', '', '10.0.0.5', '::1']) assert.equal(isLoopbackHost(h), false, h);
  assert.equal(overrideAllowedFor(false, 'junkyarddraft.com'), false);
  assert.equal(overrideAllowedFor(false, '127.0.0.1'), true);
  assert.equal(overrideAllowedFor(true, 'junkyarddraft.com'), true, 'dev builds keep the override everywhere');
  assert.equal(overrideAllowedFor(false, ''), false, 'file:// (Electron) has an empty hostname and uses the baked URL');
});

test('pickVerifierUrl: baked unless allowed and the override is an http(s) URL', () => {
  assert.equal(pickVerifierUrl('?verifier=https://evil.invalid', false, BAKED), BAKED);
  assert.equal(pickVerifierUrl('?verifier=https://evil.invalid', true, BAKED), 'https://evil.invalid');
  assert.equal(pickVerifierUrl('?dev=1&verifier=http://127.0.0.1:4499/', true, BAKED), 'http://127.0.0.1:4499', 'trailing slash dropped');
  assert.equal(pickVerifierUrl('?verifier=javascript:alert(1)', true, BAKED), BAKED, 'non-http schemes are ignored');
  assert.equal(pickVerifierUrl('?verifier=', true, BAKED), BAKED);
  assert.equal(pickVerifierUrl('', true, BAKED), BAKED);
});

test('challenge links carry the verifier parameter only when the caller allows it', () => {
  assert.equal(buildChallengeLink('https://junkyarddraft.com', '/', 'abc123', null), 'https://junkyarddraft.com/?challenge=abc123');
  assert.equal(
    buildChallengeLink('http://127.0.0.1:5199', '/', 'abc123', 'http://127.0.0.1:4499'),
    'http://127.0.0.1:5199/?challenge=abc123&verifier=http%3A%2F%2F127.0.0.1%3A4499',
  );
});
