/**
 * Seed plans + optional admin user.
 * Works against Postgres when DATABASE_URL is set; otherwise prints a tip
 * (PGlite auto-seeds on first local query via src/lib/db.ts).
 */
import { createHash, randomBytes } from "node:crypto";
import pg from "pg";
import bcrypt from "bcryptjs";

const url = process.env.DATABASE_URL?.trim() ?? "";
if (!url) {
  console.log(
    "seed: DATABASE_URL unset — local PGlite auto-seeds on first API call.",
  );
  console.log(
    "seed: default admin will be admin@spinlytics.local / admin123!",
  );
  process.exit(0);
}

const client = new pg.Client({ connectionString: url });
await client.connect();

try {
  await client.query(`
    INSERT INTO plans (id, name, price, max_domains, interval_days, check_interval_minutes) VALUES
      ('plan_free', 'Free / Trial', 0, 1, 14, 60),
      ('plan_standard_monthly', 'Standard Monthly', 299, 5, 30, 15),
      ('plan_standard_yearly', 'Standard Yearly', 2990, 5, 365, 15),
      ('plan_pro_monthly', 'Pro Monthly', 599, 10, 30, 15)
    ON CONFLICT (id) DO UPDATE SET
      name = EXCLUDED.name,
      price = EXCLUDED.price,
      max_domains = EXCLUDED.max_domains,
      interval_days = EXCLUDED.interval_days,
      check_interval_minutes = EXCLUDED.check_interval_minutes;
  `);

  const email = process.env.SEED_ADMIN_EMAIL || "admin@spinlytics.local";
  const password = process.env.SEED_ADMIN_PASSWORD || "admin123!";
  const hash = bcrypt.hashSync(password, 10);
  const id = `user_${randomBytes(8).toString("hex")}`;

  await client.query(
    `INSERT INTO users (id, email, password, role, subscription_status, plan_id, plan_expire_at)
     VALUES ($1,$2,$3,'ADMIN','ACTIVE','plan_pro_monthly', NOW() + INTERVAL '365 days')
     ON CONFLICT (email) DO UPDATE SET password = EXCLUDED.password, role = 'ADMIN'`,
    [id, email, hash],
  );

  console.log(`seed: plans upserted; admin ${email}`);
  // touch so unused import lint stays quiet in some tooling
  void createHash;
} finally {
  await client.end();
}
