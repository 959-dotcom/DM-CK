import { NextRequest } from "next/server";
import { requireUser } from "@/lib/auth";
import { sql } from "@/lib/db";
import {
  advanceCheckJob,
  createCheckAllJob,
  getCheckJobForUser,
  jobPublicView,
} from "@/lib/check-jobs";
import { handleRouteError, jsonError, jsonOk, withRateLimitHeaders } from "@/lib/api";
import { assertCsrf } from "@/lib/security/csrf";
import {
  clientIp,
  RATE_PRESETS,
  rateLimit,
} from "@/lib/security/rate-limit";

async function domainsSnapshot(userId: string) {
  return sql<{
    id: string;
    url: string;
    status: string;
    monitoring_enabled: boolean;
    last_checked_at: string | null;
    ais_status: string | null;
    true_status: string | null;
    dtac_status: string | null;
    tbb_status: string | null;
    nt_status: string | null;
  }>(
    `SELECT d.id, d.url, d.status, d.monitoring_enabled,
            d.last_checked_at::text,
            l.ais_status, l.true_status, l.dtac_status, l.tbb_status, l.nt_status
     FROM domains d
     LEFT JOIN LATERAL (
       SELECT ais_status, true_status, dtac_status, tbb_status, nt_status
       FROM domain_check_logs
       WHERE domain_id = d.id
       ORDER BY checked_at DESC
       LIMIT 1
     ) l ON TRUE
     WHERE d.user_id = $1
     ORDER BY d.created_at DESC`,
    [userId],
  );
}

/** Start Check All Now — queues every domain for immediate recheck. */
export async function POST(req: NextRequest) {
  try {
    assertCsrf(req);
    const ip = clientIp(req);
    const rl = rateLimit({ key: `check-all:${ip}`, ...RATE_PRESETS.api });
    if (!rl.ok) {
      return withRateLimitHeaders(
        jsonError("Too many requests", 429, { retryAfterSec: rl.retryAfterSec }),
        rl,
      );
    }

    const user = await requireUser(req);
    const rows = await sql<{ id: string }>(
      `SELECT id FROM domains WHERE user_id = $1 ORDER BY created_at ASC`,
      [user.id],
    );
    if (rows.length === 0) {
      return withRateLimitHeaders(
        jsonError("ไม่มีโดเมนให้ตรวจ / no domains", 400),
        rl,
      );
    }

    const job = await createCheckAllJob(
      user.id,
      rows.map((r) => r.id),
    );
    // First batch immediately so UI shows progress without an empty poll.
    const advanced = await advanceCheckJob(job.id, user.id, 2);
    const domains = await domainsSnapshot(user.id);

    return withRateLimitHeaders(
      jsonOk({ job: jobPublicView(advanced), domains }),
      rl,
    );
  } catch (err) {
    return handleRouteError(err);
  }
}

/**
 * Poll + advance Check All Now job.
 * Each GET processes a small batch (serverless-safe) and returns progress.
 */
export async function GET(req: NextRequest) {
  try {
    const user = await requireUser(req);
    const jobId = req.nextUrl.searchParams.get("jobId");
    if (!jobId) return jsonError("jobId required", 400);

    const existing = await getCheckJobForUser(jobId, user.id);
    if (!existing) return jsonError("Job not found", 404);

    const batchSize = Math.min(
      5,
      Math.max(1, Number(req.nextUrl.searchParams.get("batch") || 2)),
    );

    const advanced =
      existing.status === "DONE" || existing.status === "FAILED"
        ? existing
        : await advanceCheckJob(jobId, user.id, batchSize);

    const domains = await domainsSnapshot(user.id);
    return jsonOk({ job: jobPublicView(advanced), domains });
  } catch (err) {
    return handleRouteError(err);
  }
}
