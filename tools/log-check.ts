/**
 * Reads a verifier log from stdin (what `docker logs verifier 2>&1` prints) and fails when a request line carries a client
 * address or a group code (production roadmap 0.8.1). Request lines are JSON objects with `method`; their `ip` must be the
 * 16-hex daily-salted hash and their `path` must not carry a group code. Any other line (startup banners, cold-split notes)
 * must not contain `group=` either. Exit 0 when every line is clean and at least one request line was seen, 1 otherwise.
 *   docker logs verifier 2>&1 | node --import tsx tools/log-check.ts
 */
import { stdin } from 'node:process';

const IPV4 = /\b(?:\d{1,3}\.){3}\d{1,3}\b/;
const IPV6 = /\b(?:[0-9a-f]{0,4}:){2,7}[0-9a-f]{0,4}\b/i;
export function checkLogLines(lines: string[]): { requests: number; problems: string[] } {
  let requests = 0; const problems: string[] = [];
  for (const raw of lines) {
    const line = raw.trim(); if (!line) continue;
    if (line.startsWith('{')) {
      let j: Record<string, unknown> | null = null;
      try { j = JSON.parse(line) as Record<string, unknown>; } catch { /* not a JSON line */ }
      if (j && typeof j.method === 'string') {
        requests++;
        if (typeof j.ip !== 'string' || !/^[0-9a-f]{16}$/.test(j.ip)) problems.push(`request line without a hashed ip: ${line.slice(0, 160)}`);
        if (typeof j.path === 'string' && /[?&]group=(?!~(?:&|$))/.test(j.path)) problems.push(`group code in a logged path: ${line.slice(0, 160)}`);
        for (const [k, v] of Object.entries(j)) if (k !== 'ms' && k !== 'status' && typeof v === 'string' && (IPV4.test(v) || (k !== 'ts' && IPV6.test(v)))) problems.push(`address-like value in request line field ${k}: ${line.slice(0, 160)}`);
        continue;
      }
    }
    if (/[?&]group=(?!~(?:&|$))/.test(line)) problems.push(`group code in a log line: ${line.slice(0, 160)}`);
  }
  return { requests, problems };
}

const isMain = process.argv[1] && /log-check\.(ts|mjs|js)$/.test(process.argv[1]);
if (isMain) {
  let text = '';
  stdin.setEncoding('utf8');
  stdin.on('data', (c) => { text += c; });
  stdin.on('end', () => {
    const { requests, problems } = checkLogLines(text.split('\n'));
    for (const p of problems) console.error(`FAIL ${p}`);
    if (!requests) console.error('FAIL no request lines found in the log');
    if (problems.length || !requests) { process.exitCode = 1; return; }
    console.log(`log clean: ${requests} request line(s), hashed addresses only, no group codes`);
  });
}
