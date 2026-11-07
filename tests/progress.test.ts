// Home before the first game (the consultant panel, 2026-11-06): a device with a lesson done reads what is done and what is next, never zeros.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { homeProgress } from '../game/src/content/progress';
import { LESSONS } from '../game/src/content/lessons';

test('a lesson done and no game: the count of the three lessons and the first game next, as facts; a game, or nothing done, keeps the old words', () => {
  assert.equal(LESSONS.length, 3, 'the lessons the words count');
  assert.deepEqual(homeProgress([1], 0), { done: 'Lessons done: 1 of 3.', next: 'Your first game is next.' });
  assert.deepEqual(homeProgress([1, 2], 0), { done: 'Lessons done: 2 of 3.', next: 'Your first game is next.' });
  assert.deepEqual(
    homeProgress([1, 2, 3], 0),
    { done: 'Lessons done: 3 of 3.', next: 'Your first game is next.' },
    'every lesson done: still the first game next',
  );
  assert.equal(homeProgress([], 0), null, 'nothing done: the record card keeps its words');
  assert.equal(homeProgress([1, 2], 1), null, 'a game played: the bests speak, under any rules');
  assert.equal(homeProgress([1, 2, 3], 7), null);
  assert.deepEqual(
    homeProgress([1, 9, 9], 0),
    { done: 'Lessons done: 1 of 3.', next: 'Your first game is next.' },
    'a lesson the game no longer has is not counted',
  );
  assert.equal(homeProgress([9], 0), null, 'nothing the game still has: the old words');
});
