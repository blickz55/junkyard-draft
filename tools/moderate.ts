/**
 * Name moderation from the command line (PLAN-v4 0.7.7), against a running verifier started with MODERATION_TOKEN.
 * The verifier is the single writer of its board, so this tool never touches board.json: it calls the moderator
 * endpoints, and the verifier appends one JSON line per action to moderation.jsonl next to the board.
 *   node --import tsx tools/moderate.ts <verifier-url> list
 *   node --import tsx tools/moderate.ts <verifier-url> clear <playerId>            the name is fine: shown again, reports closed
 *   node --import tsx tools/moderate.ts <verifier-url> rename <playerId> <name>    force a display name (filtered like any other)
 *   node --import tsx tools/moderate.ts <verifier-url> rename-group <code> <name>  force a group name
 * The token comes from --token or MODERATION_TOKEN. Exit 0 on success, 1 on a refusal or a failed request, 2 on usage.
 */
import type { ModerationRecord } from '../server/verify';

const args = process.argv.slice(2);
const url = args.find((a) => /^https?:\/\//.test(a));
const flagAt = args.indexOf('--token'); const token = flagAt >= 0 ? args[flagAt + 1] : process.env.MODERATION_TOKEN;
const rest = args.filter((a, i) => a !== url && i !== flagAt && i !== flagAt + 1);
const [cmd, a1, a2] = rest;
const usage = () => { console.error('usage: moderate <verifier-url> list | clear <playerId> | rename <playerId> <name> | rename-group <code> <name>   [--token T | MODERATION_TOKEN]'); process.exit(2); };
if (!url || !cmd || !['list', 'clear', 'rename', 'rename-group'].includes(cmd)) usage();
if (!token) { console.error('no moderation token: pass --token or set MODERATION_TOKEN (the verifier was started with the same value)'); process.exit(2); }
if ((cmd === 'clear' && !a1) || ((cmd === 'rename' || cmd === 'rename-group') && (!a1 || !a2))) usage();

type Row = ModerationRecord & { playerId: string; tag: string; currentName: string | null };
const call = async (method: string, p: string, body?: unknown) => {
  const r = await fetch(`${url}${p}`, { method, headers: { 'Content-Type': 'application/json', 'X-Moderation-Token': token! }, body: body === undefined ? undefined : JSON.stringify(body) });
  const json = await r.json() as Record<string, unknown> & { ok?: boolean; error?: string };
  if (!r.ok || !json.ok) { console.error(`${method} ${p} → ${r.status}: ${json.error ?? JSON.stringify(json)}`); process.exitCode = 1; return null; }
  return json;
};

async function main() {
  if (cmd === 'list') {
    const out = await call('GET', '/moderation/reports') as { reports: Row[]; reasons: string[]; maxHidesPerName: number } | null; if (!out) return;
    if (!out.reports.length) { console.log('no open reports and no hidden names'); return; }
    console.log(`${out.reports.length} player(s) with reports or a hidden name (oldest first); a report hides a name at most ${out.maxHidesPerName} times before a moderator has to act first\n`);
    for (const r of out.reports) {
      const reasons = new Map<string, number>(); for (const x of r.reports) reasons.set(x.reason, (reasons.get(x.reason) ?? 0) + 1);
      const renamed = r.currentName !== null && r.currentName !== r.name ? ` · renamed since to "${r.currentName}"` : r.currentName === null ? ' · player deleted since' : '';
      console.log(`${r.playerId}\n  "${r.name}"#${r.tag}${renamed}\n  ${r.hidden ? `HIDDEN since ${r.hiddenAt}` : 'shown'} · cleared ${r.clears}× · ${r.reports.length} report(s): ${[...reasons].map(([k, n]) => `${k}×${n}`).join(', ') || 'none open'}${r.reports[0] ? ` · first ${r.reports[0].at}` : ''}`);
    }
    console.log(`\nreasons: ${out.reasons.join(', ')}. Act with: clear <playerId> · rename <playerId> <name> · rename-group <code> <name>`);
    return;
  }
  if (cmd === 'clear') { const out = await call('POST', '/moderation/clear', { playerId: a1 }); if (out) console.log(`cleared ${a1}: name "${out.name}" shown again (cleared ${out.clears}× in all)`); return; }
  if (cmd === 'rename') { const out = await call('POST', '/moderation/rename', { playerId: a1, name: a2 }) as { player?: { name: string; tag: string } } | null; if (out?.player) console.log(`renamed ${a1} to ${out.player.name}#${out.player.tag}; the player's own rename cooldown restarted`); return; }
  const out = await call('POST', '/moderation/rename-group', { code: a1, name: a2 }) as { group?: { code: string; name: string } } | null; if (out?.group) console.log(`renamed group ${out.group.code} to "${out.group.name}"`);
}
main().catch((e) => { console.error((e as Error).message); process.exitCode = 1; });
