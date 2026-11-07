import { NextRequest } from "next/server";
import { handleRouteError, jsonError, jsonOk, withRateLimitHeaders } from "@/lib/api";
import {
  clientIp,
  RATE_PRESETS,
  rateLimit,
} from "@/lib/security/rate-limit";
import { getTelegramWebhookSecret } from "@/lib/telegram";
import {
  processTelegramUpdates,
  TelegramUpdate,
} from "@/lib/telegram-slip-approve";

/**
 * Telegram Bot API webhook for slip Approve/Reject callbacks + /approve|/reject.
 * Secured by X-Telegram-Bot-Api-Secret-Token === TELEGRAM_WEBHOOK_SECRET
 * (falls back to WORKER_SECRET).
 */
function authorizeTelegramWebhook(req: NextRequest): boolean {
  const expected = getTelegramWebhookSecret();
  if (!expected) {
    // Refuse open webhook in production; allow local without secret for demos.
    return process.env.NODE_ENV !== "production";
  }
  const header = req.headers.get("x-telegram-bot-api-secret-token");
  if (header && header === expected) return true;
  const worker = req.headers.get("x-worker-secret");
  if (worker && worker === expected) return true;
  return false;
}

export async function POST(req: NextRequest) {
  try {
    const ip = clientIp(req);
    const rl = rateLimit({ key: `tg-webhook:${ip}`, ...RATE_PRESETS.worker });
    if (!rl.ok) {
      return withRateLimitHeaders(
        jsonError("Too many requests", 429, { retryAfterSec: rl.retryAfterSec }),
        rl,
      );
    }

    if (!authorizeTelegramWebhook(req)) {
      return jsonError("Forbidden", 403);
    }

    const body = (await req.json().catch(() => null)) as TelegramUpdate | null;
    if (!body || typeof body !== "object") {
      return jsonError("Invalid update", 400);
    }

    const result = await processTelegramUpdates([body]);
    // Always 200 so Telegram does not retry endlessly on business failures.
    return withRateLimitHeaders(jsonOk({ ok: true, ...result }), rl);
  } catch (err) {
    return handleRouteError(err);
  }
}
