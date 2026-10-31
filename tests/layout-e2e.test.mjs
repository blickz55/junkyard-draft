// Production roadmap 0.10.0: the viewport matrix at 130 % text. Portrait phones (390×844, 412×915), a portrait tablet
// (768×1024), a laptop (1280×800), 1920×1080 and a landscape phone (915×412, perf preset D): the title, the draft, the
// build with a real pointer drag (the pointer lands on the logical cell under the fitted camera), the round summary and
// the results. Nothing leaves the viewport sideways, the board's cells are the size the roadmap asks for (46–50 px on a
// phone), the DOM grid layer sits on the drawn grid, offers and the primary buttons are visible and not covered, touch
// targets are 44 px where the pointer is coarse. One screenshot per screen and viewport for the owner's review.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fixture, SHOTS, cellCenter, binSlotCenter } from './e2e/fixture.mjs';

const f = await fixture();
after(() => f.close());

const VIEWPORTS = [
  { w: 390, h: 844, phone: true, cell: [46, 50] },
  { w: 412, h: 915, phone: true, cell: [46, 51] },
  { w: 768, h: 1024, phone: false, cell: [60, 90] },
  { w: 1280, h: 800, phone: false, cell: [72, 90] },
  { w: 1920, h: 1080, phone: false, cell: [72, 90] },
  { w: 915, h: 412, phone: true, cell: [40, 60], landscape: true },
];

/** every [data-testid] that leaves the overlay (vertical overflow inside the scrolling side panel is by design), the horizontal overflow */
const geometry = () => {
  const u = document.getElementById('ui').getBoundingClientRect();
  const els = [...document.querySelectorAll('#ui [data-testid]')];
  return {
    outside: els
      .filter((el) => {
        const r = el.getBoundingClientRect();
        const scrolls = !!el.closest('.jd-side');
        return r.width > 0 && r.height > 0 && (r.left < u.left - 1 || r.right > u.right + 1 || (!scrolls && (r.top < u.top - 1 || r.bottom > u.bottom + 1)));
      })
      .map((el) => el.dataset.testid),
    outsideX: els
      .filter((el) => {
        const r = el.getBoundingClientRect();
        return r.width > 0 && (r.left < u.left - 1 || r.right > u.right + 1);
      })
      .map((el) => el.dataset.testid),
    scrollX: (() => {
      const s = document.querySelector('#ui .jd-screen');
      return s ? s.scrollWidth - s.clientWidth : 0;
    })(),
    widest: [...document.querySelectorAll('#ui *')]
      .map((el) => ({ el, r: el.getBoundingClientRect() }))
      .filter(({ r }) => r.width > 0 && r.right > u.right + 1)
      .slice(0, 6)
      .map(
        ({ el, r }) =>
          `${el.tagName.toLowerCase()}${el.className ? '.' + String(el.className).split(' ').join('.') : ''}${el.dataset.testid ? '#' + el.dataset.testid : ''}:${Math.round(r.right - u.right)}px`,
      ), // what sticks out, for the failure message
    scrollY: (() => {
      const s = document.querySelector('#ui .jd-screen');
      return s ? s.scrollHeight - s.clientHeight : 0;
    })(),
    coarse: matchMedia('(pointer: coarse)').matches,
    textScale: getComputedStyle(document.getElementById('ui')).getPropertyValue('--text-scale').trim(),
  };
};
/** the element sits inside the side panel and the panel scrolls, so a swipe reaches it (the panel is not an offset parent: containment, not offsets) */
const reachable = (tid) => {
  const el = document.querySelector(`[data-testid=${tid}]`);
  const side = el?.closest('.jd-side');
  return !!side && side.scrollHeight > side.clientHeight + 1 && el.getBoundingClientRect().width > 0;
};
/** the element is on screen and the point at its centre hits it (nothing covers it) */
const visibleAndHit = (tid) => {
  const el = document.querySelector(`[data-testid=${tid}]`);
  if (!el) return { ok: false, why: 'missing' };
  const r = el.getBoundingClientRect();
  if (r.width < 1 || r.height < 1) return { ok: false, why: 'no size' };
  if (r.left < 0 || r.top < 0 || r.right > innerWidth || r.bottom > innerHeight) return { ok: false, why: `off screen ${JSON.stringify(r)}` };
  const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
  return { ok: !!hit && (hit === el || el.contains(hit)), why: hit ? hit.className || hit.tagName : 'nothing' };
};

