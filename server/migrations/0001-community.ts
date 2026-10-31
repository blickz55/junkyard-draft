// The community tables (production roadmap 0.11.0). Times are milliseconds since the epoch; player ids are the board's.
export const up = `
CREATE TABLE accounts (
  player_id TEXT PRIMARY KEY,
  email_hash TEXT UNIQUE,
  linked_at INTEGER,
  sync_blob TEXT,
  card_private INTEGER NOT NULL DEFAULT 0,
  trusted INTEGER NOT NULL DEFAULT 0,
  muted_until INTEGER,
  banned_at INTEGER,
  created_at INTEGER NOT NULL
);

CREATE TABLE email_links (
  token_hash TEXT PRIMARY KEY,
  email_hash TEXT NOT NULL,
  player_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  used_at INTEGER
);
CREATE INDEX email_links_address ON email_links (email_hash, created_at);
CREATE INDEX email_links_player ON email_links (player_id);

CREATE TABLE threads (
  id INTEGER PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('daily', 'weekly', 'run', 'hub')),
  key TEXT NOT NULL,
  category TEXT,
  title TEXT,
  author_id TEXT,
  pinned INTEGER NOT NULL DEFAULT 0,
  locked INTEGER NOT NULL DEFAULT 0,
  post_count INTEGER NOT NULL DEFAULT 0,
  last_post_at INTEGER,
  created_at INTEGER NOT NULL,
  UNIQUE (kind, key)
);
CREATE INDEX threads_hub ON threads (kind, category, pinned, last_post_at);
CREATE INDEX threads_author ON threads (author_id);

CREATE TABLE posts (
  id INTEGER PRIMARY KEY,
  thread_id INTEGER NOT NULL REFERENCES threads (id) ON DELETE CASCADE,
  author_id TEXT,
  body TEXT NOT NULL,
  replay_hash TEXT,
  state TEXT NOT NULL DEFAULT 'published' CHECK (state IN ('published', 'queued', 'hidden', 'deleted')),
  triage_category TEXT,
  triage_score REAL,
  edited_at INTEGER,
  created_at INTEGER NOT NULL
);
CREATE INDEX posts_page ON posts (thread_id, state, id);
CREATE INDEX posts_author ON posts (author_id, id);

CREATE TABLE reactions (
  replay_hash TEXT NOT NULL,
  player_id TEXT NOT NULL,
  emote TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (replay_hash, player_id)
);
CREATE INDEX reactions_player ON reactions (player_id);

CREATE TABLE views (
  replay_hash TEXT NOT NULL,
  viewer_id TEXT NOT NULL,
  times INTEGER NOT NULL DEFAULT 1,
  first_at INTEGER NOT NULL,
  last_at INTEGER NOT NULL,
  PRIMARY KEY (replay_hash, viewer_id)
);
CREATE INDEX views_viewer ON views (viewer_id);

-- one row per direction: a friendship is two 'friend' rows, a block is one 'blocked' row from the player who blocked
CREATE TABLE friends (
  player_id TEXT NOT NULL,
  other_id TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('requested', 'friend', 'blocked')),
  created_at INTEGER NOT NULL,
  PRIMARY KEY (player_id, other_id)
);
CREATE INDEX friends_other ON friends (other_id, state);

CREATE TABLE messages (
  id INTEGER PRIMARY KEY,
  sender_id TEXT NOT NULL,
  recipient_id TEXT NOT NULL,
  body TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  read_at INTEGER,
  expires_at INTEGER NOT NULL
);
CREATE INDEX messages_conversation ON messages (sender_id, recipient_id, id);
CREATE INDEX messages_recipient ON messages (recipient_id, id);
CREATE INDEX messages_expiry ON messages (expires_at);

CREATE TABLE notifications (
  id INTEGER PRIMARY KEY,
  player_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  payload TEXT NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL,
  read_at INTEGER
);
CREATE INDEX notifications_inbox ON notifications (player_id, id);

CREATE TABLE push_subscriptions (
  endpoint TEXT PRIMARY KEY,
  player_id TEXT,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  hour_utc INTEGER NOT NULL,
  kinds TEXT NOT NULL DEFAULT '["daily"]',
  last_sent_day TEXT,
  failures INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE INDEX push_subscriptions_player ON push_subscriptions (player_id);
CREATE INDEX push_subscriptions_hour ON push_subscriptions (hour_utc);

CREATE TABLE reports (
  id INTEGER PRIMARY KEY,
  target_kind TEXT NOT NULL CHECK (target_kind IN ('post', 'message')),
  target_ref INTEGER NOT NULL,
  reporter_id TEXT NOT NULL,
  reason TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  resolved_at INTEGER,
  UNIQUE (target_kind, target_ref, reporter_id)
);
CREATE INDEX reports_open ON reports (resolved_at, created_at);
CREATE INDEX reports_reporter ON reports (reporter_id);

CREATE TABLE moderation_actions (
  id INTEGER PRIMARY KEY,
  actor TEXT NOT NULL,
  action TEXT NOT NULL,
  target_kind TEXT NOT NULL,
  target_ref TEXT NOT NULL,
  reason TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL,
  appeal_body TEXT,
  appealed_at INTEGER,
  appeal_result TEXT
);
CREATE INDEX moderation_actions_target ON moderation_actions (target_kind, target_ref);

CREATE TABLE divisions (
  id INTEGER PRIMARY KEY,
  period TEXT NOT NULL,
  division INTEGER NOT NULL,
  name TEXT NOT NULL,
  player_id TEXT,
  place INTEGER NOT NULL,
  score INTEGER NOT NULL,
  medal TEXT,
  UNIQUE (period, player_id)
);
CREATE INDEX divisions_board ON divisions (period, division, place);
CREATE INDEX divisions_player ON divisions (player_id);

CREATE TABLE trophies (
  player_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  count INTEGER NOT NULL DEFAULT 0,
  last_at INTEGER NOT NULL,
  PRIMARY KEY (player_id, kind)
);

CREATE TABLE cosmetics (
  player_id TEXT NOT NULL,
  cosmetic TEXT NOT NULL,
  equipped INTEGER NOT NULL DEFAULT 0,
  unlocked_at INTEGER NOT NULL,
  PRIMARY KEY (player_id, cosmetic)
);
`;

export const down = `
DROP TABLE cosmetics;
DROP TABLE trophies;
DROP TABLE divisions;
DROP TABLE moderation_actions;
DROP TABLE reports;
DROP TABLE push_subscriptions;
DROP TABLE notifications;
DROP TABLE messages;
DROP TABLE friends;
DROP TABLE views;
DROP TABLE reactions;
DROP TABLE posts;
DROP TABLE threads;
DROP TABLE email_links;
DROP TABLE accounts;
`;
