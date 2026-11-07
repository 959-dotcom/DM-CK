import { sql, sqlOne } from "./db";

export async function getMeta(key: string): Promise<string | null> {
  const row = await sqlOne<{ value: string }>(
    `SELECT value FROM system_meta WHERE key = $1`,
    [key],
  );
  return row?.value ?? null;
}

export async function setMeta(key: string, value: string): Promise<void> {
  await sql(
    `INSERT INTO system_meta (key, value, updated_at)
     VALUES ($1, $2, NOW())
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
    [key, value],
  );
}

export async function touchWorkerLastRun(extra?: Record<string, unknown>) {
  const payload = JSON.stringify({
    at: new Date().toISOString(),
    ...extra,
  });
  await setMeta("worker_last_run", payload);
}
