import { NextRequest } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth";
import { sql, sqlOne } from "@/lib/db";
import { handleRouteError, jsonError, jsonOk, withRateLimitHeaders } from "@/lib/api";
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
    if (!rl.ok) {
      return withRateLimitHeaders(
        jsonError("Too many requests", 429),
        rl,
      );
    }
    await requireAdmin(req);
    const q = req.nextUrl.searchParams.get("q")?.trim() || "";
    const users = q
      ? await sql(
          `SELECT id, email, role, subscription_status, plan_id,
                  plan_expire_at::text, billing_cycle,
                  COALESCE(extra_domain_slots, 0)::int AS extra_domain_slots,
                  telegram_chat_id, telegram_chat_ids,
                  COALESCE(disabled, FALSE) AS disabled,
                  created_at::text
           FROM users
           WHERE email ILIKE $1 OR id ILIKE $1 OR COALESCE(telegram_chat_id,'') ILIKE $1
           ORDER BY created_at DESC
           LIMIT 100`,
          [`%${q}%`],
        )
      : await sql(
          `SELECT id, email, role, subscription_status, plan_id,
                  plan_expire_at::text, billing_cycle,
                  COALESCE(extra_domain_slots, 0)::int AS extra_domain_slots,
                  telegram_chat_id, telegram_chat_ids,
                  COALESCE(disabled, FALSE) AS disabled,
                  created_at::text
           FROM users
           ORDER BY created_at DESC
           LIMIT 100`,
        );
    return withRateLimitHeaders(jsonOk({ users }), rl);
  } catch (err) {
    return handleRouteError(err);
  }
}

const patchSchema = z.object({
  id: z.string().min(1),
  role: z.enum(["USER", "ADMIN"]).optional(),
  subscription_status: z
    .enum(["FREE", "TRIAL", "ACTIVE", "EXPIRED"])
    .optional(),
  plan_id: z.string().nullable().optional(),
  plan_expire_at: z.string().nullable().optional(),
  billing_cycle: z.enum(["MONTHLY", "YEARLY"]).nullable().optional(),
  extra_domain_slots: z.number().int().min(0).max(10_000).optional(),
  telegram_chat_id: z.string().max(64).nullable().optional(),
  disabled: z.boolean().optional(),
});

export async function PATCH(req: NextRequest) {
  try {
    assertCsrf(req);
    const ip = clientIp(req);
    const rl = rateLimit({ key: `admin:${ip}`, ...RATE_PRESETS.admin });
    if (!rl.ok) return jsonError("Too many requests", 429);
    const admin = await requireAdmin(req);
    const body = patchSchema.parse(await req.json());

    const existing = await sqlOne<{ id: string; email: string }>(
      `SELECT id, email FROM users WHERE id = $1`,
      [body.id],
    );
    if (!existing) return jsonError("User not found", 404);

    // Prevent locking yourself out of admin.
    if (body.id === admin.id && body.role && body.role !== "ADMIN") {
      return jsonError("Cannot demote your own admin role", 400);
    }
    if (body.id === admin.id && body.disabled === true) {
      return jsonError("Cannot disable your own account", 400);
    }

    const tgIdsJson =
      body.telegram_chat_id === undefined
        ? null
        : body.telegram_chat_id
          ? JSON.stringify([body.telegram_chat_id])
          : "[]";

    await sql(
      `UPDATE users SET
         role = COALESCE($2, role),
         subscription_status = COALESCE($3, subscription_status),
         plan_id = CASE WHEN $4::boolean THEN $5 ELSE plan_id END,
         plan_expire_at = CASE WHEN $6::boolean THEN $7::timestamptz ELSE plan_expire_at END,
         telegram_chat_id = CASE WHEN $8::boolean THEN $9 ELSE telegram_chat_id END,
         telegram_chat_ids = CASE WHEN $8::boolean THEN $10 ELSE telegram_chat_ids END,
         billing_cycle = CASE WHEN $11::boolean THEN $12 ELSE billing_cycle END,
         extra_domain_slots = COALESCE($13, extra_domain_slots),
         disabled = COALESCE($14, disabled)
       WHERE id = $1`,
      [
        body.id,
        body.role ?? null,
        body.subscription_status ?? null,
        body.plan_id !== undefined,
        body.plan_id ?? null,
        body.plan_expire_at !== undefined,
        body.plan_expire_at,
        body.telegram_chat_id !== undefined,
        body.telegram_chat_id ?? null,
        tgIdsJson,
        body.billing_cycle !== undefined,
        body.billing_cycle ?? null,
        body.extra_domain_slots ?? null,
        body.disabled ?? null,
      ],
    );

    const user = await sqlOne(
      `SELECT id, email, role, subscription_status, plan_id,
              plan_expire_at::text, billing_cycle,
              COALESCE(extra_domain_slots, 0)::int AS extra_domain_slots,
              telegram_chat_id, telegram_chat_ids,
              COALESCE(disabled, FALSE) AS disabled
       FROM users WHERE id = $1`,
      [body.id],
    );
    return jsonOk({ user });
  } catch (err) {
    return handleRouteError(err);
  }
}
