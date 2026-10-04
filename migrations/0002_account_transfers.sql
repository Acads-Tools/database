CREATE TABLE IF NOT EXISTS account_transfers (
  lookup_hash TEXT PRIMARY KEY,
  iv TEXT NOT NULL,
  ciphertext TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS account_transfer_requests (
  installation_hash TEXT NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('create', 'consume')),
  requested_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_account_transfer_requests_rate
  ON account_transfer_requests(installation_hash, action, requested_at);

CREATE INDEX IF NOT EXISTS idx_account_transfer_requests_expiry
  ON account_transfer_requests(requested_at);
