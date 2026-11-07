-- Full-option billing: tier plans (monthly/yearly), addons, multi-telegram

-- Plans: monthly + yearly pricing and feature limits
ALTER TABLE plans ADD COLUMN IF NOT EXISTS code TEXT;
ALTER TABLE plans ADD COLUMN IF NOT EXISTS price_monthly NUMERIC(12, 2);
ALTER TABLE plans ADD COLUMN IF NOT EXISTS price_yearly NUMERIC(12, 2);
ALTER TABLE plans ADD COLUMN IF NOT EXISTS history_days INTEGER NOT NULL DEFAULT 7;
ALTER TABLE plans ADD COLUMN IF NOT EXISTS max_telegram_groups INTEGER NOT NULL DEFAULT 1;
ALTER TABLE plans ADD COLUMN IF NOT EXISTS badge TEXT;
ALTER TABLE plans ADD COLUMN IF NOT EXISTS sort_order INTEGER NOT NULL DEFAULT 100;
ALTER TABLE plans ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT TRUE;

-- Backfill pricing columns from legacy `price` where missing
UPDATE plans
SET price_monthly = COALESCE(price_monthly, price),
    price_yearly = COALESCE(price_yearly, CASE WHEN price > 0 THEN price * 10 ELSE 0 END)
WHERE price_monthly IS NULL OR price_yearly IS NULL;

UPDATE plans SET code = id WHERE code IS NULL;

-- Users: billing cycle + extra domain slots + multi telegram chat IDs (JSON array)
ALTER TABLE users ADD COLUMN IF NOT EXISTS billing_cycle TEXT
  CHECK (billing_cycle IS NULL OR billing_cycle IN ('MONTHLY', 'YEARLY'));
ALTER TABLE users ADD COLUMN IF NOT EXISTS extra_domain_slots INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN IF NOT EXISTS telegram_chat_ids TEXT;

UPDATE users
SET telegram_chat_ids = CASE
  WHEN telegram_chat_id IS NOT NULL AND telegram_chat_id <> ''
    THEN '["' || replace(telegram_chat_id, '"', '') || '"]'
  ELSE '[]'
END
WHERE telegram_chat_ids IS NULL;

-- Transactions: which cycle was purchased
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS billing_cycle TEXT
  CHECK (billing_cycle IS NULL OR billing_cycle IN ('MONTHLY', 'YEARLY'));

-- Extra Domain Slot addon purchases (฿50 / domain / month)
CREATE TABLE IF NOT EXISTS addon_purchases (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  slots INTEGER NOT NULL CHECK (slots > 0),
  amount NUMERIC(12, 2) NOT NULL,
  slip_url TEXT,
  payment_status TEXT NOT NULL DEFAULT 'PENDING'
    CHECK (payment_status IN ('PENDING', 'APPROVED', 'REJECTED')),
  qr_ref TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_addon_purchases_user_id ON addon_purchases (user_id);
CREATE INDEX IF NOT EXISTS idx_addon_purchases_status ON addon_purchases (payment_status);
CREATE UNIQUE INDEX IF NOT EXISTS idx_plans_code ON plans (code);

-- Seed / upsert full-option plan tiers
INSERT INTO plans (
  id, name, code, price, price_monthly, price_yearly,
  max_domains, interval_days, check_interval_minutes,
  history_days, max_telegram_groups, badge, sort_order, is_active
) VALUES
  ('plan_free', 'Free / Trial', 'free', 0, 0, 0,
   1, 14, 60, 7, 1, NULL, 0, TRUE),
  ('plan_starter', 'Starter', 'starter', 99, 99, 990,
   2, 30, 30, 7, 1, NULL, 10, TRUE),
  ('plan_standard', 'Standard', 'standard', 299, 299, 2990,
   5, 30, 15, 30, 1, 'popular', 20, TRUE),
  ('plan_pro', 'Pro', 'pro', 599, 599, 5990,
   15, 30, 5, 90, 3, NULL, 30, TRUE),
  ('plan_business', 'Business', 'business', 1290, 1290, 12900,
   50, 30, 1, 365, 99, 'enterprise', 40, TRUE)
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

-- Migrate users off legacy plan ids onto tier plans + billing_cycle
UPDATE users SET plan_id = 'plan_standard', billing_cycle = COALESCE(billing_cycle, 'MONTHLY')
WHERE plan_id = 'plan_standard_monthly';
UPDATE users SET plan_id = 'plan_standard', billing_cycle = COALESCE(billing_cycle, 'YEARLY')
WHERE plan_id = 'plan_standard_yearly';
UPDATE users SET plan_id = 'plan_pro', billing_cycle = COALESCE(billing_cycle, 'MONTHLY')
WHERE plan_id = 'plan_pro_monthly';

-- Remap historical transactions to tier plans (preserve amount)
UPDATE transactions SET plan_id = 'plan_standard', billing_cycle = COALESCE(billing_cycle, 'MONTHLY')
WHERE plan_id = 'plan_standard_monthly';
UPDATE transactions SET plan_id = 'plan_standard', billing_cycle = COALESCE(billing_cycle, 'YEARLY')
WHERE plan_id = 'plan_standard_yearly';
UPDATE transactions SET plan_id = 'plan_pro', billing_cycle = COALESCE(billing_cycle, 'MONTHLY')
WHERE plan_id = 'plan_pro_monthly';

-- Deactivate legacy plan rows (keep for safety if any stray FKs remain)
UPDATE plans SET is_active = FALSE
WHERE id IN ('plan_standard_monthly', 'plan_standard_yearly', 'plan_pro_monthly');

-- Point bootstrap admins at Pro yearly
UPDATE users
SET plan_id = 'plan_pro',
    billing_cycle = COALESCE(billing_cycle, 'YEARLY'),
    plan_expire_at = COALESCE(plan_expire_at, NOW() + INTERVAL '365 days')
WHERE email IN ('admin@db357.com', 'admin@spinlytics.local')
  AND (plan_id IS NULL OR plan_id IN ('plan_pro_monthly', 'plan_pro', 'plan_free'));
