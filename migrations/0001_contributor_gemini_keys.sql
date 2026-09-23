CREATE TABLE IF NOT EXISTS contributor_gemini_keys (
  key_id TEXT PRIMARY KEY,
  owner_hash TEXT NOT NULL,
  encrypted_key TEXT NOT NULL,
  iv TEXT NOT NULL,
  mode TEXT NOT NULL CHECK (mode IN ('contributor', 'private', 'community')),
  consented_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  last_activity_at TEXT NOT NULL,
  lease_until TEXT NOT NULL,
  revoked_at TEXT,
  key_window_started_at TEXT NOT NULL,
  key_window_count INTEGER NOT NULL DEFAULT 0,
  owner_window_started_at TEXT NOT NULL,
  owner_window_count INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_contributor_keys_mode_active
  ON contributor_gemini_keys(mode, revoked_at, lease_until);

CREATE INDEX IF NOT EXISTS idx_contributor_keys_activity
  ON contributor_gemini_keys(last_activity_at);

CREATE TABLE IF NOT EXISTS contributor_owner_usage (
  owner_hash TEXT PRIMARY KEY,
  window_started_at TEXT NOT NULL,
  window_count INTEGER NOT NULL DEFAULT 0
);
