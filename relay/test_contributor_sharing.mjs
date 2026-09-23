import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const relayDirectory = path.dirname(fileURLToPath(import.meta.url));
const worker = fs.readFileSync(path.join(relayDirectory, "worker.js"), "utf8");
const migration = fs.readFileSync(path.join(relayDirectory, "..", "migrations", "0001_contributor_gemini_keys.sql"), "utf8");
const quotaMigration = fs.readFileSync(path.join(relayDirectory, "..", "migrations", "0002_contributor_quota_reservations.sql"), "utf8");

assert.match(worker, /AES-GCM/);
assert.match(worker, /GEMINI_KEY_ENCRYPTION_SECRET/);
assert.match(worker, /\/keys\/register/);
assert.match(worker, /\/keys\/revoke/);
assert.match(worker, /\/keys\/delete/);
assert.match(worker, /\/keys\/activity/);
assert.match(worker, /CONTRIBUTOR_LEASE_MS = 20 \* 60 \* 1000/);
assert.match(worker, /last_activity_at < \?/);
assert.match(worker, /X-AMAES-Owner-Token/);
assert.doesNotMatch(worker, /payload\.ownerToken/);
assert.match(worker, /in_flight_count = in_flight_count \+ 1/);
assert.match(worker, /releaseContributorReservation/);
assert.match(worker, /CONTRIBUTOR_OWNER_DAILY_LIMIT = 100/);
assert.match(worker, /CONTRIBUTOR_KEY_DAILY_LIMIT = 20/);
assert.match(worker, /COMMUNITY_KEY_DAILY_LIMIT = 10/);
assert.match(worker, /lease_until < \?/);
assert.match(migration, /encrypted_key TEXT NOT NULL/);
assert.match(migration, /owner_hash TEXT NOT NULL/);
assert.match(migration, /CREATE TABLE IF NOT EXISTS contributor_owner_usage/);
assert.match(quotaMigration, /ADD COLUMN in_flight_count/);
assert.match(quotaMigration, /ADD COLUMN daily_community_count/);
assert.match(quotaMigration, /ADD COLUMN daily_count/);
assert.doesNotMatch(worker, /console\.log/);

console.log("Contributor sharing invariants passed");
