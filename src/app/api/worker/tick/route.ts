import { NextRequest } from "next/server";
import { runDueDomainChecks } from "@/lib/domain-check";
import { startDomainCheckWorker } from "@/lib/queue";
import { handleRouteError, jsonError, jsonOk } from "@/lib/api";

/**
 * Manual / cron tick endpoint.
 * Protect with WORKER_SECRET when set; open in local/dev when unset.
 */
export async function POST(req: NextRequest) {
  try {
    const secret = process.env.WORKER_SECRET?.trim();
    if (secret) {
      const header = req.headers.get("x-worker-secret");
      if (header !== secret) return jsonError("Forbidden", 403);
    }
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
