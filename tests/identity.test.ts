import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { tagFor, normaliseName, foldName, nameProblem, recoveryCodeFor, tokenFromRecoveryCode, TAG_ALPHABET, TOKEN_HEX } from '../game/src/identity/identity';

test('tag: four confusable-free characters, deterministic for an id, spread over ids', () => {
  const ids = Array.from({ length: 500 }, () => createHash('sha256').update(randomBytes(16)).digest('hex'));
  const tags = ids.map(tagFor);
  for (const t of tags) { assert.equal(t.length, 4); for (const c of t) assert.ok(TAG_ALPHABET.includes(c), `tag char ${c}`); assert.ok(!/[0OIL1U]/.test(t)); }
  assert.equal(tagFor(ids[0]), tagFor(ids[0]));
  assert.ok(new Set(tags).size > 450, `tags spread (${new Set(tags).size} distinct of 500)`);
});

test('names: normalised (NFKC, whitespace, control characters, length) and refused by a folded blocklist', () => {
  assert.equal(normaliseName('  Jon\u0000  Flynn\u200b '), 'Jon Flynn');
  assert.equal(normaliseName('x'.repeat(50)).length, 32);
  assert.equal(normaliseName(42), '');
  assert.equal(foldName('Ádm1n!'), 'admini');
  assert.equal(nameProblem('Jon'), null);
  assert.equal(nameProblem(''), 'name is empty'); assert.equal(nameProblem('J'), 'name is too short');
  assert.equal(nameProblem('the_adm1n'), 'name is not allowed'); assert.equal(nameProblem('V3R1F13D player'), 'name is not allowed');
  assert.equal(nameProblem('Administer'), 'name is not allowed', 'substring match: the list is short on purpose and the full flow is v0.9');
});

test('recovery code: 26 base32 characters in groups, round-trips the token, tolerant of case, dashes, spaces and I/L/O confusions, rejects junk', () => {
  for (let i = 0; i < 50; i++) {
    const token = randomBytes(16).toString('hex');
    assert.ok(TOKEN_HEX.test(token));
    const code = recoveryCodeFor(token);
    assert.match(code, /^[0-9A-HJKMNP-TV-Z]{5}-[0-9A-HJKMNP-TV-Z]{5}-[0-9A-HJKMNP-TV-Z]{5}-[0-9A-HJKMNP-TV-Z]{5}-[0-9A-HJKMNP-TV-Z]{6}$/);
    assert.equal(tokenFromRecoveryCode(code), token);
    assert.equal(tokenFromRecoveryCode(code.toLowerCase().replace(/-/g, ' ')), token);
    assert.equal(tokenFromRecoveryCode(code.replace(/1/g, 'I').replace(/0/g, 'O')), token, 'I/L and O read as 1 and 0');
  }
  assert.equal(tokenFromRecoveryCode('nope'), null); assert.equal(tokenFromRecoveryCode('A'.repeat(26)), 'ff'.repeat(16).replace(/f/g, (m, i) => (i % 2 ? '7' : 'f')) && tokenFromRecoveryCode('A'.repeat(26)), 'all-A code is a valid token');
  assert.equal(tokenFromRecoveryCode(recoveryCodeFor('0'.repeat(32)).slice(0, -1) + '!'), null);
  assert.throws(() => recoveryCodeFor('xyz'));
});
