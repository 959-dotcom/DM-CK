import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { NextRequest } from "next/server";
import { requireUser } from "@/lib/auth";
import { sql, sqlOne } from "@/lib/db";
import { verifySlip } from "@/lib/slipok";
import { notifyAdminPayment } from "@/lib/telegram";
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
      return jsonError("Invalid addon id", 400);
    }

    const addon = await sqlOne<{
      id: string;
      user_id: string;
      slots: number;
      amount: string;
      payment_status: string;
    }>(
      `SELECT id, user_id, slots, amount::text, payment_status
       FROM addon_purchases WHERE id = $1`,
      [id],
    );
    if (!addon || addon.user_id !== user.id) {
      return jsonError("Addon purchase not found", 404);
    }
    if (addon.payment_status !== "PENDING") {
      return jsonError("Addon purchase is not pending", 400);
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

    const amount = Number(addon.amount);
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

    if (!verify.ok) {
      await sql(
        `UPDATE addon_purchases SET slip_url = $1, payment_status = 'REJECTED' WHERE id = $2`,
        [slipUrl, id],
      );
      return jsonError(verify.message || "Slip verification failed", 400);
    }

    await sql(
      `UPDATE addon_purchases SET slip_url = $1, payment_status = 'APPROVED' WHERE id = $2`,
      [slipUrl, id],
    );
    await sql(
      `UPDATE users
       SET extra_domain_slots = COALESCE(extra_domain_slots, 0) + $1
       WHERE id = $2`,
      [addon.slots, user.id],
    );

    const updated = await sqlOne<{ extra_domain_slots: number }>(
      `SELECT COALESCE(extra_domain_slots, 0)::int AS extra_domain_slots FROM users WHERE id = $1`,
      [user.id],
    );

    await notifyAdminPayment({
      email: user.email,
      planName: `Extra Domain Slot × ${addon.slots}`,
      amount,
      transactionId: id,
      mock: verify.mock,
    });

    return withRateLimitHeaders(
      jsonOk({
        addon: {
          id,
          payment_status: "APPROVED",
          slip_url: slipUrl,
          slots: addon.slots,
        },
        verify,
        extra_domain_slots: updated?.extra_domain_slots ?? addon.slots,
      }),
      rl,
    );
  } catch (err) {
    return handleRouteError(err);
  }
}
