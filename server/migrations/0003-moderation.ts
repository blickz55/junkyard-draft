// The moderation pipeline (production roadmap 0.11.2). A post waits as `hidden` with no triaged_at until the classifier has
// answered; reason_code is the word its author sees, reviewed_at says a person has looked. A decision names the player it is about,
// so they can appeal it. An address stays banned after its player is gone.
export const up = `
ALTER TABLE posts ADD COLUMN triaged_at INTEGER;
ALTER TABLE posts ADD COLUMN reason_code TEXT;
ALTER TABLE posts ADD COLUMN reviewed_at INTEGER;
CREATE INDEX posts_queue ON posts (state, reviewed_at, id);
CREATE INDEX posts_thread ON posts (thread_id, id);

ALTER TABLE reports ADD COLUMN established INTEGER NOT NULL DEFAULT 0;

ALTER TABLE moderation_actions ADD COLUMN player_id TEXT;
ALTER TABLE moderation_actions ADD COLUMN reason_code TEXT;
ALTER TABLE moderation_actions ADD COLUMN answered_at INTEGER;
CREATE INDEX moderation_actions_player ON moderation_actions (player_id, id);
CREATE INDEX moderation_actions_appeals ON moderation_actions (appealed_at, answered_at);
CREATE INDEX moderation_actions_time ON moderation_actions (created_at);

CREATE TABLE banned_emails (
  email_hash TEXT PRIMARY KEY,
  created_at INTEGER NOT NULL
);

CREATE TABLE moderation_settings (
  key TEXT PRIMARY KEY,
  value INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE triage_usage (
  day TEXT PRIMARY KEY,
  calls INTEGER NOT NULL DEFAULT 0,
  failures INTEGER NOT NULL DEFAULT 0,
  input_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0
);
`;

export const down = `
DROP TABLE triage_usage;
DROP TABLE moderation_settings;
DROP TABLE banned_emails;
DROP INDEX moderation_actions_time;
DROP INDEX moderation_actions_appeals;
DROP INDEX moderation_actions_player;
ALTER TABLE moderation_actions DROP COLUMN answered_at;
ALTER TABLE moderation_actions DROP COLUMN reason_code;
ALTER TABLE moderation_actions DROP COLUMN player_id;
ALTER TABLE reports DROP COLUMN established;
DROP INDEX posts_thread;
DROP INDEX posts_queue;
ALTER TABLE posts DROP COLUMN reviewed_at;
ALTER TABLE posts DROP COLUMN reason_code;
ALTER TABLE posts DROP COLUMN triaged_at;
`;
