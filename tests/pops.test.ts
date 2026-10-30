// production roadmap 0.9.4: the pooled "+$" pops (extracted from GameScene), driven through a fake factory.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PopPool, type PopText, type PopTween } from '../game/src/render/PopPool';

function fakeFactory() {
  const made: (PopText & { text: string; style: { fontSize: string; color: string } | null; x: number; y: number })[] = [];
  const tweens: PopTween[] = [];
  const make = () => {
    const p = { visible: false, text: '', style: null as { fontSize: string; color: string } | null, x: 0, y: 0,
      setText(t: string) { p.text = t; }, setStyle(s: { fontSize: string; color: string }) { p.style = s; }, setPosition(x: number, y: number) { p.x = x; p.y = y; }, setAlpha() {}, setVisible(v: boolean) { p.visible = v; } };
    made.push(p); return p;
  };
  return { made, tweens, factory: { make, tween: (cfg: PopTween) => { tweens.push(cfg); } }, finish: () => { for (const t of tweens.splice(0)) t.onComplete(); } };
}

test('pop pool: reuses hidden texts, caps the pool and counts skipped pops, colours by value, fades in place under reduced motion', () => {
  const f = fakeFactory();
  const pool = new PopPool(f.factory, 4);
  assert.equal(pool.pop(10, 20, 12, false), true);
  assert.equal(f.made.length, 1); assert.equal(f.made[0].text, '+$12'); assert.equal(f.made[0].style?.color, '#f5c542'); assert.deepEqual([f.made[0].x, f.made[0].y], [10, 10]);
  assert.equal(f.tweens[0].y, 20 - 48, 'travels up 48 px');
  pool.pop(0, 0, 3, false); pool.pop(0, 0, 1, false); pool.pop(0, 0, 8, false);
  assert.equal(f.made[1].style?.color, '#6fcf8a'); assert.equal(f.made[2].style?.color, '#f1e8d8'); assert.equal(f.made[3].style?.fontSize, '15px');
  assert.deepEqual(pool.counters(), { popsAlive: 4, popsPeak: 4, popsSkipped: 0, poolSize: 4, poolMax: 4 });
  assert.equal(pool.pop(0, 0, 5, false), false, 'the pool is full: the visual is skipped');
  assert.equal(pool.counters().popsSkipped, 1); assert.equal(f.made.length, 4);
  f.finish();
  assert.equal(pool.counters().popsAlive, 0); assert.ok(f.made.every((p) => !p.visible));
  assert.equal(pool.pop(5, 5, 1, true), true, 'a hidden text is reused');
  assert.equal(f.made.length, 4, 'no new text');
  const reduced = f.tweens[f.tweens.length - 1];
  assert.equal(reduced.y, undefined); assert.equal(reduced.delay, 300); assert.equal(reduced.duration, 900);
  assert.deepEqual(pool.counters(), { popsAlive: 1, popsPeak: 4, popsSkipped: 1, poolSize: 4, poolMax: 4 });
});
