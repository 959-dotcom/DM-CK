import { NextRequest } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth";
import { newId, sql, sqlOne } from "@/lib/db";
import { handleRouteError, jsonError, jsonOk } from "@/lib/api";
import { assertCsrf } from "@/lib/security/csrf";
import {
  clientIp,
  RATE_PRESETS,
  rateLimit,
} from "@/lib/security/rate-limit";

export async function GET(req: NextRequest) {
  try {
    await requireAdmin(req);
    const plans = await sql(
      `SELECT id, name, code, price::text, price_monthly::text, price_yearly::text,
              max_domains, interval_days, check_interval_minutes,
              COALESCE(history_days, 7)::int AS history_days,
              COALESCE(max_telegram_groups, 1)::int AS max_telegram_groups,
              badge, COALESCE(sort_order, 100)::int AS sort_order,
              COALESCE(is_active, TRUE) AS is_active, created_at::text
       FROM plans ORDER BY sort_order ASC, price ASC`,
    );
    return jsonOk({ plans });
  } catch (err) {
    return handleRouteError(err);
  }
}

const upsertSchema = z.object({
  id: z.string().min(1).max(64).optional(),
  name: z.string().min(1).max(120),
  code: z.string().min(1).max(64).optional(),
  price: z.number().min(0).max(1_000_000).optional(),
  price_monthly: z.number().min(0).max(1_000_000).optional(),
  price_yearly: z.number().min(0).max(1_000_000).optional(),
  max_domains: z.number().int().min(0).max(10_000),
  interval_days: z.number().int().min(1).max(3650).optional(),
  check_interval_minutes: z.number().int().min(1).max(1440).optional(),
  history_days: z.number().int().min(1).max(3650).optional(),
  max_telegram_groups: z.number().int().min(1).max(99).optional(),
  badge: z.string().max(32).nullable().optional(),
  sort_order: z.number().int().min(0).max(10_000).optional(),
  is_active: z.boolean().optional(),
});

export async function POST(req: NextRequest) {
  try {
    assertCsrf(req);
    const ip = clientIp(req);
    const rl = rateLimit({ key: `admin:${ip}`, ...RATE_PRESETS.admin });
    if (!rl.ok) return jsonError("Too many requests", 429);
    await requireAdmin(req);
    const body = upsertSchema.parse(await req.json());
    const id = body.id || newId("plan");
    const priceMonthly = body.price_monthly ?? body.price ?? 0;
    const priceYearly = body.price_yearly ?? priceMonthly * 10;
    const price = body.price ?? priceMonthly;

    await sql(
      `INSERT INTO plans (
         id, name, code, price, price_monthly, price_yearly,
         max_domains, interval_days, check_interval_minutes,
         history_days, max_telegram_groups, badge, sort_order, is_active
       )
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
       ON CONFLICT (id) DO UPDATE SET
         name = EXCLUDED.name,
         code = EXCLUDED.code,
         price = EXCLUDED.price,
         price_monthly = EXCLUDED.price_monthly,
         price_yearly = EXCLUDED.price_yearly,
         max_domains = EXCLUDED.max_domains,
         interval_days = EXCLUDED.interval_days,
         check_interval_minutes = EXCLUDED.check_interval_minutes,
         history_days = EXCLUDED.history_days,
         max_telegram_groups = EXCLUDED.max_telegram_groups,
         badge = EXCLUDED.badge,
         sort_order = EXCLUDED.sort_order,
         is_active = EXCLUDED.is_active`,
      [
        id,
        body.name,
        body.code || id,
        price,
        priceMonthly,
        priceYearly,
        body.max_domains,
        body.interval_days ?? 30,
        body.check_interval_minutes ?? 15,
        body.history_days ?? 7,
        body.max_telegram_groups ?? 1,
        body.badge ?? null,
        body.sort_order ?? 100,
        body.is_active ?? true,
      ],
    );
    const plan = await sqlOne(
      `SELECT id, name, code, price::text, price_monthly::text, price_yearly::text,
              max_domains, interval_days, check_interval_minutes,
              history_days, max_telegram_groups, badge, sort_order, is_active
       FROM plans WHERE id = $1`,
      [id],
    );
    return jsonOk({ plan });
  } catch (err) {
    return handleRouteError(err);
  }
}

export async function PATCH(req: NextRequest) {
  return POST(req);
}

const deleteSchema = z.object({ id: z.string().min(1) });

export async function DELETE(req: NextRequest) {
  try {
    assertCsrf(req);
    await requireAdmin(req);
    const body = deleteSchema.parse(await req.json());
    const inUse = await sqlOne<{ count: number }>(
      `SELECT count(*)::int AS count FROM users WHERE plan_id = $1`,
      [body.id],
    );
    if ((inUse?.count ?? 0) > 0) {
      return jsonError("Plan is assigned to users — reassign first", 400);
    }
    await sql(`DELETE FROM plans WHERE id = $1`, [body.id]);
    return jsonOk({ ok: true });
  } catch (err) {
    return handleRouteError(err);
  }
}
