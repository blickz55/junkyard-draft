/**
 * Void a day (production roadmap 0.12.5): a day a bug compromised is voided and re-issued, never re-scored. The verifier is the single writer of its
 * board, so this asks it to, with the moderation token: the day's games leave the board for a file beside it, what they earned is taken back, and the
 * day starts again on a new yard with a fresh window. It cannot be undone, so it says what it will do and needs --yes.
 *   node --import tsx tools/void-day.ts <verifier-url> <YYYY-MM-DD> --reason "what went wrong" --yes [--token T]
 * Exit 0 when the day was voided, 1 on a refusal, 2 on usage. MODERATION_TOKEN is read when --token is absent.
 */
const args = process.argv.slice(2);
const flag = (k: string) => {
  const i = args.indexOf(`--${k}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const url = args.find((a) => /^https?:\/\//.test(a));
const date = args.find((a) => /^\d{4}-\d{2}-\d{2}$/.test(a));
const reason = flag('reason');
const token = flag('token') ?? process.env.MODERATION_TOKEN;
if (!url || !date || !reason || !token) {
  console.error('usage: void-day <verifier-url> <YYYY-MM-DD> --reason "what went wrong" --yes [--token T]');
  process.exit(2);
}

async function main() {
  const before = (await (await fetch(`${url}/daily?date=${date}&limit=1`)).json()) as { seed?: string; n?: number; entries?: unknown[] };
  if (!args.includes('--yes')) {
    console.log(`would void ${date} (${before.seed ?? 'not issued'}): its games leave the board and what they earned is taken back. Add --yes to do it.`);
    return;
  }
  const res = await fetch(`${url}/moderation/void`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Moderation-Token': token! },
    body: JSON.stringify({ date, reason }),
  });
  const out = (await res.json()) as { ok?: boolean; error?: string; games?: number; record?: { seed: string; closesAt: string } };
  if (!res.ok || !out.ok) {
    console.error(`POST /moderation/void → ${res.status}: ${out.error ?? JSON.stringify(out)}`);
    process.exitCode = 1;
    return;
  }
  console.log(`voided ${date}: ${out.games} games kept aside, re-issued as ${out.record!.seed}, closes ${out.record!.closesAt}. Announce it.`);
}
main().catch((e) => {
  console.error((e as Error).message);
  process.exitCode = 1;
});
