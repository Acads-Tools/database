ALTER TABLE contributor_gemini_keys ADD COLUMN daily_window_started_at TEXT NOT NULL DEFAULT '';
ALTER TABLE contributor_gemini_keys ADD COLUMN daily_community_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE contributor_gemini_keys ADD COLUMN in_flight_count INTEGER NOT NULL DEFAULT 0;

ALTER TABLE contributor_owner_usage ADD COLUMN daily_window_started_at TEXT NOT NULL DEFAULT '';
ALTER TABLE contributor_owner_usage ADD COLUMN daily_count INTEGER NOT NULL DEFAULT 0;
