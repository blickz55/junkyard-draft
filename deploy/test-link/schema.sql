-- The private test link's database (deploy/test-link/worker.ts). Applied once with wrangler d1 execute; see deploy/README.md.
CREATE TABLE IF NOT EXISTS events (
  install TEXT NOT NULL,
  id TEXT,
  name TEXT NOT NULL,
  props TEXT NOT NULL,
  at TEXT NOT NULL,
  received TEXT NOT NULL,
  UNIQUE (install, id)
);
CREATE INDEX IF NOT EXISTS events_by_install ON events (install, at);
CREATE TABLE IF NOT EXISTS feedback (
  code TEXT PRIMARY KEY,
  install TEXT UNIQUE,
  tester TEXT,
  answers TEXT NOT NULL,
  received TEXT NOT NULL
);
