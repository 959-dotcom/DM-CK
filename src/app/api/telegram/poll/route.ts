import { NextRequest } from "next/server";
import { handleRouteError, jsonError, jsonOk, withRateLimitHeaders } from "@/lib/api";
import {
  clientIp,
  RATE_PRESETS,
  rateLimit,
} from "@/lib/security/rate-limit";
import {
  getTelegramBotToken,
  getTelegramWebhookSecret,
  sendSlipApproveTestMessage,
} from "@/lib/telegram";
import {
  processTelegramUpdates,
  TelegramUpdate,
} from "@/lib/telegram-slip-approve";

/**
 * Long-poll style worker: pulls getUpdates and applies Approve/Reject.
 * Also supports ?test=1 to smoke-send into TELEGRAM_SLIP_APPROVE_CHAT_ID.
 * Secured by x-worker-secret / Bearer === TELEGRAM_WEBHOOK_SECRET|WORKER_SECRET.
 */
function authorize(req: NextRequest): boolean {
  const expected = getTelegramWebhookSecret();
  if (!expected) {
    return process.env.NODE_ENV !== "production";
  }
  const header = req.headers.get("x-worker-secret");
  if (header && header === expected) return true;
  const auth = req.headers.get("authorization");
  const bearer = auth?.startsWith("Bearer ") ? auth.slice(7).trim() : "";
  if (bearer && bearer === expected) return true;
  return false;
}

export async function POST(req: NextRequest) {
  try {
    const ip = clientIp(req);
    const rl = rateLimit({ key: `tg-poll:${ip}`, ...RATE_PRESETS.worker });
    if (!rl.ok) {
      return withRateLimitHeaders(
        jsonError("Too many requests", 429, { retryAfterSec: rl.retryAfterSec }),
        rl,
      );
    }
    if (!authorize(req)) return jsonError("Forbidden", 403);

    if (req.nextUrl.searchParams.get("test") === "1") {
      const test = await sendSlipApproveTestMessage(
        `Spinlytics slip-approve OK @ ${new Date().toISOString()}`,
      );
      return withRateLimitHeaders(jsonOk({ ok: test.ok, test }), rl);
    }

    const token = getTelegramBotToken();
    if (!token) {
      return jsonError("TELEGRAM_BOT_TOKEN unset", 503);
    }

    const offsetParam = req.nextUrl.searchParams.get("offset");
    const offset = offsetParam ? Number(offsetParam) : undefined;
    const url = new URL(`https://api.telegram.org/bot${token}/getUpdates`);
    url.searchParams.set("timeout", "0");
    url.searchParams.set("limit", "50");
    if (offset != null && Number.isFinite(offset)) {
      url.searchParams.set("offset", String(offset));
    }
    // Only approve-related updates
    url.searchParams.set(
      "allowed_updates",
      JSON.stringify(["message", "callback_query"]),
    );

    const res = await fetch(url.toString(), { method: "GET" });
    const json = (await res.json().catch(() => ({}))) as {
      ok?: boolean;
      result?: TelegramUpdate[];
      description?: string;
    };
    if (!res.ok || !json.ok) {
      return jsonError(json.description || "getUpdates failed", 502);
    }

    const updates = json.result || [];
    const processed = await processTelegramUpdates(updates);
    const lastId =
      updates.length > 0
        ? Math.max(...updates.map((u) => u.update_id || 0))
        : null;

    return withRateLimitHeaders(
      jsonOk({
        ok: true,
        fetched: updates.length,
        next_offset: lastId != null ? lastId + 1 : null,
        ...processed,
      }),
      rl,
    );
  } catch (err) {
    return handleRouteError(err);
  }
}

export async function GET(req: NextRequest) {
  return POST(req);
}
