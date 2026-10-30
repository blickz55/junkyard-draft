/**
 * Who runs Junkyard Draft (production roadmap 0.8.6, legal minimum). One place for the facts the privacy notice, the
 * terms, the licence, the verifier's appeal contact and the in-game "Privacy & data" panel all repeat, so they can never
 * disagree. Shared by the game bundle and the verifier (the verifier already imports from game/src/identity).
 *
 * ⚑ The owner fills the two flagged fields before hosting: `holder` is the copyright holder and data controller as a
 * legal name (a first name is not one), `jurisdiction` is where that person lives. Both are shown to players.
 */
export const OPERATOR = {
  /** the product name; also the reserved name in LICENSE */
  product: 'Junkyard Draft',
  /** the apex domain the game is served from (deploy/README.md §1); the verifier answers on verify.<domain> */
  domain: 'junkyarddraft.com',
  siteUrl: 'https://junkyarddraft.com',
  /** the public source repository */
  repository: 'https://github.com/blickz55/junkyard-draft',
  /** copyright holder and data controller ⚑ (legal name before hosting) */
  holder: 'Jon (GitHub: blickz55)',
  /** where the holder lives: governing law and the controller's location in the privacy notice ⚑ */
  jurisdiction: 'the United States',
  /** general contact: privacy requests, legal notices, security reports; a mailbox on the domain (deploy/README.md §1 sets up forwarding) */
  contactEmail: 'contact@junkyarddraft.com',
  /** where a player appeals a moderation decision (PLAN-v4 0.7.7; the verifier's policy page prints it) */
  appealEmail: 'moderation@junkyarddraft.com',
  /** the processors the privacy notice lists as recipients */
  hosting: { verifier: 'Hetzner Online GmbH (virtual server in the European Union)', site: 'Cloudflare, Inc. (Pages hosting, DNS and e-mail forwarding for the domain)', source: 'GitHub, Inc. (source code, releases, the desktop installer)', certificates: "Let's Encrypt (TLS certificates for the verifier's host name)", chat: 'Discord Inc. (only when the operator connects a channel: open and close announcements and new #1 scores, the same facts the public board shows)' },
  /** how many nightly backup archives the VPS keeps (deploy/backup.cron --keep): the longest a deleted record can survive in a backup */
  backupKeepDays: 14,
  /** the proxy's and the verifier's logs: json-file rotation, files × size (deploy/docker-compose.yml) */
  logRotation: '7 files of 20 MB each',
  /** the day these texts were last changed (shown on every page; bump it when the text changes) */
  legalUpdated: '2026-10-30',
} as const;
