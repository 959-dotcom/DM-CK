import { NextRequest } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { runDueDomainChecks } from "@/lib/domain-check";
import { startDomainCheckWorker } from "@/lib/queue";
import { handleRouteError, jsonError, jsonOk } from "@/lib/api";
import { assertCsrf } from "@/lib/security/csrf";
import {
  clientIp,
  RATE_PRESETS,
  rateLimit,
} from "@/lib/security/rate-limit";
import { getMeta, touchWorkerLastRun } from "@/lib/system-meta";

function envPresent(name: string): boolean {
  return Boolean(process.env[name]?.trim());
}

export async function GET(req: NextRequest) {
  try {
    const ip = clientIp(req);
    const rl = rateLimit({ key: `admin:${ip}`, ...RATE_PRESETS.admin });
    if (!rl.ok) return jsonError("Too many requests", 429);
    await requireAdmin(req);

    const workerLastRun = await getMeta("worker_last_run");
    let parsed: unknown = null;
    if (workerLastRun) {
      try {
        parsed = JSON.parse(workerLastRun);
      } catch {
        parsed = { raw: workerLastRun };
      }
    }

    return jsonOk({
      worker_last_run: parsed,
      env_health: {
        DATABASE_URL: envPresent("DATABASE_URL"),
        JWT_SECRET: envPresent("JWT_SECRET"),
        PROMPTPAY_ID: envPresent("PROMPTPAY_ID"),
        SLIPOK_API_KEY: envPresent("SLIPOK_API_KEY"),
        SLIPOK_BRANCH_ID: envPresent("SLIPOK_BRANCH_ID"),
        TELEGRAM_BOT_TOKEN: envPresent("TELEGRAM_BOT_TOKEN"),
        TELEGRAM_ADMIN_CHAT_ID: envPresent("TELEGRAM_ADMIN_CHAT_ID"),
        REDIS_URL: envPresent("REDIS_URL"),
        WORKER_SECRET: envPresent("WORKER_SECRET"),
        CRON_SECRET: envPresent("CRON_SECRET"),
        DEMO_FORCE_BLOCK: process.env.DEMO_FORCE_BLOCK === "1",
      },
      node_env: process.env.NODE_ENV || "development",
    });
  } catch (err) {
    return handleRouteError(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    assertCsrf(req);
    const ip = clientIp(req);
    const rl = rateLimit({ key: `admin-tick:${ip}`, ...RATE_PRESETS.worker });
    if (!rl.ok) return jsonError("Too many requests", 429);
    await requireAdmin(req);

    // Extra secret gate when WORKER_SECRET is configured.
    const workerSecret = process.env.WORKER_SECRET?.trim();
    if (workerSecret) {
      const header = req.headers.get("x-worker-secret");
      const body = (await req.json().catch(() => ({}))) as {
        worker_secret?: string;
        action?: string;
      };
      if (header !== workerSecret && body.worker_secret !== workerSecret) {
        return jsonError("Worker secret required", 403);
      }
    } else {
      await req.json().catch(() => ({}));
    }

    const mode = await startDomainCheckWorker();
    const checked = await runDueDomainChecks();
    await touchWorkerLastRun({ mode, checked, via: "admin" });
    return jsonOk({ ok: true, mode, checked });
  } catch (err) {
    return handleRouteError(err);
  }
}
