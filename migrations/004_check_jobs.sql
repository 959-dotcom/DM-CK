-- Check-All-Now job tracking (serverless-friendly pull progress)

CREATE TABLE IF NOT EXISTS domain_check_jobs (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'PENDING'
    CHECK (status IN ('PENDING', 'RUNNING', 'DONE', 'FAILED')),
  total INTEGER NOT NULL DEFAULT 0,
  completed INTEGER NOT NULL DEFAULT 0,
  failed INTEGER NOT NULL DEFAULT 0,
  domain_ids TEXT NOT NULL DEFAULT '[]',
  results TEXT NOT NULL DEFAULT '[]',
  current_domain_id TEXT,
  error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_domain_check_jobs_user
  ON domain_check_jobs (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_domain_check_jobs_status
  ON domain_check_jobs (status)
  WHERE status IN ('PENDING', 'RUNNING');
