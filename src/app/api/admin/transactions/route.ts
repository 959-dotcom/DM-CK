import { NextRequest } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth";
import { sql, sqlOne } from "@/lib/db";
import { handleRouteError, jsonError, jsonOk } from "@/lib/api";
import { assertCsrf } from "@/lib/security/csrf";
import {
  clientIp,
  RATE_PRESETS,
  rateLimit,
} from "@/lib/security/rate-limit";
import { notifyUserPaymentDecision } from "@/lib/telegram";

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
                    t.payment_status, t.qr_ref, t.created_at::text,
                    p.name AS plan_name, u.email, u.telegram_chat_id
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
                    t.payment_status, t.qr_ref, t.created_at::text,
                    p.name AS plan_name, u.email, u.telegram_chat_id
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
});

export async function PATCH(req: NextRequest) {
  try {
    assertCsrf(req);
    await requireAdmin(req);
    const body = decisionSchema.parse(await req.json());

    const txn = await sqlOne<{
      id: string;
      user_id: string;
      plan_id: string;
      amount: string;
      payment_status: string;
      email: string;
      telegram_chat_id: string | null;
      plan_name: string;
      interval_days: number;
    }>(
      `SELECT t.id, t.user_id, t.plan_id, t.amount::text, t.payment_status,
              u.email, u.telegram_chat_id, p.name AS plan_name, p.interval_days
       FROM transactions t
       JOIN users u ON u.id = t.user_id
       JOIN plans p ON p.id = t.plan_id
       WHERE t.id = $1`,
      [body.id],
    );
    if (!txn) return jsonError("Transaction not found", 404);

    await sql(`UPDATE transactions SET payment_status = $1 WHERE id = $2`, [
      body.status,
      body.id,
    ]);

    if (body.status === "APPROVED") {
      const expireAt = new Date(
        Date.now() + (txn.interval_days || 30) * 24 * 60 * 60 * 1000,
      );
      await sql(
        `UPDATE users
         SET subscription_status = 'ACTIVE',
             plan_id = $1,
             plan_expire_at = $2
         WHERE id = $3`,
        [txn.plan_id, expireAt.toISOString(), txn.user_id],
      );
    }

    await notifyUserPaymentDecision({
      chatId: txn.telegram_chat_id,
      email: txn.email,
      planName: txn.plan_name,
      amount: Number(txn.amount),
      transactionId: txn.id,
      status: body.status,
      note: body.note,
    });

    return jsonOk({
      transaction: { id: body.id, payment_status: body.status },
    });
  } catch (err) {
    return handleRouteError(err);
  }
}
