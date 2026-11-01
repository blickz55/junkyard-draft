/**
 * The legal minimum (production roadmap 0.8.6) as data: the privacy notice, the terms and the community guidelines,
 * built from the operator module (game/src/content/operator.ts) and the verifier's constants, so the texts can never
 * disagree with the code about retention, limits or the appeal contact. `tools/make-policy.ts` renders them to
 * `game/public/legal.json` (bundled into the game and shown by the "Privacy & data" panel) and to three standalone
 * pages under `game/public/legal/` (linkable from outside the game: Discord, the store page, an e-mail).
 * `tests/legal.test.ts` regenerates everything and diffs it against the committed files, like the fairness policy.
 *
 * ⚑ The text is the routine's draft of what the roadmap asked for; the owner reads it before hosting (it names them as
 * the controller) and fills OPERATOR.holder and OPERATOR.jurisdiction. Nothing here depends on time or the machine.
 */
import { OPERATOR } from '../game/src/content/operator';
import { RULES_VERSION } from '../game/src/sim/types';
import { EVENTS } from '../game/src/telemetry/events';
import { NAME_MAX, HIDDEN_LABEL } from '../game/src/identity/identity';
import {
  APPEAL_CONTACT,
  HOT_DAYS,
  COLD_REPLAYS_PER_DAY,
  DEFAULT_EVENTS_RETENTION_DAYS,
  DAILY_HISTORY_DAYS,
  DEFAULT_REPLAYS_PER_SEED,
  RENAME_COOLDOWN_MS,
  DEFAULT_REPORT_POLICY,
  MAX_GROUPS_PER_PLAYER,
  PROTOCOL,
} from '../server/verify';
import { INBOX_READ_DAYS, MESSAGE_DAYS, REMOVED_TEXT_DAYS } from '../server/community';
import { APPEAL_DAYS, POST_MAX, REVIEW_SLA_HOURS } from '../server/moderation';

export type LegalId = 'privacy' | 'terms' | 'guidelines';
export interface LegalSection {
  title: string;
  items: string[];
}
export interface LegalDoc {
  id: LegalId;
  title: string;
  /** one paragraph a player can read instead of the whole page */ summary: string;
  sections: LegalSection[];
}
export interface Legal {
  schema: 1;
  updated: string;
  rulesVersion: number;
  protocol: number;
  operator: { product: string; domain: string; siteUrl: string; repository: string; holder: string; contactEmail: string; appealEmail: string };
  docs: LegalDoc[];
}

export const LEGAL_JSON_PATH = 'game/public/legal.json';
export const LEGAL_HTML_DIR = 'game/public/legal';
export const LEGAL_IDS: readonly LegalId[] = ['privacy', 'terms', 'guidelines'];
export const legalHtmlPath = (id: LegalId): string => `${LEGAL_HTML_DIR}/${id}.html`;

const hours = (ms: number) => `${Math.round(ms / 3_600_000)} hours`;

