import { NextRequest } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth";
import { BillingCycle, parseTelegramChatIds } from "@/lib/constants";
import { sql, sqlOne } from "@/lib/db";
import { expireAtForCycle } from "@/lib/plans";
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

    if (body.kind === "addon") {
      const addon = await sqlOne<{
        id: string;
        user_id: string;
        slots: number;
        amount: string;
        payment_status: string;
        email: string;
        telegram_chat_id: string | null;
        telegram_chat_ids: string | null;
      }>(
        `SELECT a.id, a.user_id, a.slots, a.amount::text, a.payment_status,
                u.email, u.telegram_chat_id, u.telegram_chat_ids
         FROM addon_purchases a
         JOIN users u ON u.id = a.user_id
         WHERE a.id = $1`,
        [body.id],
      );
      if (!addon) return jsonError("Addon purchase not found", 404);

      await sql(`UPDATE addon_purchases SET payment_status = $1 WHERE id = $2`, [
        body.status,
        body.id,
      ]);

      if (body.status === "APPROVED" && addon.payment_status !== "APPROVED") {
        await sql(
          `UPDATE users
           SET extra_domain_slots = COALESCE(extra_domain_slots, 0) + $1
           WHERE id = $2`,
          [addon.slots, addon.user_id],
        );
      }

      await notifyUserPaymentDecision({
        chatId: addon.telegram_chat_id,
        chatIds: parseTelegramChatIds(
          addon.telegram_chat_ids,
          addon.telegram_chat_id,
        ),
        email: addon.email,
        planName: `Extra Domain Slot × ${addon.slots}`,
        amount: Number(addon.amount),
        transactionId: addon.id,
        status: body.status,
        note: body.note,
      });

      return jsonOk({
        transaction: { id: body.id, payment_status: body.status, kind: "addon" },
      });
    }

    const txn = await sqlOne<{
      id: string;
      user_id: string;
      plan_id: string;
      amount: string;
      payment_status: string;
      billing_cycle: BillingCycle | null;
      email: string;
      telegram_chat_id: string | null;
      telegram_chat_ids: string | null;
      plan_name: string;
    }>(
      `SELECT t.id, t.user_id, t.plan_id, t.amount::text, t.payment_status, t.billing_cycle,
              u.email, u.telegram_chat_id, u.telegram_chat_ids, p.name AS plan_name
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
      const cycle: BillingCycle =
        txn.billing_cycle === "YEARLY" ? "YEARLY" : "MONTHLY";
      const expireAt = expireAtForCycle(cycle);
      await sql(
        `UPDATE users
         SET subscription_status = 'ACTIVE',
             plan_id = $1,
             plan_expire_at = $2,
             billing_cycle = $3
         WHERE id = $4`,
        [txn.plan_id, expireAt.toISOString(), cycle, txn.user_id],
      );
    }

    await notifyUserPaymentDecision({
      chatId: txn.telegram_chat_id,
      chatIds: parseTelegramChatIds(
        txn.telegram_chat_ids,
        txn.telegram_chat_id,
      ),
      email: txn.email,
      planName: `${txn.plan_name}${txn.billing_cycle ? ` (${txn.billing_cycle})` : ""}`,
      amount: Number(txn.amount),
      transactionId: txn.id,
      status: body.status,
      note: body.note,
    });

    return jsonOk({
      transaction: { id: body.id, payment_status: body.status, kind: "plan" },
    });
  } catch (err) {
    return handleRouteError(err);
  }
}
