// Stand-ins for the two paid services the verifier talks to, for browser tests: the Messages API and the mail service. A word in a
// post picks the classifier's answer: "nasty" comes down, "pushy" goes to the queue, "unreadable" is the classifier failing.
import http from 'node:http';
import { freePort } from './fixture.mjs';

export async function standIns() {
  const mails = [];
  const server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      const body = JSON.parse(raw);
      const send = (status, json) => {
        res.writeHead(status, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(json));
      };
      if (req.url === '/emails') {
        mails.push(body);
        return send(200, { id: 'stub' });
      }
      const words = body.messages[0].content;
      if (words.includes('unreadable')) return send(400, { type: 'error', error: { type: 'invalid_request_error', message: 'stand-in' } });
      const answer = words.includes('nasty')
        ? { category: 'hate', score: 95 }
        : words.includes('pushy')
          ? { category: 'spam', score: 55 }
          : { category: 'ok', score: 2 };
      send(200, {
        id: 'msg',
        type: 'message',
        role: 'assistant',
        content: [{ type: 'text', text: JSON.stringify(answer) }],
        stop_reason: 'end_turn',
        usage: { input_tokens: 700, output_tokens: 20 },
      });
    });
  });
  const port = await freePort();
  await new Promise((r) => server.listen(port, '127.0.0.1', r));
  return {
    mails,
    env: {
      ANTHROPIC_API_KEY: 'sk-test',
      ANTHROPIC_API_URL: `http://127.0.0.1:${port}/v1/messages`,
      RESEND_API_KEY: 're_test',
      RESEND_API_URL: `http://127.0.0.1:${port}/emails`,
    },
    close: () => new Promise((r) => server.close(r)),
  };
}

/** Sign a page in with email through the game, the way a player does. */
export async function signIn(f, page, mails, email) {
  await page.goto(f.gameUrl());
  await page.jd.title();
  await page.evaluate(() => localStorage.setItem('jd.onboarded.v1', '1'));
  await page.getByTestId('settings').click();
  await page.getByTestId('link-email').click();
  await page.getByTestId('link-email-field').fill(email);
  await page.keyboard.press('Enter');
  await page.jd.textMatches('link-status', /^Check your email\./, 10000);
  await page.getByTestId('link-close').click();
  const link = /#link=([\w-]+)/.exec(mails.at(-1).text)[1];
  await page.goto('about:blank');
  await page.goto(`${f.gameUrl()}#link=${link}`);
  await page.jd.title();
  await page.getByTestId('link-confirm-yes').click();
  await page.getByTestId('dialog-ok').click();
  await page.jd.noDialog('dialog');
  await page.jd.title();
}
