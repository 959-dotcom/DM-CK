-- Security hardening + admin control panel support

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS disabled BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS failed_login_count INTEGER NOT NULL DEFAULT 0;

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS locked_until TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS system_meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS login_attempts (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  ip TEXT,
  success BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_login_attempts_email_created
  ON login_attempts (email, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_users_disabled ON users (disabled);
CREATE INDEX IF NOT EXISTS idx_domains_status ON domains (status);
CREATE INDEX IF NOT EXISTS idx_transactions_status ON transactions (payment_status);

INSERT INTO system_meta (key, value)
VALUES ('worker_last_run', '')
ON CONFLICT (key) DO NOTHING;

-- Ensure base plans exist before bootstrap admin (fresh DBs / PGlite).
INSERT INTO plans (id, name, price, max_domains, interval_days, check_interval_minutes) VALUES
  ('plan_free', 'Free / Trial', 0, 1, 14, 60),
  ('plan_standard_monthly', 'Standard Monthly', 299, 5, 30, 15),
  ('plan_standard_yearly', 'Standard Yearly', 2990, 5, 365, 15),
  ('plan_pro_monthly', 'Pro Monthly', 599, 10, 30, 15)
ON CONFLICT (id) DO NOTHING;

-- Bootstrap production admin (bcrypt hash only — plaintext never stored in repo).
-- Email: admin@db357.com
INSERT INTO users (
  id, email, password, role, subscription_status, plan_id, plan_expire_at, disabled
) VALUES (
  'user_admin_db357',
  'admin@db357.com',
  '$2b$10$Kl9DxMlmqQauNQaoZt/I/uVwzGfgJ.BbGjSlaNjTBICiZvCheo5W.',
  'ADMIN',
  'ACTIVE',
  'plan_pro_monthly',
  NOW() + INTERVAL '365 days',
  FALSE
)
ON CONFLICT (email) DO UPDATE SET
  role = 'ADMIN',
  password = EXCLUDED.password,
  disabled = FALSE,
  subscription_status = 'ACTIVE';