export function buildLegal(): Legal {
  const O = OPERATOR;
  const eventCount = Object.keys(EVENTS).length;
  const privacy: LegalDoc = {
    id: 'privacy',
    title: 'Privacy notice',
    summary: `${O.product} needs no account to play, and has no passwords, no cookies and no advertising. The game keeps your settings and best scores on your device. The verifier keeps what public leaderboards need: the replays you submit, the display name you choose and a hash of a key your device made. Signing in with email is your choice: it keeps a hash of your address, never the address, so your progress can follow you to another device. You can download or delete all of it from the game. If you write a post, an AI service reads its words, without your name, and a person may too.`,
    sections: [
      {
        title: 'Who is responsible',
        items: [
          `The data controller is ${O.holder}, living in ${O.jurisdiction}, who operates ${O.product} at ${O.siteUrl}. Contact for anything in this notice: ${O.contactEmail}.`,
          `This notice covers the game at ${O.domain}, the desktop edition (which talks to the same verifier) and the verifier at verify.${O.domain}. It was last changed on ${O.legalUpdated}.`,
        ],
      },
      {
        title: 'On your device',
        items: [
          "The game stores in your browser's local storage (the desktop edition: under your user profile): your settings (sound, text size, motion, resolution, the play-data switch), the current save, your local best scores by rules version, the days you played, a random 128-bit device key with the display name and tag you chose, the group code you joined, the daily reminder's hour and subscription address if you turned it on, and, only while play statistics are on, a random install id with the events not yet sent.",
          'Nothing on your device is sent anywhere except as the next section describes. Clearing the site\'s data in your browser removes all of it; "Delete my data" in the game replaces the device key and removes the name, the group code and the statistics state, and leaves your local scores and settings alone.',
        ],
      },
      {
        title: 'What the verifier stores, and why',
        items: [
          "Verified entries. When you submit a run, the verifier stores the replay (seed, your actions, the rules version), the score, the time, the label you chose, the replay's hash and, when you have claimed a name, your player id. Purpose: public leaderboards whose scores were re-simulated rather than trusted. Legal basis: the agreement you enter by submitting (the terms and the fairness policy) and the legitimate interest in boards that are correct.",
          'Your identity. A player id, which is the SHA-256 hash of the key your device created, and the display name and tag you chose with the time of your last rename. The key itself leaves your device only as a bearer header over TLS to the verifier, which hashes it before any use and never stores or logs it. Purpose: one best entry per player, renames that follow you onto every board, groups, and deletion. Legal basis: the agreement.',
          `Groups. The codes of the groups you joined (at most ${MAX_GROUPS_PER_PLAYER}), keyed by player id. Purpose: boards scoped to the people you chose. Legal basis: the agreement.`,
          `Posts, only if you write one. The words, the day, game or community thread they belong to, your player id, the time and any game you attach. Each public post is read by an automatic filter and an AI classifier, and by a person if it is flagged, reported or appealed. On an open day only players with a game on it read the talk; once the day closes it is public, in the game and as a web page. Community threads are public from the start. Purpose: a conversation about the day that stays fit for everyone. Legal basis: the agreement you enter by posting, and the legitimate interest in a safe service. A post stays until you take it back or delete your data, unless it is down for a person to look at; the words of a post a moderator removed go after ${REMOVED_TEXT_DAYS} days, so an appeal can still be read.`,
          'Moderation. Reports you file (your player id, what you reported, one reason from a fixed list, the time), reports filed about your name or your posts, and every decision about a name, a post or a player: what was decided, a reason from a fixed list, who decided, the time, any note a moderator left, any appeal you wrote and its answer, in the database and in an audit log. Mutes and bans are kept with your player id; a ban also keeps the hash of your email address, so signing in again does not lift it. Purpose: a safe community and a record that decisions were made fairly. Legal basis: the legitimate interest in a safe service.',
          `Request logs. One line per request with the method, path, status, duration and a hash of your network address salted with the day, so the same address cannot be followed from one day to the next. The address itself is not written: the reverse proxy in front of the verifier is configured to drop it from its access log as well. Purpose: abuse limits and debugging. Legal basis: the legitimate interest in a service that stays up. Kept by rotation, ${O.logRotation} per service, which is days to weeks depending on traffic.`,
          `Play statistics, on unless you turn them off. Events from a fixed list of ${eventCount} names (which lesson step you reached, that a game completed, that a share was copied, and the like), a random install id stored on your device, and the same daily-salted address hash. Never seeds other than daily and tutorial labels, never layouts, never your player id. Purpose: seeing where the game confuses people, so it can be fixed. Legal basis: the legitimate interest in a game people can understand. Turn "Share play data" off in Settings at any time: that stops it at once and deletes the install id and the queue on your device. A browser that sends Global Privacy Control or Do Not Track starts with it off. Kept ${DEFAULT_EVENTS_RETENTION_DAYS} days on the server.`,
          'Reactions and watching. Which of the eight reactions your player id left on which run, and which recordings your player id watched and how often, with the times. Purpose: other players see the counts, never who left what or who watched. Both stay until you take the reaction back or delete your data.',
          "Divisions and trophies. When a day closes, the division your checked game placed in, your place in it, any medal, and a running count of medals. Purpose: a board of your own size. Other players see the division board with your name, as they see the day's board. Your name comes off when you delete your data.",
          `Direct messages, only if you send one. The words, who sent them, who received them and the times. They go between two friends and pass the automatic filter, and neither the AI classifier nor a person reads them unless the player a message was sent to reports it. Then the AI classifier reads that message, and a person reads it with the messages around it. Purpose: letting friends talk. Legal basis: the agreement. A message goes ${MESSAGE_DAYS} days after it was sent, or when either of you deletes their data.`,
          'Friends and the feed, only if you use them. Who you asked, who asked you, who your friends are and who you blocked, with the times, and the last few dozen things you did: a game on a day or a week, a post, a division result. Purpose: your friends and your crew see what you have been up to, and you see theirs. Legal basis: the agreement. A friend sees your name, your scores and those lines; nobody is told when they are removed or blocked. It stays until you remove it or delete your data.',
          `Your inbox. A line when someone reacts to a run of yours, writes on it or where you wrote, beats your score from a challenge link, or when your division or crew has a result, or when a moderator decides something about you, with the time. A line goes ${INBOX_READ_DAYS} days after you read it, or when you delete your data.`,
          `Signing in with email, only if you use it. When you ask for a link, the address goes to ${O.mailProvider} so the email can be delivered, and is not stored by the verifier. The verifier keeps the SHA-256 hash of the address, the hash of the one-time link for a day after it expires, the hashes of the device keys that signed in, and a copy of your settings, best scores, stars and record so they can follow you to another device. Purpose: signing you in on another device, which you asked for. Legal basis: the agreement. It stays until you sign out in Settings or delete your data.`,
          'Daily reminder, only if you turn it on. The push subscription your browser issues (an address at your browser maker\'s push service and two keys that let only your browser read the message) and the hour you chose, with your player id when you have claimed a name. Purpose: one notification a day, "The yard is open", the same for everyone, nothing else. Legal basis: consent, withdrawn by turning the reminder off, which deletes the subscription; "Delete my data" removes it too, and a subscription the push service reports gone is dropped.',
          'Not collected: no e-mail address in readable form, no password, no cookies, no advertising or analytics scripts, no payment data, no precise location. The desktop edition sends nothing the web game does not.',
        ],
      },
      {
        title: 'How long',
        items: [
          `Entries and replays follow the fairness policy's retention: replays are kept for each seed's top ${DEFAULT_REPLAYS_PER_SEED} entries; ${HOT_DAYS} days after a daily closes it moves to cold storage, where every entry and the final board stay and only the top ${COLD_REPLAYS_PER_DAY} replays remain; boards are kept ${DAILY_HISTORY_DAYS} days back. Your name and group memberships stay until you delete them.`,
          `Play-statistics events: ${DEFAULT_EVENTS_RETENTION_DAYS} days. Logs: by rotation, as above. Nightly backups of the verifier's data are kept for ${O.backupKeepDays} days, so a record you deleted can survive in a backup for up to ${O.backupKeepDays} days before it is gone everywhere; backups are used to recover from a failure, never to restore a deleted player.`,
          'Moderation decisions and the audit log outlive a deleted player, as the record of how the service was moderated: they keep the decision and the player id, which then leads to no name, and an appeal you wrote is erased. The hash of a banned address stays until the ban is lifted.',
        ],
      },
      {
        title: 'Who else sees it',
        items: [
          `Processors that run the service for the operator: ${O.hosting.verifier}; ${O.hosting.site}; ${O.hosting.source}; ${O.hosting.certificates}; ${O.hosting.chat}.`,
          "Your browser connects to Cloudflare's network to load the game and to the verifier's host to submit runs and read boards; each sees your network address the way any web server does, under its own privacy policy. The verifier itself stores no addresses.",
          "The boards are public. Anyone can see your display name and tag, your scores and ranks and, within the fairness policy's reveal rules, your replays; a Discord channel the operator connects shows the same facts. Nothing is sold, and there is no advertising.",
          `If you sign in with email, ${O.mailProvider} delivers the link. It sees the address and that an email was sent, and keeps delivery records for up to 30 days. It holds them in the United States under the EU Standard Contractual Clauses and the Data Privacy Framework.`,
          `If you write a public post, or someone reports a message of yours, ${O.aiProvider} runs the AI classifier for the operator. It receives the words of that post or message, without your name, your tag or your player id, and answers with a category and a score. It handles them as a service provider under its commercial terms.`,
          "If you turn the daily reminder on, your browser maker's push service (Apple, Google or Mozilla, depending on the browser) relays one encrypted message a day: it sees that a message went to your browser, not what it says.",
        ],
      },
      {
        title: 'Where',
        items: [
          `The verifier runs in the European Union. The operator lives in ${O.jurisdiction} and reaches the data from there to run the service. Cloudflare serves the game from the location nearest to you.`,
        ],
      },
      {
        title: 'Your rights',
        items: [
          'Download everything stored under your player id: "Download my data" in the game (Privacy & data), or GET /me/export with your key. The file lists your entries with their replays where kept, your group memberships, the moderation record of your name, the reports you filed, your posts, the decisions about you and any appeal you wrote.',
          'Delete it: "Delete my data" in the game, or DELETE /me with your key. Your name is removed, your entries stay on the boards anonymised as "deleted" with the score only, their replays are dropped from live and cold storage, your group memberships end, your posts and appeals go, and the key on your device is replaced, so nothing links the old entries to you.',
          `Correct it: the player button renames you (once every ${hours(RENAME_COOLDOWN_MS)}); turning play statistics off ends that processing at once.`,
          `Object to or ask about anything here at ${O.contactEmail}. Because the verifier knows you only by the hash of your device key, a request about a specific player has to come from the device that holds the key or from its recovery code: by e-mail alone we cannot tell whose data is whose, and we will not guess.`,
          'If you live in the EU, the EEA or the UK you may also complain to your data protection authority; elsewhere, to the body responsible for privacy where you live.',
        ],
      },
      {
        title: 'Children',
        items: [
          'The game is not directed at children under 13 and collects no personal information to play. Display names are public: do not use a real name, and if you are under 13 do not claim a name, sign in with email, write posts or turn play statistics on.',
        ],
      },
      {
        title: 'Changes',
        items: [
          `The date at the top changes with the text, and every change is listed in the repository's changelog at ${O.repository}. The fairness policy, generated from the code, describes the exact rules, limits and retention in force and is part of this notice.`,
        ],
      },
    ],
  };
  const terms: LegalDoc = {
    id: 'terms',
    title: 'Terms of play',
    summary: `${O.product} is a free game with public, verified leaderboards, run by one person on a small budget. Play fair, choose a name fit for a public board, keep your recovery code private. The service is best-effort: it may change, pause or stop.`,
    sections: [
      {
        title: 'The service',
        items: [
          `${O.product} is a free browser and desktop game operated by ${O.holder}. Playing needs no account. Submitting a run to the verified boards, claiming a display name, joining a group, writing a post and reporting a name or a post are the interactions with the service, and these terms govern them. By doing any of them you accept these terms, the community guidelines and the fairness policy, which is generated from the code and is part of these terms.`,
        ],
      },
      {
        title: 'Your key and your name',
        items: [
          'Your device creates a key on first use. Whoever holds it, or its recovery code, is you to the verifier: keep the code private. A lost key cannot be recovered and we cannot tell who used one. One key is one player; holding several places on a board with several keys is not allowed.',
          `Display names and group names follow the community guidelines: no impersonation, no slurs, no personal information, nothing that misleads about the game's staff. You may rename once every ${hours(RENAME_COOLDOWN_MS)}; a rename follows you onto every board.`,
        ],
      },
      {
        title: 'What "verified" means',
        items: [
          "A verified score means the verifier re-simulated the submitted replay with the stated rules version and reached the same result, and that the submission arrived inside the event's window. It does not certify that a human played without tools: the game is deterministic and its source is open, so anyone can compute a good run. The boards rank verified replays; the fairness policy describes ties, retention and medals.",
          'Rules versions change. When a rule or a tuning value changes, older replays stop verifying and the entries verified under the old version stay in their own archive. The daily secret, the limits and the schedule may change too.',
        ],
      },
      {
        title: 'Fair play',
        items: [
          "Automated play on a ranked board (the daily, the weekly), exploiting a verifier bug to record a score the rules would not allow, and publishing an open daily's layout so others can copy it are breaches. Practice seeds, forks and challenges are yours to experiment on.",
          "The operator may remove or anonymise entries, reset a board whose scores a bug produced, block a player id or an address range, and refuse submissions. When a whole board is affected the reason is stated where that board is shown. The autoplayer's par is a target line, never a competitor.",
        ],
      },
      {
        title: 'Moderation',
        items: [
          `A name reported by ${DEFAULT_REPORT_POLICY.reporters} established players, or confirmed by a moderator, is shown as "${HIDDEN_LABEL}" on every board until it is reviewed; a moderator may rename a player or a group, clear a report or confirm a hide. Moderation never touches scores, and a report is never a ban. Appeals about a name: ${APPEAL_CONTACT}, with your tag.`,
          `Posts pass an automatic filter and an AI classifier and may be reviewed by people, including trusted players the operator appoints. A post may be hidden or removed, and a player muted or banned from writing, under the community guidelines. Each decision carries a reason and can be appealed from your inbox, once, within ${APPEAL_DAYS} days. A person reviews what is flagged, with a target of ${REVIEW_SLA_HOURS} hours and no guarantee.`,
        ],
      },
      {
        title: 'Your content',
        items: [
          "Display names, group names, the anonymous label, posts and appeals are the text you can enter. What you write stays yours. You allow the operator to show it on the boards, in the archive, in share cards other players make, in threads and in Discord announcements, and to filter, hide, remove or change it under the guidelines. The replays you submit may be shown to other players under the fairness policy's reveal rules and are kept as its retention rules describe.",
        ],
      },
      {
        title: 'Availability and liability',
        items: [
          `This is an independent project. The service is provided as is, with no promise of uptime, of keeping boards or scores, or of continuing. It may change or stop. After a failure the boards may be rebuilt from a backup up to ${O.backupKeepDays} days old.`,
          'To the extent the law allows, the operator is not liable for lost scores, lost time or indirect damage. Nothing here limits a liability that cannot be limited by law, and nothing here removes protections you have as a consumer where you live.',
        ],
      },
      {
        title: 'The software',
        items: [
          `The game's source is published at ${O.repository} under the licence in its LICENSE file: read it, run it, change it for yourself, contribute back. The name "${O.product}", the art and the sounds are reserved, and no public instance may be run under the name. The desktop installer is unsigned and is distributed only through the repository's releases.`,
        ],
      },
      {
        title: 'Law and changes',
        items: [
          `These terms are governed by the law of ${O.jurisdiction}, without affecting mandatory protections where you live. They were last changed on ${O.legalUpdated}; changes are listed in the repository's changelog. If one clause turns out invalid, the rest stands.`,
        ],
      },
    ],
  };
  const guidelines: LegalDoc = {
    id: 'guidelines',
    title: 'Community guidelines (v1)',
    summary:
      'The short version: be someone the other players want on the same board. These guidelines govern names, posts, play on the ranked boards, sharing, groups and reports.',
    sections: [
      {
        title: 'Names',
        items: [
          `Pick a handle, not a real name, yours or anyone else's. No slurs, no sexual content, no harassment aimed at a person or a group, no impersonation of other players, of the game's staff or of a brand. Look-alike characters are folded before the blocklist is checked, so a disguised word is still the word. Group names follow the same rule. ${NAME_MAX} characters at most.`,
        ],
      },
      {
        title: 'Writing',
        items: [
          `Writing needs a signed-in email, so that a ban means something, and a post is at most ${POST_MAX} characters of plain text. Talk about the game: scores, yards, layouts, how the shift went. Boasting and teasing about a score are part of it. Aim them at the score, never at the person.`,
          'Not allowed: insults or contempt aimed at a person; attacks on people for their race, ethnicity, nationality, religion, sex, gender identity, sexual orientation, disability or age; anything sexual; threats or wishing real harm on anyone; encouraging anyone to hurt themselves; advertising, selling or inviting people elsewhere; claiming to be staff, a moderator or someone else; organising cheating.',
          "Keep private things private: yours and everyone else's. Nobody may ask another player's age, location, school, real name or photos. Links, email addresses, phone numbers and home addresses cannot be posted at all.",
          'Each post is read by an automatic filter, then by an AI classifier that sees the words and not who wrote them. It can leave a post up, put it in front of a person, or take it down until a person has looked. If the classifier cannot answer, the post stays up and a person reads it. While the queue goes unwatched for two days, the bar for taking a post down drops.',
          'If a post says someone is in danger, report it, and a person will read it. If you are the one struggling, please talk to someone you trust or a local helpline. A game is not the right place to carry that alone.',
        ],
      },
      {
        title: 'Play',
        items: [
          'Ranked boards are for runs you played yourself, in the game. Do not automate the daily or the weekly, do not feed replays from a solver, do not hold several places with several keys. Practice seeds, forks and challenges are the place to experiment. The par line is a bot: a target, not a person to outrank.',
        ],
      },
      {
        title: 'Found an exploit?',
        items: [
          `A trick the simulation allows is a rule: use it, and tell us if it looks unintended. A way to make the verifier accept something the simulation would not is a bug: do not use it on a ranked board; report it to ${O.contactEmail} and get credit in the changelog.`,
        ],
      },
      {
        title: 'Sharing',
        items: [
          'Share cards, challenge links and clips exist to be shared. On an open daily share your result, not your layout: the reveal rules hide replays until the day closes so that nobody copies a line, and posting a layout defeats them.',
        ],
      },
      {
        title: 'Groups',
        items: [
          "A group code is an invitation: anyone who has it can join and see the group's boards, so post it where you want everyone reading to join. The creator may rename or disband a group; leaving is always possible.",
        ],
      },
      {
        title: 'Friends',
        items: [
          'Add people you know or like playing against. If someone is bothering you, block them: you stop seeing each other in the talk and the feed, and they are not told. Asking the same person over and over after they have left a request unanswered is harassment.',
        ],
      },
      {
        title: 'Reporting',
        items: [
          `Report a name from any board or replay, or a post from its thread, with one of the fixed reasons. Reports are counted, not read as text: ${DEFAULT_REPORT_POLICY.reporters} established players agreeing hide a name or a post until a moderator looks, and one trusted moderator can hide a post at once. Do not report scores you dislike, and do not organise mass reports: that is itself a breach.`,
        ],
      },
      {
        title: 'Consequences and appeals',
        items: [
          `In order of weight: a hidden name or post, a forced rename, a removed post, a mute of 24 hours, a mute of 7 days, removal of entries, a ban from writing, a block. A ban stays on your email address, not only on your device. None of it touches your scores unless the breach is about the scores.`,
          `Each decision about a post, a mute or a ban lands in your inbox with its reason. From there you can ask a person to look again, once, within ${APPEAL_DAYS} days; whoever answers can undo it, and you hear the answer in your inbox. A person reviews what is flagged with a target of ${REVIEW_SLA_HOURS} hours. Appeals about a name go to ${APPEAL_CONTACT} with your tag.`,
        ],
      },
      {
        title: 'Discord and other places',
        items: [
          "If the operator runs a Discord server or another community space, these guidelines apply there as well, together with that platform's own rules.",
        ],
      },
    ],
  };
  return {
    schema: 1,
    updated: O.legalUpdated,
    rulesVersion: RULES_VERSION,
    protocol: PROTOCOL,
    operator: {
      product: O.product,
      domain: O.domain,
      siteUrl: O.siteUrl,
      repository: O.repository,
      holder: O.holder,
      contactEmail: O.contactEmail,
      appealEmail: O.appealEmail,
    },
    docs: [privacy, terms, guidelines],
  };
}

