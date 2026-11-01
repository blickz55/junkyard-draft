/**
 * The fairness and verification policy (PLAN-v3 0.6.5) as data: built from the rules module, the verifier's constants
 * and the identity/data policy text, so the in-game panel, `game/public/policy.json` and `docs/POLICY.md` can never
 * drift from the code. `tests/policy.test.ts` regenerates both and diffs them against the committed files.
 * Nothing here depends on time or the machine: the output is a pure function of the source.
 */
import { RULES } from '../game/src/sim/rules';
import { RULES_VERSION } from '../game/src/sim/types';
import { HUB_CATEGORIES, HUB_V2_POSTERS, TOPIC_TITLE_MAX } from '../game/src/content/hub';
import { categoryName } from '../game/src/content/sal-posts';
import { EVENTS } from '../game/src/telemetry/events';
import { NAME_MAX, NAME_BLOCKLIST, TAG_ALPHABET } from '../game/src/identity/identity';
import { MEDAL_PERCENTILES, MEDAL_MIN_N } from '../game/src/daily/medals';
import {
  DEFAULT_REPORT_POLICY,
  DAILY_HISTORY_DAYS,
  DEFAULT_READ_RATE_LIMIT,
  DEFAULT_WRITE_RATE_LIMIT,
  DEFAULT_MAX_PLAYERS,
  TIE_BREAK,
  RENAME_COOLDOWN_MS,
  MAX_BOARD_LIMIT,
  MAX_DAILY_LIMIT,
  MAX_ARCHIVE_LIMIT,
  DAILY_WINDOW_MS,
  DEFAULT_RATE_LIMIT,
  DEFAULT_PLAYER_RATE_LIMIT,
  IDENTITY_RATE_LIMIT,
  DEFAULT_EVENTS_RATE_LIMIT,
  MAX_BODY_BYTES,
  DEFAULT_REPLAYS_PER_SEED,
  DEFAULT_MAX_ENTRIES_PER_SEED,
  DEFAULT_MAX_SEEDS,
  DEFAULT_EVENTS_RETENTION_DAYS,
  PROTOCOL,
  HOT_DAYS,
  COLD_REPLAYS_PER_DAY,
  MAX_GROUPS_PER_PLAYER,
  MAX_GROUP_MEMBERS,
  REPORT_REASONS,
  REPORT_RATE_LIMIT,
  FRIEND_RATE_LIMIT,
  MAX_HIDES_PER_NAME,
  HIDDEN_LABEL,
  APPEAL_CONTACT,
} from '../server/verify';
import { LINK_PER_ADDRESS, LINK_PER_IP, LINK_PER_PLAYER, LINK_TTL_MS } from '../server/link';
import { APPEAL_DAYS, DEFAULT_SETTINGS, EDIT_WINDOW_MS, MESSAGE_MAX, POST_MAX, POST_RATE_LIMIT, REVIEW_SLA_HOURS, TRIAGE_MODEL } from '../server/moderation';
import { ACTIVITY_PER_PLAYER, FEED_MEMBERS, MAX_FRIENDS, MESSAGE_DAYS, REMOVED_TEXT_DAYS, SIGNAL_DAYS } from '../server/community';

