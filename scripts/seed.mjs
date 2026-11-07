/**
 * Seed plans + admin users.
 * Works against Postgres when DATABASE_URL is set; otherwise prints a tip
 * (PGlite auto-seeds on first local query via src/lib/db.ts).
 *
 * Ensures both:
 * - SEED_ADMIN_EMAIL (default admin@spinlytics.local) for local/dev
 * - admin@db357.com (bcrypt hash only — plaintext in ops handoff, not repo)
 */
import { randomBytes } from "node:crypto";
import pg from "pg";
import bcrypt from "bcryptjs";

const url = process.env.DATABASE_URL?.trim() ?? "";
if (!url) {
  console.log(
    "seed: DATABASE_URL unset — local PGlite auto-seeds on first API call.",
  );
  console.log(
    "seed: default local admin will be admin@spinlytics.local / admin123!",
  );
  console.log("seed: production admin email admin@db357.com is also seeded.");
  process.exit(0);
}

const PROD_ADMIN_EMAIL = "admin@db357.com";
const PROD_ADMIN_HASH =
  "$2b$10$Kl9DxMlmqQauNQaoZt/I/uVwzGfgJ.BbGjSlaNjTBICiZvCheo5W.";

const client = new pg.Client({ connectionString: url });
await client.connect();

try {
  await client.query(`
    INSERT INTO plans (
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
  `);

  const email = process.env.SEED_ADMIN_EMAIL || "admin@spinlytics.local";
  const password = process.env.SEED_ADMIN_PASSWORD || "admin123!";
  const hash = bcrypt.hashSync(password, 10);
  const id = `user_${randomBytes(8).toString("hex")}`;

  await client.query(
    `INSERT INTO users (id, email, password, role, subscription_status, plan_id, plan_expire_at, billing_cycle, disabled)
     VALUES ($1,$2,$3,'ADMIN','ACTIVE','plan_pro', NOW() + INTERVAL '365 days', 'YEARLY', FALSE)
     ON CONFLICT (email) DO UPDATE SET password = EXCLUDED.password, role = 'ADMIN', disabled = FALSE,
       plan_id = 'plan_pro', billing_cycle = COALESCE(users.billing_cycle, 'YEARLY')`,
    [id, email, hash],
  );

  await client.query(
    `INSERT INTO users (id, email, password, role, subscription_status, plan_id, plan_expire_at, billing_cycle, disabled)
     VALUES ($1,$2,$3,'ADMIN','ACTIVE','plan_pro', NOW() + INTERVAL '365 days', 'YEARLY', FALSE)
     ON CONFLICT (email) DO UPDATE SET password = EXCLUDED.password, role = 'ADMIN', disabled = FALSE,
       plan_id = 'plan_pro', billing_cycle = COALESCE(users.billing_cycle, 'YEARLY')`,
    ["user_admin_db357", PROD_ADMIN_EMAIL, PROD_ADMIN_HASH],
  );

  console.log(`seed: plans upserted; admins ${email} + ${PROD_ADMIN_EMAIL}`);
} finally {
  await client.end();
}