export const legalJson = (l: Legal): string => `${JSON.stringify(l, null, 2)}\n`;

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** One standalone page per document: no scripts (the site's CSP allows none but the bundle), inline style only, links to the other two and back to the game. */
export function renderLegalHtml(doc: LegalDoc, legal: Legal): string {
  const nav = legal.docs.map((d) => (d.id === doc.id ? `<strong>${esc(d.title)}</strong>` : `<a href="./${d.id}.html">${esc(d.title)}</a>`)).join(' · ');
  const sections = doc.sections
    .map((s) => `    <section>\n      <h2>${esc(s.title)}</h2>\n${s.items.map((p) => `      <p>${esc(p)}</p>`).join('\n')}\n    </section>`)
    .join('\n');
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${esc(doc.title)} · ${esc(legal.operator.product)}</title>
  <meta name="description" content="${esc(doc.summary)}" />
  <style>
    :root { color-scheme: dark; }
    html, body { margin: 0; background: #1a1612; color: #e8dcc8; font: 16px/1.5 system-ui, "Segoe UI", Roboto, sans-serif; }
    main { max-width: 42em; margin: 0 auto; padding: 1.5em 1.25em 3em; }
    h1 { color: #f0b429; letter-spacing: 0.08em; font-size: 1.6em; margin: 0.4em 0 0.2em; }
    h2 { color: #f0b429; font-size: 0.95em; letter-spacing: 0.15em; text-transform: uppercase; margin: 1.8em 0 0.4em; }
    p { margin: 0.5em 0; }
    nav, footer { color: #a39a86; font-size: 0.85em; }
    nav a, footer a, p a { color: #e8dcc8; }
    .summary { border-left: 3px solid #f0b429; padding-left: 0.9em; color: #d9cdb6; margin: 1em 0 0; }
    .meta { color: #a39a86; font-size: 0.85em; margin-top: 0; }
  </style>
</head>
<body>
  <main>
    <nav><a href="../">← ${esc(legal.operator.product)}</a> · ${nav}</nav>
    <h1>${esc(doc.title)}</h1>
    <p class="meta">${esc(legal.operator.product)} · last changed ${esc(legal.updated)} · rules version ${legal.rulesVersion}, verifier protocol ${legal.protocol}</p>
    <p class="summary">${esc(doc.summary)}</p>
${sections}
    <footer>
      <p>Contact: <a href="mailto:${esc(legal.operator.contactEmail)}">${esc(legal.operator.contactEmail)}</a> · moderation appeals: <a href="mailto:${esc(legal.operator.appealEmail)}">${esc(legal.operator.appealEmail)}</a> · source: <a href="${esc(legal.operator.repository)}">${esc(legal.operator.repository)}</a></p>
      <p>Generated from tools/legal-lib.ts by tools/make-policy.ts; the fairness policy next to this page (policy.json in the game) is generated from the code the same way.</p>
    </footer>
  </main>
</body>
</html>
`;
}
