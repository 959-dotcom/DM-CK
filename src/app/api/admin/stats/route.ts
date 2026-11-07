import { NextRequest } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { sql, sqlOne } from "@/lib/db";
import { handleRouteError, jsonOk, jsonError, withRateLimitHeaders } from "@/lib/api";
import {
  clientIp,
  RATE_PRESETS,
  rateLimit,
} from "@/lib/security/rate-limit";

export async function GET(req: NextRequest) {
  try {
    const ip = clientIp(req);
    const rl = rateLimit({ key: `admin:${ip}`, ...RATE_PRESETS.admin });
    if (!rl.ok) {
      return withRateLimitHeaders(
        jsonError("Too many requests", 429, { retryAfterSec: rl.retryAfterSec }),
        rl,
      );
    }
    await requireAdmin(req);

    const [users, activeSubs, domains, pendingSlips, recentBlocks] =
      await Promise.all([
        sqlOne<{ count: number }>(`SELECT count(*)::int AS count FROM users`),
        sqlOne<{ count: number }>(
          `SELECT count(*)::int AS count FROM users
           WHERE subscription_status IN ('ACTIVE', 'TRIAL')
             AND COALESCE(disabled, FALSE) = FALSE`,
        ),
        sqlOne<{ count: number }>(`SELECT count(*)::int AS count FROM domains`),
        sqlOne<{ count: number }>(
          `SELECT count(*)::int AS count FROM transactions WHERE payment_status = 'PENDING'`,
        ),
        sql<{
          id: string;
          url: string;
          status: string;
          last_checked_at: string | null;
          email: string;
        }>(
          `SELECT d.id, d.url, d.status, d.last_checked_at::text, u.email
           FROM domains d
           JOIN users u ON u.id = d.user_id
           WHERE d.status = 'BLOCKED'
           ORDER BY d.last_checked_at DESC NULLS LAST
           LIMIT 10`,
        ),
      ]);

    return withRateLimitHeaders(
      jsonOk({
        stats: {
          users: users?.count ?? 0,
          active_subs: activeSubs?.count ?? 0,
          domains: domains?.count ?? 0,
          pending_slips: pendingSlips?.count ?? 0,
        },
        recent_blocks: recentBlocks,
      }),
      rl,
    );
  } catch (err) {
    return handleRouteError(err);
  }
}
