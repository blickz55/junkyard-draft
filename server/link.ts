/**
 * Email sign-in (production roadmap 0.11.1). A one-time link proves an address; the address itself is never kept, only its hash,
 * and the link's token only as a hash too. The link opens the game with the token in the fragment, so it reaches no server log,
 * and nothing happens until a person presses Sign in: a mail scanner that follows links signs nobody in. The device that opens
 * the link is the one that signs in, never the one that asked for it, so a stranger who types your address gains nothing when you
 * open their link. Resend carries the mail over one plain HTTPS request; `RESEND_API_KEY` turns it on, and without it the routes
 * answer 503 (the same arrangement as the VAPID keys).
 */
import { createHash, randomBytes } from 'node:crypto';
import { OPERATOR } from '../game/src/content/operator';

export const LINK_TTL_MS = 15 * 60_000;
export const EMAIL_MAX = 254;
export const MAX_SYNC_BYTES = 128 * 1024;
/** per hour: the same address, one player, one network address */
export const LINK_PER_ADDRESS = 3,
  LINK_PER_PLAYER = 5,
  LINK_PER_IP = 10;

const sha256 = (s: string): string => createHash('sha256').update(s).digest('hex');
/** Trimmed and lowercased, or null when it is not an address. */
export function normaliseEmail(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const email = raw.trim().toLowerCase();
  return email.length <= EMAIL_MAX && /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/.test(email) ? email : null;
}
export const emailHash = (email: string): string => sha256(email);
export const linkTokenHash = (token: string): string => sha256(token);
export const newLinkToken = (): string => randomBytes(32).toString('base64url');
export const linkUrl = (siteUrl: string, token: string): string => `${siteUrl.replace(/\/+$/, '')}/#link=${token}`;

export interface Mail {
  to: string;
  subject: string;
  text: string;
  html: string;
  /** the same key twice sends one mail */
  idempotencyKey: string;
}
export type Mailer = (mail: Mail) => Promise<void>;
export class MailError extends Error {}

/** The one mail the game sends so far. */
export function signInMail(to: string, url: string, idempotencyKey: string): Mail {
  const minutes = LINK_TTL_MS / 60_000;
  return {
    to,
    subject: `Your ${OPERATOR.product} sign-in link`,
    text: `Here is your sign-in link for ${OPERATOR.product}:\n\n${url}\n\nIt works once, for ${minutes} minutes. Open it on the device you want to sign in on.\n\nIf you did not ask for this, ignore this email and nothing will change.\n`,
    html: `<p>Here is your sign-in link for ${OPERATOR.product}:</p><p><a href="${url}">Sign in</a></p><p>It works once, for ${minutes} minutes. Open it on the device you want to sign in on.</p><p>If you did not ask for this, ignore this email and nothing will change.</p>`,
    idempotencyKey,
  };
}

export interface ResendOptions {
  apiKey: string;
  from: string;
  replyTo?: string;
  /** a loopback endpoint in tests; a real service is never tested against */
  url?: string;
  timeoutMs?: number;
}
export const resendMailer =
  (o: ResendOptions): Mailer =>
  async (mail) => {
    let res: Response;
    try {
      res = await fetch(o.url ?? 'https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${o.apiKey}`,
          'Content-Type': 'application/json',
          'Idempotency-Key': mail.idempotencyKey,
          'User-Agent': 'junkyard-draft-verifier',
        },
        body: JSON.stringify({ from: o.from, to: [mail.to], reply_to: o.replyTo, subject: mail.subject, text: mail.text, html: mail.html }),
        signal: AbortSignal.timeout(o.timeoutMs ?? 10_000),
      });
    } catch (e) {
      throw new MailError(`no answer from the mail service: ${(e as Error).message}`);
    }
    if (!res.ok) throw new MailError(`the mail service answered ${res.status}`); // the body can echo the address: it stays out of the logs
  };
