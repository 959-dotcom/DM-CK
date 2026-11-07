/**
 * Lightweight in-memory rate limiter (per instance).
 * Suitable for Hobby / single-region; Redis optional later via RATE_LIMIT_REDIS.
 */

type Bucket = { count: number; resetAt: number };

const buckets = new Map<string, Bucket>();

export type RateLimitResult = {
  ok: boolean;
  remaining: number;
  resetAt: number;
  retryAfterSec: number;
};

export function rateLimit(opts: {
  key: string;
  limit: number;
  windowMs: number;
}): RateLimitResult {
  const now = Date.now();
  const existing = buckets.get(opts.key);
  if (!existing || existing.resetAt <= now) {
    const resetAt = now + opts.windowMs;
    buckets.set(opts.key, { count: 1, resetAt });
    return {
      ok: true,
      remaining: opts.limit - 1,
      resetAt,
      retryAfterSec: 0,
    };
  }
  if (existing.count >= opts.limit) {
    return {
      ok: false,
      remaining: 0,
      resetAt: existing.resetAt,
      retryAfterSec: Math.max(1, Math.ceil((existing.resetAt - now) / 1000)),
    };
  }
  existing.count += 1;
  buckets.set(opts.key, existing);
  return {
    ok: true,
    remaining: opts.limit - existing.count,
    resetAt: existing.resetAt,
    retryAfterSec: 0,
  };
}

/** Periodically prune stale buckets (called opportunistically). */
export function pruneRateLimitBuckets() {
  const now = Date.now();
  for (const [k, v] of buckets) {
    if (v.resetAt <= now) buckets.delete(k);
  }
}

export function clientIp(req: Request): string {
  const xf = req.headers.get("x-forwarded-for");
  if (xf) return xf.split(",")[0]?.trim() || "unknown";
  const real = req.headers.get("x-real-ip");
  if (real) return real.trim();
  return "unknown";
}

/** Named presets used by routes. */
export const RATE_PRESETS = {
  auth: { limit: 20, windowMs: 15 * 60_000 },
  login: { limit: 10, windowMs: 15 * 60_000 },
  slip: { limit: 10, windowMs: 15 * 60_000 },
  payment: { limit: 20, windowMs: 15 * 60_000 },
  worker: { limit: 30, windowMs: 60_000 },
  admin: { limit: 120, windowMs: 60_000 },
  api: { limit: 180, windowMs: 60_000 },
} as const;
