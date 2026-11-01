// What a player's friends and crew see (production roadmap 0.11.8): one row per thing done, a few dozen per player at most, so the
// feed's read stays bounded however long a player has been around. Names are read at read time, as everywhere.
export const up = `
CREATE TABLE activity (
  id INTEGER PRIMARY KEY,
  player_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  payload TEXT NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL
);
CREATE INDEX activity_player ON activity (player_id, id);
`;

export const down = `
DROP TABLE activity;
`;
