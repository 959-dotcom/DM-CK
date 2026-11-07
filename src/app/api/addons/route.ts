import { NextRequest } from "next/server";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { EXTRA_DOMAIN_SLOT_PRICE } from "@/lib/constants";
import { newId, sql } from "@/lib/db";
import { generatePromptPayQr } from "@/lib/promptpay";
import { handleRouteError, jsonError, jsonOk, withRateLimitHeaders } from "@/lib/api";
import { assertCsrf } from "@/lib/security/csrf";
import {
  clientIp,
  RATE_PRESETS,
  rateLimit,
} from "@/lib/security/rate-limit";

const createSchema = z.object({
  slots: z.number().int().min(1).max(100),
});

export async function GET(req: NextRequest) {
  try {
    const user = await requireUser(req);
    const rows = await sql(
      `SELECT id, slots, amount::text, slip_url, payment_status, qr_ref, created_at::text
       FROM addon_purchases
       WHERE user_id = $1
       ORDER BY created_at DESC
       LIMIT 50`,
      [user.id],
    );
    return jsonOk({
      addons: rows,
      price_per_slot_monthly: EXTRA_DOMAIN_SLOT_PRICE,
    });
  } catch (err) {
    return handleRouteError(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    assertCsrf(req);
    const ip = clientIp(req);
    const rl = rateLimit({ key: `payment:${ip}`, ...RATE_PRESETS.payment });
    if (!rl.ok) {
      return withRateLimitHeaders(
        jsonError("Too many payment requests", 429, {
          retryAfterSec: rl.retryAfterSec,
        }),
        rl,
      );
    }

    const user = await requireUser(req);
    const body = createSchema.parse(await req.json());
    const amount = body.slots * EXTRA_DOMAIN_SLOT_PRICE;
    const id = newId("addon");
    const qrRef = `ADX${Date.now().toString(36).toUpperCase()}`;
    const qr = await generatePromptPayQr({ amount, ref: qrRef });

    await sql(
      `INSERT INTO addon_purchases (id, user_id, slots, amount, payment_status, qr_ref)
       VALUES ($1,$2,$3,$4,'PENDING',$5)`,
      [id, user.id, body.slots, amount, qrRef],
    );

    return withRateLimitHeaders(
      jsonOk({
        addon: {
          id,
          slots: body.slots,
          amount,
          payment_status: "PENDING",
          qr_ref: qrRef,
          name: `Extra Domain Slot × ${body.slots}`,
        },
        promptpay: {
          id: qr.promptpayId,
          payload: qr.payload,
          qr_data_url: qr.dataUrl,
        },
      }),
      rl,
    );
  } catch (err) {
    return handleRouteError(err);
  }
}
