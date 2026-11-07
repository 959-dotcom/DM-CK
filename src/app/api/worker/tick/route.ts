import { NextRequest } from "next/server";
import { runDueDomainChecks } from "@/lib/domain-check";
import { startDomainCheckWorker } from "@/lib/queue";
import { handleRouteError, jsonError, jsonOk, withRateLimitHeaders } from "@/lib/api";
import {
  clientIp,
  RATE_PRESETS,
  rateLimit,
} from "@/lib/security/rate-limit";
import { touchWorkerLastRun } from "@/lib/system-meta";

/**
 * Manual / cron tick endpoint.
 * Protect with WORKER_SECRET / CRON_SECRET when set; open in local/dev when unset.
 * Vercel Cron sends `Authorization: Bearer <CRON_SECRET>` when that env is set.
 */
function authorizeWorker(req: NextRequest): boolean {
  const workerSecret = process.env.WORKER_SECRET?.trim();
  const cronSecret = process.env.CRON_SECRET?.trim();
  if (!workerSecret && !cronSecret) {
    // Production must set a secret — refuse open tick outside development.
    if (process.env.NODE_ENV === "production") return false;
    return true;
  }

  const headerSecret = req.headers.get("x-worker-secret");
  if (workerSecret && headerSecret === workerSecret) return true;

  const auth = req.headers.get("authorization");
  const bearer = auth?.startsWith("Bearer ") ? auth.slice(7).trim() : "";
  if (cronSecret && bearer === cronSecret) return true;
  if (workerSecret && bearer === workerSecret) return true;
  return false;
}

export async function POST(req: NextRequest) {
  try {
    const ip = clientIp(req);
    const rl = rateLimit({ key: `worker:${ip}`, ...RATE_PRESETS.worker });
    if (!rl.ok) {
      return withRateLimitHeaders(
        jsonError("Too many worker ticks", 429, {
          retryAfterSec: rl.retryAfterSec,
        }),
        rl,
      );
    }

    if (!authorizeWorker(req)) return jsonError("Forbidden", 403);
    const mode = await startDomainCheckWorker();
    const checked = await runDueDomainChecks();
    await touchWorkerLastRun({ mode, checked, via: "api/worker/tick" });
    return withRateLimitHeaders(jsonOk({ ok: true, mode, checked }), rl);
  } catch (err) {
    return handleRouteError(err);
  }
}

export async function GET(req: NextRequest) {
  return POST(req);
}
