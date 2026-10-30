// Secret redaction for the Control Room collector (review F02). Two kinds of pattern:
//   - whole-match: the entire match is a credential (API keys, cloud keys, chat tokens) → replaced by [redacted];
//   - prefixed: group 1 is a harmless label ("Bearer ", "password=", "https://user:") that stays, the value after it is
//     replaced (and the URL form keeps its "@" so the host is still readable).
// Exported so tests can prove a synthetic token never survives into any serialised field.
const WHOLE = [
  /sk-ant-[A-Za-z0-9_-]{8,}/g,
  /sk-[A-Za-z0-9]{16,}/g,
  /ghp_[A-Za-z0-9]{16,}|github_pat_[A-Za-z0-9_]{16,}/g,
  /AKIA[0-9A-Z]{12,}/g,
  /xox[baprs]-[A-Za-z0-9-]{10,}/g,
];
const PREFIXED = [
  { re: /(Bearer\s+)[A-Za-z0-9._-]{8,}/gi, suffix: '' },
  { re: /((?:password|passwd|pwd|secret|token|api[_-]?key|authorization)\s*[=:]\s*['"]?)(?!bearer\b)[^\s'"&]{4,}/gi, suffix: '' }, // "Authorization: Bearer x" is the Bearer rule's job
  { re: /(https?:\/\/[^\s/@]+:)[^\s@]+@/gi, suffix: '@' }, // user:pass@host
];

export function redact(s) {
  let out = String(s);
  for (const re of WHOLE) out = out.replace(re, '[redacted]');
  for (const { re, suffix } of PREFIXED) out = out.replace(re, (_m, pre) => `${pre}[redacted]${suffix}`);
  return out;
}
