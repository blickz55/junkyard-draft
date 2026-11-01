// A lesson played on a phone in a build with no test hooks: only what the game lights is touched, as a stranger would. The rings are real
// elements on the page, so where they are comes from the page. tests/walkthrough-e2e.test.mjs is the full version, on the dev server.

const frames = (page) => page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));

/** What is lit right now. `key` tells one state from the next. */
function lit(page) {
  return page.evaluate(() => {
    const read = () => {
      if (document.querySelector('[data-testid=lesson-done]')) return { done: true };
      const dialog = document.querySelector('.jd-modal .jd-btn-primary');
      if (dialog) return { dialog: dialog.dataset.testid };
      const buttons = [...document.querySelectorAll('.jd-spot')].map((b) => b.dataset.testid);
      const rings = [...document.querySelectorAll('[data-spot]')].map((r) => {
        const b = r.getBoundingClientRect();
        return { spot: r.dataset.spot, x: b.x + b.width / 2, y: b.y + b.height / 2 };
      });
      return { buttons, rings };
    };
    return read();
  });
}
const keyOf = (l) => JSON.stringify(l);
const anythingLit = (l) => l.done || l.dialog || l.buttons.length || l.rings.length;

/** From a job card or the first step to the lesson's end dialog. */
export async function walkLesson(page, { maxActions = 60 } = {}) {
  let before = '';
  for (let actions = 0; actions < maxActions; actions++) {
    let l = await lit(page);
    for (let tries = 0; tries < 200 && (!anythingLit(l) || keyOf(l) === before); tries++) {
      if (tries === 100 && anythingLit(l)) break; // the same thing is still lit: a step of two taps on one spot
      await frames(page);
      l = await lit(page);
    }
    if (l.done) return actions;
    before = keyOf(l);
    if (l.dialog) await page.getByTestId(l.dialog).click();
    else if (l.rings.length) {
      for (const ring of l.rings) {
        await page.touchscreen.tap(ring.x, ring.y);
        await frames(page);
      }
    } else if (l.buttons.length) {
      await page.getByTestId(l.buttons[0]).click();
      if (l.buttons[0] === 'run') await page.getByTestId('skip').click();
    } else throw new Error('nothing is lit');
  }
  throw new Error(`the lesson did not end within ${maxActions} actions`);
}
