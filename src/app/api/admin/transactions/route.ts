import { NextRequest } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth";
import { sql } from "@/lib/db";
import { decidePayment } from "@/lib/payment-decision";
import { handleRouteError, jsonError, jsonOk } from "@/lib/api";
import { assertCsrf } from "@/lib/security/csrf";
import {
  clientIp,
  RATE_PRESETS,
  rateLimit,
} from "@/lib/security/rate-limit";

export async function GET(req: NextRequest) {
  try {
    const ip = clientIp(req);
    const rl = rateLimit({ key: `admin:${ip}`, ...RATE_PRESETS.admin });
    if (!rl.ok) return jsonError("Too many requests", 429);
    await requireAdmin(req);
    const status = req.nextUrl.searchParams.get("status");
    const rows =
      status && ["PENDING", "APPROVED", "REJECTED"].includes(status)
        ? await sql(
            `SELECT t.id, t.user_id, t.plan_id, t.amount::text, t.slip_url,
                    t.payment_status, t.qr_ref, t.billing_cycle, t.created_at::text,
                    p.name AS plan_name, u.email, u.telegram_chat_id, u.telegram_chat_ids
             FROM transactions t
             JOIN plans p ON p.id = t.plan_id
             JOIN users u ON u.id = t.user_id
             WHERE t.payment_status = $1
             ORDER BY t.created_at DESC
             LIMIT 100`,
            [status],
          )
        : await sql(
            `SELECT t.id, t.user_id, t.plan_id, t.amount::text, t.slip_url,
                    t.payment_status, t.qr_ref, t.billing_cycle, t.created_at::text,
                    p.name AS plan_name, u.email, u.telegram_chat_id, u.telegram_chat_ids
             FROM transactions t
             JOIN plans p ON p.id = t.plan_id
             JOIN users u ON u.id = t.user_id
             ORDER BY t.created_at DESC
             LIMIT 100`,
          );
    return jsonOk({ transactions: rows });
  } catch (err) {
    return handleRouteError(err);
  }
}

const decisionSchema = z.object({
  id: z.string().min(1),
  status: z.enum(["APPROVED", "REJECTED"]),
  note: z.string().max(500).optional(),
  kind: z.enum(["plan", "addon"]).default("plan"),
});

export async function PATCH(req: NextRequest) {
  try {
    assertCsrf(req);
    await requireAdmin(req);
    const body = decisionSchema.parse(await req.json());

    const result = await decidePayment({
      kind: body.kind,
      id: body.id,
      status: body.status,
      note: body.note,
      via: "admin",
    });

    if (!result.ok) {
      return jsonError(result.error, result.status || 400);
    }

    return jsonOk({
      transaction: {
        id: body.id,
        payment_status: body.status,
        kind: body.kind,
        already: result.already || false,
      },
    });
  } catch (err) {
    return handleRouteError(err);
  }
}
