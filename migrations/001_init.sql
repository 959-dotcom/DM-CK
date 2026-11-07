-- Spinlytics Domain Checker initial schema

CREATE TABLE IF NOT EXISTS plans (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  price NUMERIC(12, 2) NOT NULL DEFAULT 0,
  max_domains INTEGER NOT NULL DEFAULT 1,
  interval_days INTEGER NOT NULL DEFAULT 30,
  check_interval_minutes INTEGER NOT NULL DEFAULT 60,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  password TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'USER' CHECK (role IN ('USER', 'ADMIN')),
  telegram_chat_id TEXT,
  subscription_status TEXT NOT NULL DEFAULT 'FREE' CHECK (subscription_status IN ('FREE', 'TRIAL', 'ACTIVE', 'EXPIRED')),
  plan_id TEXT REFERENCES plans(id),
  plan_expire_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS transactions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  plan_id TEXT NOT NULL REFERENCES plans(id),
  amount NUMERIC(12, 2) NOT NULL,
  slip_url TEXT,
  payment_status TEXT NOT NULL DEFAULT 'PENDING' CHECK (payment_status IN ('PENDING', 'APPROVED', 'REJECTED')),
  qr_ref TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS domains (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  url TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'BLOCKED')),
  last_checked_at TIMESTAMPTZ,
  monitoring_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS domain_check_logs (
  id TEXT PRIMARY KEY,
  domain_id TEXT NOT NULL REFERENCES domains(id) ON DELETE CASCADE,
  ais_status TEXT NOT NULL DEFAULT 'UNKNOWN' CHECK (ais_status IN ('SAFE', 'BLOCKED', 'UNKNOWN', 'ERROR')),
  true_status TEXT NOT NULL DEFAULT 'UNKNOWN' CHECK (true_status IN ('SAFE', 'BLOCKED', 'UNKNOWN', 'ERROR')),
  dtac_status TEXT NOT NULL DEFAULT 'UNKNOWN' CHECK (dtac_status IN ('SAFE', 'BLOCKED', 'UNKNOWN', 'ERROR')),
  tbb_status TEXT NOT NULL DEFAULT 'UNKNOWN' CHECK (tbb_status IN ('SAFE', 'BLOCKED', 'UNKNOWN', 'ERROR')),
  nt_status TEXT NOT NULL DEFAULT 'UNKNOWN' CHECK (nt_status IN ('SAFE', 'BLOCKED', 'UNKNOWN', 'ERROR')),
  checked_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_domains_user_id ON domains(user_id);
CREATE INDEX IF NOT EXISTS idx_domains_monitoring ON domains(monitoring_enabled) WHERE monitoring_enabled = TRUE;
CREATE INDEX IF NOT EXISTS idx_transactions_user_id ON transactions(user_id);
CREATE INDEX IF NOT EXISTS idx_domain_check_logs_domain_id ON domain_check_logs(domain_id);
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
