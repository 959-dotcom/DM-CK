import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { NextRequest } from "next/server";
import { requireUser } from "@/lib/auth";
import { BillingCycle } from "@/lib/constants";
import { sql, sqlOne } from "@/lib/db";
import { expireAtForCycle } from "@/lib/plans";
import { absolutePublicUrl } from "@/lib/public-url";
import { verifySlip } from "@/lib/slipok";
import { notifyAdminPayment, getTelegramSlipApproveChatId } from "@/lib/telegram";
import { requestManualSlipApproval } from "@/lib/telegram-slip-approve";
import { handleRouteError, jsonError, jsonOk, withRateLimitHeaders } from "@/lib/api";
import { assertCsrf } from "@/lib/security/csrf";
import {
  assertSafeUploadDir,
  validateSlipUpload,
} from "@/lib/security/upload";
import {
  clientIp,
  RATE_PRESETS,
  rateLimit,
} from "@/lib/security/rate-limit";

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  try {
    assertCsrf(req);
    const ip = clientIp(req);
    const rl = rateLimit({ key: `slip:${ip}`, ...RATE_PRESETS.slip });
    if (!rl.ok) {
      return withRateLimitHeaders(
        jsonError("Too many slip uploads", 429, {
          retryAfterSec: rl.retryAfterSec,
        }),
        rl,
      );
    }

    const user = await requireUser(req);
    const { id } = await ctx.params;
    if (!/^[a-zA-Z0-9_:-]+$/.test(id)) {
      return jsonError("Invalid transaction id", 400);
    }

    const txn = await sqlOne<{
      id: string;
      user_id: string;
      plan_id: string;
      amount: string;
      payment_status: string;
      billing_cycle: BillingCycle | null;
    }>(
      `SELECT id, user_id, plan_id, amount::text, payment_status, billing_cycle
       FROM transactions WHERE id = $1`,
      [id],
    );
    if (!txn || txn.user_id !== user.id) {
      return jsonError("Transaction not found", 404);
    }
    if (txn.payment_status !== "PENDING") {
      return jsonError("Transaction is not pending", 400);
    }

    const form = await req.formData();
    const file = form.get("slip");
    if (!(file instanceof File)) {
      return jsonError("Missing slip file", 400);
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const validated = validateSlipUpload({
      buffer,
      originalName: file.name || "slip.jpg",
      declaredType: file.type,
    });
    if (!validated.ok) {
      return jsonError(validated.error, 400);
    }

    const amount = Number(txn.amount);
    const verify = await verifySlip({
      amount,
      slipBuffer: buffer,
      filename: `slip${validated.ext}`,
    });

    const uploadDir = path.join(process.cwd(), "public", "uploads", "slips");
    await mkdir(uploadDir, { recursive: true });
    const safeName = `${id}_${validated.safeFilename}`;
    const slipPath = path.join(uploadDir, safeName);
    assertSafeUploadDir(uploadDir, slipPath);
    await writeFile(slipPath, buffer);
    const slipUrl = `/uploads/slips/${safeName}`;

    const plan = await sqlOne<{
      name: string;
      interval_days: number;
    }>(`SELECT name, interval_days FROM plans WHERE id = $1`, [txn.plan_id]);

    const cycle: BillingCycle =
      txn.billing_cycle === "YEARLY" ? "YEARLY" : "MONTHLY";
    const planLabel = `${plan?.name || txn.plan_id} (${cycle})`;

    if (!verify.ok) {
      // Backup path: keep PENDING + ask Telegram approve group when configured.
      const approveChat = getTelegramSlipApproveChatId();
      if (approveChat) {
        await sql(
          `UPDATE transactions SET slip_url = $1 WHERE id = $2 AND payment_status = 'PENDING'`,
          [slipUrl, id],
        );
        const sent = await requestManualSlipApproval({
          kind: "plan",
          id,
          email: user.email,
          title: planLabel,
          amount,
          slipUrl: absolutePublicUrl(slipUrl),
          verifyMessage: verify.message,
        });
        return withRateLimitHeaders(
          jsonOk(
            {
              pending_manual: true,
              telegram_sent: sent,
              transaction: {
                id,
                payment_status: "PENDING",
                slip_url: slipUrl,
              },
              verify,
              message:
                "สลิปถูกส่งให้แอดมินตรวจสอบแล้ว (SlipOK ไม่ผ่าน/ไม่พร้อม)",
            },
            { status: 202 },
          ),
          rl,
        );
      }

      await sql(
        `UPDATE transactions SET slip_url = $1, payment_status = 'REJECTED' WHERE id = $2`,
        [slipUrl, id],
      );
      return jsonError(verify.message || "Slip verification failed", 400);
    }

    const expireAt = expireAtForCycle(cycle);

    await sql(
      `UPDATE transactions SET slip_url = $1, payment_status = 'APPROVED' WHERE id = $2`,
      [slipUrl, id],
    );
    await sql(
      `UPDATE users
       SET subscription_status = 'ACTIVE',
           plan_id = $1,
           plan_expire_at = $2,
           billing_cycle = $3
       WHERE id = $4`,
      [txn.plan_id, expireAt.toISOString(), cycle, user.id],
    );

    await notifyAdminPayment({
      email: user.email,
      planName: planLabel,
      amount,
      transactionId: id,
      mock: verify.mock,
      via: verify.mock ? "mock" : "live",
    });

    return withRateLimitHeaders(
      jsonOk({
        transaction: {
          id,
          payment_status: "APPROVED",
          slip_url: slipUrl,
        },
        verify,
        subscription: {
          status: "ACTIVE",
          plan_id: txn.plan_id,
          billing_cycle: cycle,
          plan_expire_at: expireAt.toISOString(),
        },
      }),
      rl,
    );
  } catch (err) {
    return handleRouteError(err);
  }
}
