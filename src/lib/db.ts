import { mkdir, readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import pg from "pg";

const databaseUrl = process.env.DATABASE_URL?.trim() ?? "";

type GlobalDb = {
  __spinPool?: pg.Pool;
  __spinPglite?: Promise<PGlite>;
  __spinSeeded?: boolean;
};

const g = globalThis as unknown as GlobalDb;

export async function sql<T = Record<string, unknown>>(
  text: string,
  params: unknown[] = [],
): Promise<T[]> {
  if (databaseUrl !== "") {
    g.__spinPool ??= new pg.Pool({ connectionString: databaseUrl, max: 5 });
    return (await g.__spinPool.query(text, params)).rows as T[];
  }
  g.__spinPglite ??= startLocal().catch((error: unknown) => {
    g.__spinPglite = undefined;
    throw error;
  });
  const db = await g.__spinPglite;
  if (!g.__spinSeeded) {
    await seedIfEmpty(db);
    g.__spinSeeded = true;
  }
  return (await db.query<T>(text, params)).rows;
}

export async function sqlOne<T = Record<string, unknown>>(
  text: string,
  params: unknown[] = [],
): Promise<T | null> {
  const rows = await sql<T>(text, params);
  return rows[0] ?? null;
}

async function startLocal(): Promise<PGlite> {
  // Persist under ./data so Next.js HMR / multi-instance reloads keep rows.
  const dataDir = path.join(process.cwd(), "data", "pglite");
  await mkdir(dataDir, { recursive: true });
  const db = new PGlite(dataDir);
  const migrationsDir = path.join(process.cwd(), "migrations");
  const files = (await readdir(migrationsDir).catch(() => []))
    .filter((f) => f.endsWith(".sql"))
    .sort();
  for (const file of files) {
    await db.exec(await readFile(path.join(migrationsDir, file), "utf8"));
  }
  return db;
}

async function seedIfEmpty(db: PGlite): Promise<void> {
  const plans = await db.query<{ count: number }>(
    "select count(*)::int as count from plans",
  );
  if ((plans.rows[0]?.count ?? 0) > 0) return;

  const { hashSync } = await import("bcryptjs");
  const adminHash = hashSync(
    process.env.SEED_ADMIN_PASSWORD || "admin123!",
    10,
  );

  await db.exec(`
    INSERT INTO plans (id, name, price, max_domains, interval_days, check_interval_minutes) VALUES
      ('plan_free', 'Free / Trial', 0, 1, 14, 60),
      ('plan_standard_monthly', 'Standard Monthly', 299, 5, 30, 15),
      ('plan_standard_yearly', 'Standard Yearly', 2990, 5, 365, 15),
      ('plan_pro_monthly', 'Pro Monthly', 599, 10, 30, 15)
    ON CONFLICT (id) DO NOTHING;
  `);

  await db.query(
    `INSERT INTO users (id, email, password, role, subscription_status, plan_id, plan_expire_at)
     VALUES ($1, $2, $3, 'ADMIN', 'ACTIVE', 'plan_pro_monthly', NOW() + INTERVAL '365 days')
     ON CONFLICT (email) DO NOTHING`,
    ["user_admin", process.env.SEED_ADMIN_EMAIL || "admin@spinlytics.local", adminHash],
  );
}

export function newId(prefix: string): string {
  return `${prefix}_${crypto.randomUUID().replace(/-/g, "")}`;
}
