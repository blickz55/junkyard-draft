/**
 * Identity without passwords (PLAN-v3 0.6.0), the pure parts shared by the client and the verifier:
 *   - a device token is 16 random bytes (32 hex characters); the player id is its SHA-256 (hashed by each side with its own crypto);
 *   - the tag is four characters of a confusable-free alphabet taken from the player id, so "Jon#7Q2M" tells two Jons apart;
 *   - display names are normalised (whitespace, control characters, length) and checked against a small blocklist after
 *     folding confusables and leetspeak, so a refused word cannot slip through as "f1lth";
 *   - the recovery code is the token in base32 groups (Crockford-style alphabet, no I/L/O/U), accepted back with any case,
 *     spaces or dashes.
 * Nothing here touches storage or the network.
 */
export const TOKEN_HEX = /^[0-9a-f]{32}$/;
export const TAG_ALPHABET = 'ABCDEFGHJKMNPQRSTVWXYZ23456789'; // 30 symbols, no 0/O/1/I/L/U
export const NAME_MAX = 32;
const B32 = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

/** Four tag characters from the first 20 bits of the player id (hex). Deterministic. */
export function tagFor(playerId: string): string {
  const bits = parseInt(playerId.slice(0, 5), 16); // 20 bits
  let out = '';
  for (let i = 0; i < 4; i++) out += TAG_ALPHABET[(bits >> (i * 5)) % TAG_ALPHABET.length];
  return out;
}
export const labelFor = (name: string, tag: string) => `${name}#${tag}`;

/** Collapse whitespace, strip control characters, cap the length. Empty when nothing printable remains. */
export function normaliseName(raw: unknown): string {
  if (typeof raw !== 'string') return '';
  // eslint-disable-next-line no-control-regex -- control characters are exactly what a display name must not carry
  return raw
    .normalize('NFKC')
    .replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202f\ufeff]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, NAME_MAX);
}
const LEET: Record<string, string> = { '0': 'o', '1': 'i', '3': 'e', '4': 'a', '5': 's', '7': 't', '8': 'b', '@': 'a', $: 's', '!': 'i', '|': 'l', '+': 't' };
/** Lowercase, leetspeak folded, non-letters removed: the form the blocklist is matched against. */
export function foldName(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .split('')
    .map((c) => LEET[c] ?? c)
    .join('')
    .replace(/[^a-z]/g, '');
}
/** A short server-side list; the full moderation flow is v0.9. Matched as substrings of the folded name. */
export const NAME_BLOCKLIST: readonly string[] = ['admin', 'moderator', 'verified', 'official', 'junkyardstaff', 'nigg', 'fagg', 'hitler', 'rapist'];
/** Why a name is refused, or null when it is acceptable. */
export function nameProblem(raw: unknown): string | null {
  const n = normaliseName(raw);
  if (!n) return 'name is empty';
  if (n.length < 2) return 'name is too short';
  const folded = foldName(n);
  for (const bad of NAME_BLOCKLIST) if (folded.includes(bad)) return 'name is not allowed';
  return null;
}

/** Report reasons (PLAN-v4 0.7.7): a fixed list, never free text; the verifier refuses anything else. */
export const REPORT_REASONS = ['offensive', 'impersonation', 'personal-info', 'spam', 'other'] as const;
export type ReportReason = (typeof REPORT_REASONS)[number];
/** what every board shows instead of a reported name until a moderator acts */
export const HIDDEN_LABEL = 'player';

/** Recovery code: 16 bytes → 26 base32 characters in groups of 5-5-5-5-6, e.g. "7Q2MA-3KJ8P-…" */
export function recoveryCodeFor(tokenHex: string): string {
  if (!TOKEN_HEX.test(tokenHex)) throw new Error('bad token');
  const bytes = tokenHex.match(/../g)!.map((h) => parseInt(h, 16));
  let bits = 0,
    acc = 0,
    out = '';
  for (const b of bytes) {
    acc = (acc << 8) | b;
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      out += B32[(acc >> bits) & 31];
    }
  }
  if (bits > 0) out += B32[(acc << (5 - bits)) & 31];
  return [out.slice(0, 5), out.slice(5, 10), out.slice(10, 15), out.slice(15, 20), out.slice(20)].join('-'); // 5-5-5-5-6
}
/** Parse a recovery code back to the token hex; null when it is not a valid code. Case, spaces and dashes are ignored; I/L→1, O→0. */
export function tokenFromRecoveryCode(code: unknown): string | null {
  if (typeof code !== 'string') return null;
  const clean = code.toUpperCase().replace(/[\s-]/g, '').replace(/[IL]/g, '1').replace(/O/g, '0');
  if (clean.length !== 26) return null;
  let bits = 0,
    acc = 0;
  const bytes: number[] = [];
  for (const ch of clean) {
    const v = B32.indexOf(ch);
    if (v < 0) return null;
    acc = (acc << 5) | v;
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      bytes.push((acc >> bits) & 255);
    }
  }
  if (bytes.length !== 16) return null;
  return bytes.map((b) => b.toString(16).padStart(2, '0')).join('');
}
