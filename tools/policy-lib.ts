/**
 * The fairness and verification policy (PLAN-v3 0.6.5) as data: built from the rules module, the verifier's constants
 * and the identity/data policy text, so the in-game panel, `game/public/policy.json` and `docs/POLICY.md` can never
 * drift from the code. `tests/policy.test.ts` regenerates both and diffs them against the committed files.
 * Nothing here depends on time or the machine: the output is a pure function of the source.
 */
import { RULES } from '../game/src/sim/rules';
import { RULES_VERSION } from '../game/src/sim/types';
import { EVENTS } from '../game/src/telemetry/events';
import { NAME_MAX, NAME_BLOCKLIST, TAG_ALPHABET } from '../game/src/identity/identity';
import { MEDAL_PERCENTILES, MEDAL_MIN_N } from '../game/src/daily/medals';
import { TIE_BREAK, RENAME_COOLDOWN_MS, MAX_BOARD_LIMIT, MAX_DAILY_LIMIT, MAX_ARCHIVE_LIMIT, DAILY_WINDOW_MS, DEFAULT_RATE_LIMIT, DEFAULT_PLAYER_RATE_LIMIT, IDENTITY_RATE_LIMIT, DEFAULT_EVENTS_RATE_LIMIT, MAX_BODY_BYTES, DEFAULT_REPLAYS_PER_SEED, DEFAULT_MAX_ENTRIES_PER_SEED, DEFAULT_MAX_SEEDS, DEFAULT_EVENTS_RETENTION_DAYS, PROTOCOL, HOT_DAYS, COLD_REPLAYS_PER_DAY, MAX_GROUPS_PER_PLAYER, MAX_GROUP_MEMBERS } from '../server/verify';

export interface PolicySection { title: string; lines: string[] }
export interface Policy {
  schema: 1;
  rulesVersion: number;
  protocol: number;
  tieBreak: string;
  rules: Record<string, unknown>;
  sections: PolicySection[];
}

const hours = (ms: number) => `${Math.round(ms / 3_600_000)} h`;

