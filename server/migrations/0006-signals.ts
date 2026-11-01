// What a person may want to look at about a game on a day or a week (production roadmap 0.12.5): when it arrived, how many tries that player had on
// that yard, and whether someone else already holds the same game. Nothing acts on these; they age out after ninety days.
export const up = `
CREATE TABLE signals (
  id INTEGER PRIMARY KEY,
  player_id TEXT NOT NULL,
  seed TEXT NOT NULL,
  replay_hash TEXT NOT NULL,
  score INTEGER NOT NULL,
  since_open_ms INTEGER,
  tries INTEGER NOT NULL,
  collision_id TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX signals_player ON signals (player_id, seed);
CREATE INDEX signals_age ON signals (created_at);
`;

export const down = `
DROP TABLE signals;
`;