export interface PolicySection {
  title: string;
  lines: string[];
}
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
    {
      title: 'Rules',
      lines: [
        `Rules version ${RULES_VERSION}. Any change to a rule or tuning value bumps the version; replays and saves from an older version no longer verify or resume, and old verified entries stay in their own archive.`,
        `${RULES.rounds} rounds on an ${RULES.gridWidth}×${RULES.gridHeight} grid, ${RULES.ticksPerRound} ticks per round. Score = total money shipped.`,
        `Belts: bought one at a time while building, $${RULES.beltCost} each from the running score, refused below it or when the shelf's ${RULES.shelfSlots} slots are full. Conveyors are never offered in the draft. A spare part sells for $${RULES.sellValue}, so buying and selling never pays.`,
        `Reroll: once per round in the draft for $${RULES.rerollCost} from the running score; the new offers come from their own stream, so a reroll never changes a later round.`,
        `Tuner: adjacent crusher, furnace and press work ${RULES.tunerBonus} tick faster; offered from round ${RULES.offerFromRound.tuner ?? 1}.`,
        `Late-round offer guarantee ("lateOfferGuarantee"): ${RULES.lateOfferGuarantee.rounds.length ? `in rounds ${RULES.lateOfferGuarantee.rounds.join(', ')} a draft always carries a ${RULES.lateOfferGuarantee.kinds.join(' or ')}` : 'off: measured in the 0.9.6 study and not shipped; every draft is the plain draw'}.`,
        `The full tuning table (prices, weights, process times) is the "rules" object of this document.`,
      ],
    },
    {
      title: 'Verification',
      lines: [
        'A score counts only when the verifier has re-simulated the replay with the same rules and reached the same result. Nothing is trusted from the client: not the score, not the machine count, not the player label.',
        'Replay identity is the SHA-256 of the canonical replay content (rules version, seed, actions). The same actions submitted twice are one replay.',
        `Tie-break: ${TIE_BREAK}`,
        'Pausing a round and stepping it one tick at a time while paused (the Step button or the "." key) are allowed everywhere, the ranked daily included: they change how you watch the simulation, never what it does, and a replay carries no timing.',
        'One best entry per player per seed: a better verified run replaces the earlier one and its stored replay; an equal or worse run is verified but not recorded. Anonymous entries (no identity) are never claimable and stay as they are.',
        `Retention: stored replays for each seed's top ${DEFAULT_REPLAYS_PER_SEED} entries; at most ${DEFAULT_MAX_ENTRIES_PER_SEED} entries per seed and ${DEFAULT_MAX_SEEDS} seeds (least recently active dropped); boards return at most ${MAX_BOARD_LIMIT} entries, the daily ${MAX_DAILY_LIMIT}, the archive ${MAX_ARCHIVE_LIMIT} days per page.`,
        "Bot par is the shipped autoplayer's median on a seed, computed by the verifier: a target labelled as a bot, never an entry.",
      ],
    },
    {
      title: 'The daily',
      lines: [
        "The ranked daily seed is minted by the verifier from a server secret for each UTC date and published only once the day has opened. With it comes a commitment (SHA-256) to the next day's seed, so tomorrow's offers are fixed before anyone can play them and cannot be swapped afterwards.",
        `Each daily accepts submissions for ${hours(DAILY_WINDOW_MS)} from 00:00 UTC of its date, the same deadline for everyone. Then the board is final: a later run is still re-simulated and the player is told its score, but it never joins the board.`,
        'Without a reachable verifier the game offers the practice seed for the date (daily-YYYY-MM-DD): unranked, playable offline, an ordinary seed board.',
        "The weekly seed opens every Friday at 18:00 UTC and closes seven days later, minted from the same secret with its own commitment chain and the same freeze, medals and archive; a Friday's daily also publishes the commitment to the weekly opening that evening. Same rules, a longer window, no modifiers.",
        `Closed days stay in the archive with their final board and can be played as practice. ${HOT_DAYS} days after a day closes it moves to cold storage: every entry and the final board stay, and only its top ${COLD_REPLAYS_PER_DAY} replays remain watchable.`,
        'An operator may connect a Discord channel: the verifier then posts when a daily or weekly opens, when an open event gets a new #1 (the player label and score), and when an event closes (the medal thresholds). Nothing is posted that the public board does not already show, and a post never delays or fails a submission.',
        "Other players' replays on an open daily are revealed to you after you submit a verified run for it, or when the day closes; archive days are always watchable. The verifier enforces this on the replay endpoint.",
        'Forks: from any replay you can watch, "continue as practice from after round N" takes over that layout and bin on the same seed. A fork is labelled in the game and in its share text, is never submitted or exported, and is kept apart from your own bests.',
        'A challenge link ("beat this") carries a verified entry\'s per-round earnings and standing, never its replay or layout, so sharing one on an open daily reveals nothing the gate protects. A challenge played inside a daily\'s window counts on the daily board like any other verified run.',
      ],
    },
    {
      title: 'Medals',
      lines: [
        `When a day closes with at least ${MEDAL_MIN_N} verified runs, its final scores set three thresholds by nearest-rank percentile: bronze at the ${MEDAL_PERCENTILES.bronze}th, silver at the ${MEDAL_PERCENTILES.silver}th, gold at the ${MEDAL_PERCENTILES.gold}th (threshold(p) = sorted[ceil(p/100 · n) − 1]). A tied score earns the medal. Fewer runs: no medals.`,
      ],
    },
    {
      title: 'Identity and your data',
      lines: [
        'Playing needs no account and there are no passwords. On first use the game creates a random 128-bit key on your device. The verifier sees only its SHA-256 hash (your player id) and never stores or logs the key itself; the key travels only to https or loopback verifiers.',
        'Signing in with email is optional. A one-time link proves the address; the verifier keeps its SHA-256 hash and never the address. Each device keeps its own key, and the verifier records which player the hash of that key stands for.',
        `Your display name (up to ${NAME_MAX} characters, normalised, ${NAME_BLOCKLIST.length} blocked words after folding look-alikes) is shown as Name#TAG, the four-character tag derived from your player id over the alphabet ${TAG_ALPHABET}. You can rename once every ${hours(RENAME_COOLDOWN_MS)}; a rename follows you onto every board.`,
        'The recovery code is your key in base32 groups. Anyone with it can play as you: keep it private. Entering it on another device moves the player there.',
        'Your data: "Download my data" in the game (GET /me/export with your key) returns everything stored under your player id: entries with their kept replays, group memberships, the moderation record of your name, the reports you filed. "Delete my data" (DELETE /me) removes your name, anonymises your entries as "deleted", drops their replays from live and cold storage, ends your group memberships and replaces the key on your device. Nothing else about you is stored; the privacy notice (Privacy & data in the game, legal/privacy.html next to it) says who runs the service and why each item is kept.',
        `Groups: a group is an 8-character code; its boards, histograms and daily strip show only members' verified entries with ranks and percentiles recomputed over the group. Membership is keyed by player id, group names pass the same filter as player names, at most ${MAX_GROUPS_PER_PLAYER} groups per player and ${MAX_GROUP_MEMBERS} members per group, and a code is never listed anywhere: whoever holds it can join.`,
        `Reporting a name: any player with a claimed name can report another player's name (POST /report with their key and one reason from ${REPORT_REASONS.join(', ')}; by player id or by the hash of one of their verified runs; at most ${REPORT_RATE_LIMIT} per minute). The name shows as "${HIDDEN_LABEL}" on every board once ${DEFAULT_REPORT_POLICY.reporters} different established players have reported it (established: a verified run at least ${DEFAULT_REPORT_POLICY.establishedDays} days old) or when a moderator confirms a report; a hide a moderator has not confirmed lapses after ${DEFAULT_REPORT_POLICY.expiryHours} hours, a confirmed one stands until the moderator clears it or forces a rename; scores, entries and replays are never touched and a report is never a ban. Once a moderator has cleared a name ${MAX_HIDES_PER_NAME} times, further reports are recorded but no longer hide it. Every report and moderator action is logged. Appeals: ${APPEAL_CONTACT}.`,
        'Share cards and clips are rendered on your device and saved as files; nothing is uploaded, and a card says "verified" only when this very run was re-simulated by the verifier.',
        `The verifier stores: verified entries (seed, score, label, time, replay hash, machine count, player id when claimed), replays for the retention window, claimed names, issued dailies, bot pars. It stores no addresses: play statistics, when you opt in, carry a daily-salted hash of the address that cannot be linked across days, and the request log carries the same kind of hash (never the address, never a group code). Past dailies and weeklies are kept ${DAILY_HISTORY_DAYS} days back.`,
      ],
    },
    {
      title: 'Writing and moderation',
      lines: [
        `Writing needs a linked email. A post is at most ${POST_MAX} characters of plain text, at most ${POST_RATE_LIMIT} a minute, and the same words twice within ten minutes are refused. On an open day you can write once you have a verified run on it; once the day closes, anyone can.`,
        `A day has one talk, a thread for each daily and weekly. It stays behind the same reveal gate as the recordings: on an open yard only players with a verified run on it read or write there, and when the yard closes anyone can, and it is also a public page at /community/day/<date>. Sal opens it with a neutral line and closes it from the final board: the number of runs, the median, the top three and the most-reacted run. A checked game has a talk of its own behind the same gate, and its owner is told when someone writes there. A post can carry a run from that yard by its hash, and can be changed for ${EDIT_WINDOW_MS / 60_000} minutes, after which the new words go through the same filter and classifier again and whatever a person said about the old ones no longer applies. A player can take their own post back and the words go at once, unless it is down for a person to look at.`,
        'The filter refuses a post at write time for a blocked word (after folding look-alikes and leetspeak), a link, an email address, a phone number or a home address. A refused post is never stored.',
        `Every public post is then read by a small AI model (${TRIAGE_MODEL}) against a fixed rubric, with no name and no id, which answers a category and a score from 0 to 100. Under ${DEFAULT_SETTINGS.queueAt} the post stays up; from ${DEFAULT_SETTINGS.queueAt} it stays up and goes to a person; from ${DEFAULT_SETTINGS.hideAt} it comes down until a person has looked. The owner can change these numbers. If the queue goes unwatched for ${DEFAULT_SETTINGS.awayAfterHours} hours the bar for coming down drops to ${DEFAULT_SETTINGS.awayHideAt}. A post waits a few seconds for this; its author reads it meanwhile.`,
        'If the classifier cannot answer, or its daily budget is spent, the post stays up and goes to a person: a failure never skips the review and never silences anyone.',
        `Reports on posts use the same fixed reasons as names. ${DEFAULT_REPORT_POLICY.reporters} established players take a post down until a person looks, one trusted moderator at once. A post a person has cleared stays up, and new reports put it back in front of a person.`,
        `A person can clear, hide, restore or remove a post and mute a player for 24 hours or 7 days; only the owner bans. A ban stops a player writing and nothing else: it holds the player id and the hash of the email address, and takes down what the player had up. The words of a removed post go after ${REMOVED_TEXT_DAYS} days. Trusted moderators are players the owner appoints; they must have a linked email.`,
        `Every decision has a reason code from a fixed list, a row in the database and a line in the audit log, and tells the player in their inbox. They can appeal it from there, once, within ${APPEAL_DAYS} days. An appeal passes the same filter. A person answers: kept, or undone, and the player hears either way.`,
        `Target: a person reviews everything flagged within ${REVIEW_SLA_HOURS} hours. This page shows the live counts for each month (posts, hidden, removed, appeals, decisions kept, decisions undone) from GET /transparency.`,
      ],
    },
    {
      title: 'The community',
      lines: [
        `Four categories, each one thread: ${HUB_CATEGORIES.map((c) => categoryName(c)).join(', ')}. They read in the game and as plain web pages at /community/, with no key and no script, and writing goes through the same pipeline as the talk. Past days with a talk are listed there too.`,
        `Players can start topics of their own once ${HUB_V2_POSTERS} people have posted in the last seven days, so the hub never looks dead; the title, up to ${TOPIC_TITLE_MAX} characters, is read with the first post, and a topic shows when that post does. A moderator can pin a thread and close one.`,
      ],
    },
    {
      title: 'Friends and the feed',
      lines: [
        `Friends need a linked email on both sides. You add someone from a game of theirs or a post of theirs, so nobody can be searched for or listed; a request reaches their inbox and they accept it or leave it. At most ${MAX_FRIENDS} friends and open requests, ${FRIEND_RATE_LIMIT} friend actions a minute.`,
        'A block ends what was there and hides you from each other in the talk, in the feed and on the chart of scores, both ways. Boards stay as they are, because scores are public. Removing or blocking someone tells them nothing, and a request to someone who has blocked you reads like any other.',
        `Direct messages go between friends only, up to ${MESSAGE_MAX} characters, and last ${MESSAGE_DAYS} days. They pass the write-time filter and nothing else: neither the classifier nor a person reads a message unless the player it was sent to reports it. Then the classifier reads that one message, and a person sees it with the messages around it and can clear it, remove it, or mute or ban its sender; a removed message can be appealed like any decision. A block ends the conversation for both.`,
        `The feed shows your friends and crew mates: their games on dailies and weeklies, their posts and their division results, newest first, with the same reveal gate as the talk. Each player keeps their last ${ACTIVITY_PER_PLAYER} lines, and a feed reads at most ${FEED_MEMBERS} players.`,
      ],
    },
    {
      title: 'When a day goes wrong',
      lines: [
        "A day a bug made unfair is voided and played again on a new yard with a full window. It is never re-scored. What the voided day earned is taken back, its games are kept aside for a person to read, and the day before's commitment still matches the voided yard, so nobody has to take our word for what happened.",
      ],
    },
    {
      title: 'Two boards',
      lines: [
        "The main board is for people, on your word. A game played by a script or a tool goes on the Assisted board beside it: anything sent with the game's test hooks open goes there by itself, and a moderator can move a game either way with a reason that is logged. An Assisted game earns no medal and no place in a division. A closed day's board is final.",
      ],
    },
    {
      title: 'What a person may look at',
      lines: [
        `For each game on a daily or a weekly the server notes when it arrived, how many tries that player has had on that yard, and whether someone else already holds the same game, and keeps that for ${SIGNAL_DAYS} days. A person may read it, with the recording, when something looks wrong. Nothing acts on it by itself: no score is removed and nobody is banned by a number.`,
      ],
    },
    {
      title: 'Your profile',
      lines: [
        'Your profile shows your name, the month you arrived, your trophies and your three best games, one per yard. It opens from a game on a board, a comment or a post, so there is no list of players, and a game on an open day stays off it until the day has closed or the person looking has played that yard.',
        'Show my profile in Privacy & data leaves only your name there, whoever looks. Someone you blocked, or who blocked you, sees the same, so a block is not announced. Your scores stay on the boards, because scores are public.',
      ],
    },
    {
      title: 'Divisions and trophies',
      lines: [
        'Divisions, medals and trophies are labels over checked games: none of them changes an offer, a rule or a score.',
        'Paint and titles are earned the same way, by days of dailies and by trophies, and stay once earned. They change how a yard looks, to you and to anyone watching your recordings, and a word beside your name. They never change an offer, a rule or a score.',
      ],
    },
    {
      title: 'Play statistics',
      lines: [
        `On unless you turn them off, with one switch in Settings; a browser sending Global Privacy Control or Do Not Track starts with them off. The game sends only events from a fixed vocabulary (${Object.keys(EVENTS).length} names: ${Object.keys(EVENTS).join(', ')}), never seeds other than daily/tutorial labels, never layouts. Kept ${DEFAULT_EVENTS_RETENTION_DAYS} days.`,
      ],
    },
    {
      title: 'Abuse limits',
      lines: [
        `Submissions: ${DEFAULT_RATE_LIMIT} per minute per address and ${DEFAULT_PLAYER_RATE_LIMIT} per minute per player; identity calls ${IDENTITY_RATE_LIMIT} per minute per player; reports ${REPORT_RATE_LIMIT} per minute per player; reads ${DEFAULT_READ_RATE_LIMIT} and identity, group, report or deletion calls ${DEFAULT_WRITE_RATE_LIMIT} per minute per address; statistics ${DEFAULT_EVENTS_RATE_LIMIT} per minute per address; request bodies up to ${Math.round(MAX_BODY_BYTES / 1024)} KB; at most ${DEFAULT_MAX_PLAYERS} claimed identities (the oldest that never played and sit in no group make room). Limits answer 429 with Retry-After and never record anything.`,
        `Posts and appeals: ${POST_RATE_LIMIT} per minute per player.`,
        `Sign-in emails: ${LINK_PER_ADDRESS} an hour per address, ${LINK_PER_PLAYER} per player and ${LINK_PER_IP} per network address; a link works once, for ${LINK_TTL_MS / 60_000} minutes.`,
        `Protocol level ${PROTOCOL}: endpoints only grow; a client one release behind keeps working.`,
      ],
    },
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
  for (const s of p.sections) {
    out.push(`## ${s.title}`, '');
    for (const l of s.lines) out.push(`- ${l}`);
    out.push('');
  }
  out.push('## Rules table', '', '```json', JSON.stringify(p.rules, null, 2), '```', '');
  return out.join('\n');
}

export const POLICY_JSON_PATH = 'game/public/policy.json';
export const POLICY_MD_PATH = 'docs/POLICY.md';
export const policyJson = (p: Policy): string => JSON.stringify(p, null, 2) + '\n';
