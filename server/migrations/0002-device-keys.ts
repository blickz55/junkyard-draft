// Devices that signed in by email (production roadmap 0.11.1). A device keeps its own secret key; this says which player its hash
// now stands for, so a second device can be the same player and the server still never holds a key.
export const up = `
CREATE TABLE device_keys (
  key_id TEXT PRIMARY KEY,
  player_id TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX device_keys_player ON device_keys (player_id);
`;

export const down = `
DROP TABLE device_keys;
`;
