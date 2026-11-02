/**
 * Hands for an agent playing the game as a stranger: one real browser per session, kept open between commands. The agent looks at
 * screenshots and taps what it sees; nothing here reads the game's state, so it knows only what a person holding the phone knows.
 *   node tools/panel/drive.mjs <session> start --url http://127.0.0.1:4700/ [--device phone|desk]
 *   node tools/panel/drive.mjs <session> look | tap X Y | hold X Y | drag X1 Y1 X2 Y2 | type "words" | key Enter | scroll DY | wait SECONDS | stop
 * `look` prints the screenshot's path and the buttons on screen. Coordinates are the ones on the screenshot's rulers.
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const [name, cmd, ...rest] = process.argv.slice(2);
if (!name || !cmd) {
  console.error('usage: node tools/panel/drive.mjs <session> start|look|tap|hold|drag|type|key|scroll|wait|stop ...');
  process.exit(2);
}
const dir = path.join(ROOT, 'tools', 'scratch', 'panel', name);
const portFile = path.join(dir, 'port');
const LONG_PRESS_MS = 450;
const IDLE_MS = 45 * 60_000;

function ask(body) {
  const port = Number(fs.readFileSync(portFile, 'utf8'));
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, method: 'POST', path: '/', headers: { 'Content-Type': 'application/json' } }, (res) => {
      let text = '';
      res.on('data', (d) => (text += d));
      res.on('end', () => resolve(text));
    });
    req.on('error', reject);
    req.end(JSON.stringify(body));
  });
}

async function daemon(url, device) {
  const { chromium, devices } = await import('playwright');
  const browser = await chromium.launch();
  const ctx = await browser.newContext(device === 'desk' ? { viewport: { width: 1366, height: 768 } } : { ...devices['Pixel 7'], deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e).slice(0, 300)));
  await page.goto(url);
  const cdp = device === 'desk' ? null : await ctx.newCDPSession(page);
  const touch = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts });
  const pause = (ms) => new Promise((r) => setTimeout(r, ms));
  let shots = 0;
  let idle = setTimeout(() => process.exit(0), IDLE_MS);

  const look = async () => {
    await pause(150);
    const file = path.join(dir, `shot-${++shots}.png`);
    await page.evaluate(() => {
      const r = document.createElement('div');
      r.id = 'panel-ruler';
      r.style.cssText = 'position:fixed;inset:0;z-index:2147483647;pointer-events:none;font:9px monospace;color:#0ff';
      const mark = (css, t) => {
        const m = document.createElement('div');
        m.style.cssText = `position:absolute;background:rgba(0,0,0,.65);padding:0 1px;${css}`;
        m.textContent = t;
        r.append(m);
      };
      for (let x = 50; x < innerWidth; x += 50) mark(`left:${x - 7}px;top:0`, x);
      for (let y = 50; y < innerHeight; y += 50) mark(`left:0;top:${y - 6}px`, y);
      document.body.append(r);
    });
    await page.screenshot({ path: file });
    await page.evaluate(() => document.getElementById('panel-ruler')?.remove());
    const buttons = await page.evaluate(() => {
      const seen = [];
      for (const e of document.querySelectorAll('button, a, input, textarea, select, summary, label')) {
        const b = e.getBoundingClientRect();
        if (b.width < 2 || b.height < 2 || b.bottom < 0 || b.top > innerHeight || b.right < 0 || b.left > innerWidth) continue;
        const s = getComputedStyle(e);
        if (s.visibility === 'hidden' || s.display === 'none' || s.pointerEvents === 'none' || Number(s.opacity) === 0) continue;
        const at = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2);
        if (at && !e.contains(at) && !at.contains(e)) continue; // something is on top of it
        const words = (e.innerText || e.getAttribute('aria-label') || e.getAttribute('placeholder') || e.tagName.toLowerCase())
          .trim()
          .replace(/\s+/g, ' ')
          .slice(0, 70);
        seen.push(`(${Math.round(b.left + b.width / 2)}, ${Math.round(b.top + b.height / 2)}) ${words}${e.disabled ? ' [greyed out]' : ''}`);
      }
      return seen;
    });
    return [
      `screen: ${file}`,
      ...(buttons.length ? ['buttons:', ...buttons] : ['no buttons on screen']),
      ...(errors.length ? [`page errors: ${errors.join(' | ')}`] : []),
    ].join('\n');
  };

  const run = {
    look,
    tap: async (x, y) => {
      if (device === 'desk') await page.mouse.click(+x, +y);
      else await page.touchscreen.tap(+x, +y);
      return 'tapped';
    },
    hold: async (x, y) => {
      if (device === 'desk') {
        await page.mouse.click(+x, +y, { button: 'right' });
        return 'right-clicked';
      }
      await touch('touchStart', [{ x: +x, y: +y }]);
      await pause(LONG_PRESS_MS + 150);
      await touch('touchEnd', []);
      return 'held';
    },
    drag: async (x1, y1, x2, y2) => {
      const [a, b, c, d] = [x1, y1, x2, y2].map(Number);
      if (device === 'desk') {
        await page.mouse.move(a, b);
        await page.mouse.down();
        await page.mouse.move(c, d, { steps: 8 });
        await page.mouse.up();
        return 'dragged';
      }
      await touch('touchStart', [{ x: a, y: b }]);
      await pause(LONG_PRESS_MS + 150);
      for (let i = 1; i <= 8; i++) await touch('touchMove', [{ x: a + ((c - a) * i) / 8, y: b + ((d - b) * i) / 8 }]);
      await touch('touchEnd', []);
      return 'dragged';
    },
    type: async (...words) => {
      await page.keyboard.type(words.join(' '));
      return 'typed';
    },
    key: async (k) => {
      await page.keyboard.press(k);
      return 'pressed';
    },
    scroll: async (dy) => {
      await page.evaluate((n) => {
        const all = [document.scrollingElement, ...document.querySelectorAll('*')];
        const box =
          all.filter((e) => e && e.scrollHeight > e.clientHeight + 4 && /auto|scroll/.test(getComputedStyle(e).overflowY)).pop() ?? document.scrollingElement;
        box.scrollBy(0, n);
      }, +dy);
      return 'scrolled';
    },
    wait: async (s) => {
      await pause(Math.min(30, +s) * 1000);
      return 'waited';
    },
    stop: async () => {
      setTimeout(() => process.exit(0), 3000); // the page's last send gets out, as it does when a person closes a tab
      await page.goto('about:blank');
      return 'stopped';
    },
  };

  const server = http.createServer(async (req, res) => {
    let text = '';
    for await (const d of req) text += d;
    clearTimeout(idle);
    idle = setTimeout(() => process.exit(0), IDLE_MS);
    const { cmd: c, args } = JSON.parse(text);
    try {
      res.end(run[c] ? await run[c](...args) : `no such command: ${c}`);
    } catch (e) {
      res.end(`failed: ${String(e).slice(0, 300)}`);
    }
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  fs.writeFileSync(portFile, String(server.address().port));
}

if (cmd === '--daemon') {
  await daemon(rest[0], rest[1]);
} else if (cmd === 'start') {
  fs.mkdirSync(dir, { recursive: true });
  fs.rmSync(portFile, { force: true });
  const flag = (k, d) => (rest.includes(`--${k}`) ? rest[rest.indexOf(`--${k}`) + 1] : d);
  const self = fileURLToPath(import.meta.url);
  const child = spawn(process.execPath, [self, name, '--daemon', flag('url', 'http://127.0.0.1:4700/'), flag('device', 'phone')], {
    detached: true,
    stdio: 'ignore',
    cwd: ROOT,
    windowsHide: true,
  });
  child.unref();
  for (let i = 0; i < 300 && !fs.existsSync(portFile); i++) await new Promise((r) => setTimeout(r, 100));
  if (!fs.existsSync(portFile)) {
    console.error('the browser did not start');
    process.exit(1);
  }
  console.log(await ask({ cmd: 'look', args: [] }));
} else {
  console.log(await ask({ cmd, args: rest }));
}
