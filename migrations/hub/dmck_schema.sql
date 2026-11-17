-- DM-CK schema on the Hub Supabase project aozoakeghslgnhdegdyr.
-- Paste this file once in the Hub SQL editor:
-- https://supabase.com/dashboard/project/aozoakeghslgnhdegdyr/sql/new
--
-- Creates schema dmck and the DM-CK tables only.
-- Does not alter public hub tables.
-- Does not insert users and does not create Supabase Auth users.
-- Does not drop or pause the previous DM-CK database.
-- Safe to paste again: objects use IF NOT EXISTS, and plan rows upsert.
-- Do not add schema dmck to the Data API exposed schemas. DM-CK connects
-- with DATABASE_URL as the postgres role and sets search_path to dmck.

CREATE SCHEMA IF NOT EXISTS dmck;

COMMENT ON SCHEMA dmck IS 'DM-CK domain checker. Separate from hub tables in public.';

CREATE TABLE IF NOT EXISTS dmck.plans (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  code TEXT,
  price NUMERIC(12, 2) NOT NULL DEFAULT 0,
  price_monthly NUMERIC(12, 2),
  price_yearly NUMERIC(12, 2),
  max_domains INTEGER NOT NULL DEFAULT 1,
  interval_days INTEGER NOT NULL DEFAULT 30,
  check_interval_minutes INTEGER NOT NULL DEFAULT 60,
  history_days INTEGER NOT NULL DEFAULT 7,
  max_telegram_groups INTEGER NOT NULL DEFAULT 1,
  badge TEXT,
  sort_order INTEGER NOT NULL DEFAULT 100,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS dmck.users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  password TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'USER' CHECK (role IN ('USER', 'ADMIN')),
  telegram_chat_id TEXT,
  telegram_chat_ids TEXT,
  subscription_status TEXT NOT NULL DEFAULT 'FREE' CHECK (subscription_status IN ('FREE', 'TRIAL', 'ACTIVE', 'EXPIRED')),
  plan_id TEXT REFERENCES dmck.plans (id),
  plan_expire_at TIMESTAMPTZ,
  billing_cycle TEXT CHECK (billing_cycle IS NULL OR billing_cycle IN ('MONTHLY', 'YEARLY')),
  extra_domain_slots INTEGER NOT NULL DEFAULT 0,
  disabled BOOLEAN NOT NULL DEFAULT FALSE,
  failed_login_count INTEGER NOT NULL DEFAULT 0,
  locked_until TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS dmck.transactions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES dmck.users (id) ON DELETE CASCADE,
  plan_id TEXT NOT NULL REFERENCES dmck.plans (id),
  amount NUMERIC(12, 2) NOT NULL,
  billing_cycle TEXT CHECK (billing_cycle IS NULL OR billing_cycle IN ('MONTHLY', 'YEARLY')),
  slip_url TEXT,
  payment_status TEXT NOT NULL DEFAULT 'PENDING' CHECK (payment_status IN ('PENDING', 'APPROVED', 'REJECTED')),
  qr_ref TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS dmck.addon_purchases (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES dmck.users (id) ON DELETE CASCADE,
  slots INTEGER NOT NULL CHECK (slots > 0),
  amount NUMERIC(12, 2) NOT NULL,
  slip_url TEXT,
  payment_status TEXT NOT NULL DEFAULT 'PENDING' CHECK (payment_status IN ('PENDING', 'APPROVED', 'REJECTED')),
  qr_ref TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS dmck.domains (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES dmck.users (id) ON DELETE CASCADE,
  url TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'BLOCKED')),
  last_checked_at TIMESTAMPTZ,
  monitoring_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS dmck.domain_check_logs (
  id TEXT PRIMARY KEY,
  domain_id TEXT NOT NULL REFERENCES dmck.domains (id) ON DELETE CASCADE,
  ais_status TEXT NOT NULL DEFAULT 'UNKNOWN' CHECK (ais_status IN ('SAFE', 'BLOCKED', 'UNKNOWN', 'ERROR')),
  true_status TEXT NOT NULL DEFAULT 'UNKNOWN' CHECK (true_status IN ('SAFE', 'BLOCKED', 'UNKNOWN', 'ERROR')),
  dtac_status TEXT NOT NULL DEFAULT 'UNKNOWN' CHECK (dtac_status IN ('SAFE', 'BLOCKED', 'UNKNOWN', 'ERROR')),
  tbb_status TEXT NOT NULL DEFAULT 'UNKNOWN' CHECK (tbb_status IN ('SAFE', 'BLOCKED', 'UNKNOWN', 'ERROR')),
  nt_status TEXT NOT NULL DEFAULT 'UNKNOWN' CHECK (nt_status IN ('SAFE', 'BLOCKED', 'UNKNOWN', 'ERROR')),
  checked_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS dmck.domain_check_jobs (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES dmck.users (id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'RUNNING', 'DONE', 'FAILED')),
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

CREATE TABLE IF NOT EXISTS dmck.system_meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS dmck.login_attempts (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  ip TEXT,
  success BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_plans_code ON dmck.plans (code);
CREATE INDEX IF NOT EXISTS idx_users_email ON dmck.users (email);
CREATE INDEX IF NOT EXISTS idx_users_disabled ON dmck.users (disabled);
CREATE INDEX IF NOT EXISTS idx_transactions_user_id ON dmck.transactions (user_id);
CREATE INDEX IF NOT EXISTS idx_transactions_status ON dmck.transactions (payment_status);
CREATE INDEX IF NOT EXISTS idx_addon_purchases_user_id ON dmck.addon_purchases (user_id);
CREATE INDEX IF NOT EXISTS idx_addon_purchases_status ON dmck.addon_purchases (payment_status);
CREATE INDEX IF NOT EXISTS idx_domains_user_id ON dmck.domains (user_id);
CREATE INDEX IF NOT EXISTS idx_domains_status ON dmck.domains (status);
CREATE INDEX IF NOT EXISTS idx_domains_monitoring ON dmck.domains (monitoring_enabled) WHERE monitoring_enabled = TRUE;
CREATE INDEX IF NOT EXISTS idx_domain_check_logs_domain_id ON dmck.domain_check_logs (domain_id);
CREATE INDEX IF NOT EXISTS idx_domain_check_jobs_user ON dmck.domain_check_jobs (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_domain_check_jobs_status ON dmck.domain_check_jobs (status) WHERE status IN ('PENDING', 'RUNNING');
CREATE INDEX IF NOT EXISTS idx_login_attempts_email_created ON dmck.login_attempts (email, created_at DESC);

-- Catalog rows only. No accounts.
INSERT INTO dmck.plans (
  id, name, code, price, price_monthly, price_yearly,
  max_domains, interval_days, check_interval_minutes,
  history_days, max_telegram_groups, badge, sort_order, is_active
) VALUES
  ('plan_free', 'Free / Trial', 'free', 0, 0, 0, 1, 14, 60, 7, 1, NULL, 0, TRUE),
  ('plan_starter', 'Starter', 'starter', 99, 99, 990, 2, 30, 30, 7, 1, NULL, 10, TRUE),
  ('plan_standard', 'Standard', 'standard', 299, 299, 2990, 5, 30, 15, 30, 1, 'popular', 20, TRUE),
  ('plan_pro', 'Pro', 'pro', 599, 599, 5990, 15, 30, 5, 90, 3, NULL, 30, TRUE),
  ('plan_business', 'Business', 'business', 1290, 1290, 12900, 50, 30, 1, 365, 99, 'enterprise', 40, TRUE)
ON CONFLICT (id) DO UPDATE SET
  name = EXCLUDED.name,
  code = EXCLUDED.code,
  price = EXCLUDED.price,
  price_monthly = EXCLUDED.price_monthly,
  price_yearly = EXCLUDED.price_yearly,
  max_domains = EXCLUDED.max_domains,
  interval_days = EXCLUDED.interval_days,
  check_interval_minutes = EXCLUDED.check_interval_minutes,
  history_days = EXCLUDED.history_days,
  max_telegram_groups = EXCLUDED.max_telegram_groups,
  badge = EXCLUDED.badge,
  sort_order = EXCLUDED.sort_order,
  is_active = EXCLUDED.is_active;

INSERT INTO dmck.system_meta (key, value)
VALUES ('worker_last_run', '')
ON CONFLICT (key) DO NOTHING;

ALTER TABLE dmck.plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE dmck.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE dmck.transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE dmck.addon_purchases ENABLE ROW LEVEL SECURITY;
ALTER TABLE dmck.domains ENABLE ROW LEVEL SECURITY;
ALTER TABLE dmck.domain_check_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE dmck.domain_check_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE dmck.system_meta ENABLE ROW LEVEL SECURITY;
ALTER TABLE dmck.login_attempts ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON SCHEMA dmck FROM PUBLIC;
REVOKE ALL ON ALL TABLES IN SCHEMA dmck FROM PUBLIC;

-- Data API roles get no privileges. The postgres role used by DATABASE_URL
-- owns these tables and bypasses row level security. No policies are created.
DO $$
DECLARE
  role_name text;
BEGIN
  FOREACH role_name IN ARRAY ARRAY['anon', 'authenticated', 'service_role']
  LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = role_name) THEN
      EXECUTE format('REVOKE ALL ON SCHEMA dmck FROM %I', role_name);
      EXECUTE format('REVOKE ALL ON ALL TABLES IN SCHEMA dmck FROM %I', role_name);
    END IF;
  END LOOP;

  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'postgres') THEN
    GRANT USAGE ON SCHEMA dmck TO postgres;
    GRANT ALL ON ALL TABLES IN SCHEMA dmck TO postgres;
  END IF;
END $$;
