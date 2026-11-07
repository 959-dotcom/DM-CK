import { NextRequest } from "next/server";
import { runDueDomainChecks } from "@/lib/domain-check";
import { startDomainCheckWorker } from "@/lib/queue";
import { handleRouteError, jsonError, jsonOk } from "@/lib/api";

/**
 * Manual / cron tick endpoint.
 * Protect with WORKER_SECRET / CRON_SECRET when set; open in local/dev when unset.
 * Vercel Cron sends `Authorization: Bearer <CRON_SECRET>` when that env is set.
 */
function authorizeWorker(req: NextRequest): boolean {
  const workerSecret = process.env.WORKER_SECRET?.trim();
  const cronSecret = process.env.CRON_SECRET?.trim();
  if (!workerSecret && !cronSecret) return true;

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
    if (!authorizeWorker(req)) return jsonError("Forbidden", 403);
    const mode = await startDomainCheckWorker();
    const checked = await runDueDomainChecks();
    return jsonOk({ ok: true, mode, checked });
  } catch (err) {
    return handleRouteError(err);
  }
}

export async function GET(req: NextRequest) {
  return POST(req);
}