export function buildPolicy(): Policy {
  const rules = JSON.parse(JSON.stringify(RULES)) as Record<string, unknown>;
  const sections: PolicySection[] = [
    { title: 'Rules', lines: [
      `Rules version ${RULES_VERSION}. Any change to a rule or tuning value bumps the version; replays and saves from an older version no longer verify or resume, and old verified entries stay in their own archive.`,
      `${RULES.rounds} rounds on an ${RULES.gridWidth}×${RULES.gridHeight} grid, ${RULES.ticksPerRound} ticks per round. Score = total money shipped.`,
      `Reroll: once per round in the draft for $${RULES.rerollCost} from the running score; the new offers come from their own stream, so a reroll never changes a later round.`,
      `Tuner: adjacent crusher, furnace and press work ${RULES.tunerBonus} tick faster; offered from round ${RULES.offerFromRound.tuner ?? 1}.`,
      `The full tuning table (prices, weights, process times) is the "rules" object of this document.`,
    ] },
    { title: 'Verification', lines: [
      'A score counts only when the verifier has re-simulated the replay with the same rules and reached the same result. Nothing is trusted from the client: not the score, not the machine count, not the player label.',
      'Replay identity is the SHA-256 of the canonical replay content (rules version, seed, actions). The same actions submitted twice are one replay.',
      `Tie-break: ${TIE_BREAK}`,
      'One best entry per player per seed: a better verified run replaces the earlier one and its stored replay; an equal or worse run is verified but not recorded. Anonymous entries (no identity) are never claimable and stay as they are.',
      `Retention: stored replays for each seed's top ${DEFAULT_REPLAYS_PER_SEED} entries; at most ${DEFAULT_MAX_ENTRIES_PER_SEED} entries per seed and ${DEFAULT_MAX_SEEDS} seeds (least recently active dropped); boards return at most ${MAX_BOARD_LIMIT} entries, the daily ${MAX_DAILY_LIMIT}, the archive ${MAX_ARCHIVE_LIMIT} days per page.`,
      'Bot par is the shipped autoplayer\'s median on a seed, computed by the verifier: a target labelled as a bot, never an entry.',
    ] },
    { title: 'The daily', lines: [
      'The ranked daily seed is minted by the verifier from a server secret for each UTC date and published only once the day has opened. With it comes a commitment (SHA-256) to the next day\'s seed, so tomorrow\'s offers are fixed before anyone can play them and cannot be swapped afterwards.',
      `Each daily accepts submissions for ${hours(DAILY_WINDOW_MS)} from 00:00 UTC of its date, the same deadline for everyone. Then the board is final: a later run is still re-simulated and the player is told its score, but it never joins the board.`,
      'Without a reachable verifier the game offers the practice seed for the date (daily-YYYY-MM-DD): unranked, playable offline, an ordinary seed board.',
      `Closed days stay in the archive with their final board and can be played as practice. ${HOT_DAYS} days after a day closes it moves to cold storage: every entry and the final board stay, and only its top ${COLD_REPLAYS_PER_DAY} replays remain watchable.`,
      'Other players\' replays on an open daily are revealed to you after you submit a verified run for it, or when the day closes; archive days are always watchable. The verifier enforces this on the replay endpoint.',
      'Forks: from any replay you can watch, "continue as practice from after round N" takes over that layout and bin on the same seed. A fork is labelled in the game and in its share text, is never submitted or exported, and is kept apart from your own bests.',
      'A challenge link ("beat this") carries a verified entry\'s per-round earnings and standing, never its replay or layout, so sharing one on an open daily reveals nothing the gate protects. A challenge played inside a daily\'s window counts on the daily board like any other verified run.',
    ] },
    { title: 'Medals', lines: [
      `When a day closes with at least ${MEDAL_MIN_N} verified runs, its final scores set three thresholds by nearest-rank percentile: bronze at the ${MEDAL_PERCENTILES.bronze}th, silver at the ${MEDAL_PERCENTILES.silver}th, gold at the ${MEDAL_PERCENTILES.gold}th (threshold(p) = sorted[ceil(p/100 · n) − 1]). A tied score earns the medal. Fewer runs: no medals.`,
    ] },
    { title: 'Identity and your data', lines: [
      'There are no accounts or passwords. On first use the game creates a random 128-bit key on your device. The verifier sees only its SHA-256 hash (your player id) and never stores or logs the key itself; the key travels only to https or loopback verifiers.',
      `Your display name (up to ${NAME_MAX} characters, normalised, ${NAME_BLOCKLIST.length} blocked words after folding look-alikes) is shown as Name#TAG, the four-character tag derived from your player id over the alphabet ${TAG_ALPHABET}. You can rename once every ${hours(RENAME_COOLDOWN_MS)}; a rename follows you onto every board.`,
      'The recovery code is your key in base32 groups. Anyone with it can play as you: keep it private. Entering it on another device moves the player there.',
      'Deletion: DELETE /me with your key removes your name, anonymises your entries as "deleted" and drops their replays. Nothing else about you is stored.',
      `Groups: a group is an 8-character code; its boards, histograms and daily strip show only members\' verified entries with ranks and percentiles recomputed over the group. Membership is keyed by player id, group names pass the same filter as player names, at most ${MAX_GROUPS_PER_PLAYER} groups per player and ${MAX_GROUP_MEMBERS} members per group, and a code is never listed anywhere: whoever holds it can join.`,
      'Share cards and clips are rendered on your device and saved as files; nothing is uploaded, and a card says "verified" only when this very run was re-simulated by the verifier.',
      'The verifier stores: verified entries (seed, score, label, time, replay hash, machine count, player id when claimed), replays for the retention window, claimed names, issued dailies, bot pars. It stores no addresses: play statistics, when you opt in, carry a daily-salted hash of the address that cannot be linked across days.',
    ] },
    { title: 'Play statistics (opt-in)', lines: [
      `Off by default. When on, the game sends only events from a fixed vocabulary (${Object.keys(EVENTS).length} names: ${Object.keys(EVENTS).join(', ')}), never seeds other than daily/tutorial labels, never layouts. Kept ${DEFAULT_EVENTS_RETENTION_DAYS} days.`,
    ] },
    { title: 'Abuse limits', lines: [
      `Submissions: ${DEFAULT_RATE_LIMIT} per minute per address and ${DEFAULT_PLAYER_RATE_LIMIT} per minute per player; identity calls ${IDENTITY_RATE_LIMIT} per minute per player; statistics ${DEFAULT_EVENTS_RATE_LIMIT} per minute per address; request bodies up to ${Math.round(MAX_BODY_BYTES / 1024)} KB. Limits answer 429 with Retry-After and never record anything.`,
      `Protocol level ${PROTOCOL}: endpoints only grow; a client one release behind keeps working.`,
    ] },
  ];
  return { schema: 1, rulesVersion: RULES_VERSION, protocol: PROTOCOL, tieBreak: TIE_BREAK, rules, sections };
}

export function renderPolicyMarkdown(p: Policy): string {
  const out: string[] = [
    '# Junkyard Draft — fairness and verification policy',
    '',
    `Generated by \`tools/make-policy.ts\` from the code (rules version ${p.rulesVersion}, protocol ${p.protocol}); do not edit by hand. The same data is shipped as \`game/public/policy.json\` and rendered in the game (title and results: "Fairness policy"). \`tests/policy.test.ts\` fails when this file is stale.`,
    '',
    `**Tie-break:** ${p.tieBreak}`,
    '',
  ];
  for (const s of p.sections) { out.push(`## ${s.title}`, ''); for (const l of s.lines) out.push(`- ${l}`); out.push(''); }
  out.push('## Rules table', '', '```json', JSON.stringify(p.rules, null, 2), '```', '');
  return out.join('\n');
}

export const POLICY_JSON_PATH = 'game/public/policy.json';
export const POLICY_MD_PATH = 'docs/POLICY.md';
export const policyJson = (p: Policy): string => JSON.stringify(p, null, 2) + '\n';
