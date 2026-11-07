import { newId, sql, sqlOne } from "@/lib/db";

const MAX_FAILURES = Number(process.env.LOGIN_MAX_FAILURES || 5);
const BASE_LOCK_SEC = Number(process.env.LOGIN_LOCK_BASE_SEC || 30);
const MAX_LOCK_SEC = Number(process.env.LOGIN_LOCK_MAX_SEC || 15 * 60);

export type LockoutState = {
  locked: boolean;
  failed_login_count: number;
  locked_until: string | null;
  delayMs: number;
  retryAfterSec: number;
};

export async function getLockout(email: string): Promise<LockoutState> {
  const row = await sqlOne<{
    failed_login_count: number;
    locked_until: string | null;
  }>(
    `SELECT failed_login_count, locked_until::text
     FROM users WHERE email = $1`,
    [email.toLowerCase()],
  );

  if (!row) {
    return {
      locked: false,
      failed_login_count: 0,
      locked_until: null,
      delayMs: 0,
      retryAfterSec: 0,
    };
  }

  const until = row.locked_until ? new Date(row.locked_until).getTime() : 0;
  const now = Date.now();
  if (until > now) {
    return {
      locked: true,
      failed_login_count: row.failed_login_count,
      locked_until: row.locked_until,
      delayMs: until - now,
      retryAfterSec: Math.ceil((until - now) / 1000),
    };
  }

  // Progressive delay even when not fully locked (after 2+ failures).
  const delayMs =
    row.failed_login_count >= 2
      ? Math.min(
          MAX_LOCK_SEC * 1000,
          BASE_LOCK_SEC * 1000 * 2 ** Math.min(row.failed_login_count - 1, 6),
        )
      : 0;

  return {
    locked: false,
    failed_login_count: row.failed_login_count,
    locked_until: row.locked_until,
    delayMs,
    retryAfterSec: Math.ceil(delayMs / 1000),
  };
}

export async function recordLoginAttempt(opts: {
  email: string;
  ip?: string | null;
  success: boolean;
}) {
  const email = opts.email.toLowerCase();
  await sql(
    `INSERT INTO login_attempts (id, email, ip, success)
     VALUES ($1, $2, $3, $4)`,
    [newId("la"), email, opts.ip || null, opts.success],
  );

  if (opts.success) {
    await sql(
      `UPDATE users
       SET failed_login_count = 0, locked_until = NULL
       WHERE email = $1`,
      [email],
    );
    return;
  }

  const row = await sqlOne<{ failed_login_count: number }>(
    `UPDATE users
     SET failed_login_count = failed_login_count + 1
     WHERE email = $1
     RETURNING failed_login_count`,
    [email],
  );
  if (!row) return;

  if (row.failed_login_count >= MAX_FAILURES) {
    const lockSec = Math.min(
      MAX_LOCK_SEC,
      BASE_LOCK_SEC * 2 ** Math.min(row.failed_login_count - MAX_FAILURES, 6),
    );
    await sql(
      `UPDATE users SET locked_until = NOW() + ($1::text || ' seconds')::interval WHERE email = $2`,
      [String(lockSec), email],
    );
  }
}

export async function sleep(ms: number) {
  if (ms <= 0) return;
  await new Promise((r) => setTimeout(r, Math.min(ms, MAX_LOCK_SEC * 1000)));
}