for (const vp of VIEWPORTS) {
  const name = `${vp.w}x${vp.h}`;
  test(
    `${name}${vp.landscape ? ' landscape phone' : vp.phone ? ' portrait phone' : ''} at 130 %: title, draft, drag, summary, results inside the viewport`,
    { timeout: 180000 },
    async () => {
      const page = await f.page(
        { viewport: { width: vp.w, height: vp.h }, hasTouch: vp.phone, isMobile: vp.phone },
        {
          init: {
            fn: () => {
              localStorage.setItem('jd.settings.v1', JSON.stringify({ textScale: 1.3 }));
              localStorage.setItem('jd.onboarded.v1', '1');
              localStorage.setItem('jd.player', 'Matrix Tester');
            },
          },
        },
      );
      const { api, frames, title, draft, mode, when, results, overlaySynced, drag, settled } = page.jd;
      const shot = (screen) => page.screenshot({ path: path.join(SHOTS, `layout-${name}-${screen}.png`) });
      // the title
      await page.goto(f.gameUrl());
      await title();
      await when(
        () =>
          /practice/i.test(document.querySelector('[data-testid=daily-mode]')?.textContent || '') ||
          /≈/.test(document.querySelector('[data-testid=daily-board]')?.textContent || ''),
      );
      await overlaySynced();
      await frames();
      const t = await page.evaluate(geometry);
      assert.equal(t.textScale, '1.3', 'text at 130 %');
      assert.deepEqual(t.outsideX, [], `title: nothing sticks out sideways at ${name}`);
      assert.equal(t.scrollX, 0, `title: no horizontal overflow at ${name} (sticking out: ${t.widest.join(', ') || 'nothing by rect'})`);
      if (!vp.phone && vp.w >= 1280) assert.equal(t.scrollY, 0, `title: no scrolling on a laptop or desktop at ${name}`);
      assert.ok((await page.evaluate(visibleAndHit, 'daily')).ok, 'the daily button is on screen and not covered');
      await shot('title');
      // the draft
      await page.goto(f.gameUrl('scene=game&seed=classic-layout-1'));
      await draft();
      await overlaySynced();
      await frames(3);
      const geo = await api('geometry');
      assert.ok(geo.cell >= vp.cell[0] && geo.cell <= vp.cell[1], `${name}: cells ${geo.cell.toFixed(1)} px, wanted ${vp.cell[0]}–${vp.cell[1]}`);
      assert.ok(
        geo.grid.x >= -0.5 && geo.grid.y >= -0.5 && geo.grid.x + geo.grid.w <= vp.w + 0.5 && geo.shelf.y + geo.shelf.h <= vp.h + 0.5,
        `${name}: the grid and the shelf are inside the viewport: ${JSON.stringify(geo.grid)} ${JSON.stringify(geo.shelf)}`,
      );
      const layer = await page.evaluate(() => document.querySelector('#ui .jd-gridlayer').getBoundingClientRect().toJSON());
      assert.ok(
        Math.abs(layer.left - geo.grid.x) < 1.5 &&
          Math.abs(layer.top - geo.grid.y) < 1.5 &&
          Math.abs(layer.width - geo.grid.w) < 1.5 &&
          Math.abs(layer.height - geo.grid.h) < 1.5,
        `${name}: the DOM grid layer sits on the drawn grid: ${JSON.stringify(layer)} vs ${JSON.stringify(geo.grid)}`,
      );
      const d = await page.evaluate(geometry);
      assert.deepEqual(d.outside, [], `draft: every control inside at ${name}`);
      {
        const v = await page.evaluate(visibleAndHit, 'offer-0');
        assert.ok(v.ok, `${name}: the first offer is on screen and not covered (${v.why})`);
      }
      for (const tid of ['offer-1', 'offer-2']) {
        // on screen, or at least reachable by scrolling the panel (a landscape phone at 130 % cannot show three cards at once)
        const v = await page.evaluate(visibleAndHit, tid);
        assert.ok(v.ok || (await page.evaluate(reachable, tid)), `${name}: ${tid} is on screen or reachable by scrolling the panel (${v.why})`);
      }
      if (d.coarse) {
        const short = await page.evaluate(() =>
          [...document.querySelectorAll('#ui .jd-btn, #ui .jd-offer')]
            .filter((b) => b.getBoundingClientRect().width > 0)
            .map((b) => [b.dataset.testid || b.className, Math.round(b.getBoundingClientRect().height)])
            .filter(([, hh]) => hh < 44),
        );
        assert.deepEqual(short, [], `${name}: every button and offer card is at least 44 px tall under a coarse pointer`);
      }
      await shot('draft');
      // the build: a real drag from the shelf onto a free cell lands on that cell under the fitted camera
      await api('pick', 0);
      await mode('build');
      await frames(2);
      await settled();
      const part = (await api('state')).bin[0];
      assert.ok(part, 'the picked part is on the shelf');
      await drag(binSlotCenter(0), cellCenter(3, 4));
      const placed = (await api('state')).layout.machines.find((m) => m.id === part.id);
      assert.ok(placed && placed.x === 3 && placed.y === 4, `${name}: the drop maps to the logical cell: ${JSON.stringify(placed)}`);
      {
        const v = await page.evaluate(visibleAndHit, 'run');
        if (vp.landscape) assert.ok(v.ok || (await page.evaluate(reachable, 'run')), `${name}: the start button is on screen or reachable (${v.why})`);
        else assert.ok(v.ok, `${name}: the start button is on screen and not covered (${v.why})`);
      }
      await shot('build');
      // the shift and the summary banner over the grid
      await api('run');
      await mode('running');
      await api('finishRun');
      await mode('summary');
      await frames(2);
      const banner = await page.evaluate(() => {
        const b = document.querySelector('#ui .jd-banner');
        const u = document.getElementById('ui').getBoundingClientRect();
        const r = b.getBoundingClientRect();
        return { inside: r.left >= u.left - 1 && r.right <= u.right + 1 && r.top >= u.top - 1 && r.bottom <= u.bottom + 1, r: r.toJSON() };
      });
      assert.ok(banner.inside, `${name}: the round banner is inside the viewport: ${JSON.stringify(banner.r)}`);
      assert.ok((await page.evaluate(visibleAndHit, 'next')).ok, `${name}: the next-round button is on screen and not covered`);
      await shot('summary');
      // the remaining rounds through the dev API, then the results
      for (let r = 2; r <= 6; r++) {
        await api('next');
        await draft();
        await page.evaluate(() => {
          const j = window.__jd;
          j.pick(j.state().offers.length - 1);
          j.run();
        });
        await mode('running');
        await api('finishRun');
        await mode('summary');
      }
      await api('next');
      await results();
      await overlaySynced();
      await frames(2);
      const res = await page.evaluate(geometry);
      assert.deepEqual(res.outsideX, [], `results: nothing sticks out sideways at ${name}`);
      assert.equal(res.scrollX, 0, `results: no horizontal overflow at ${name} (sticking out: ${res.widest.join(', ') || 'nothing by rect'})`);
      assert.ok((await page.evaluate(visibleAndHit, 'headline')).ok, `${name}: the results headline is on screen`);
      await shot('results');
      assert.deepEqual(page.errors, [], `no page errors at ${name}`);
      await page.ctx.close();
    },
  );
}
