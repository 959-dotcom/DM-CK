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
      `SELECT id, name, price::text, max_domains, interval_days, check_interval_minutes, created_at::text
       FROM plans ORDER BY price ASC`,
    );
    return jsonOk({ plans });
  } catch (err) {
    return handleRouteError(err);
  }
}

const upsertSchema = z.object({
  id: z.string().min(1).max(64).optional(),
  name: z.string().min(1).max(120),
  price: z.number().min(0).max(1_000_000),
  max_domains: z.number().int().min(0).max(10_000),
  interval_days: z.number().int().min(1).max(3650),
  check_interval_minutes: z.number().int().min(1).max(1440).optional(),
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
    await sql(
      `INSERT INTO plans (id, name, price, max_domains, interval_days, check_interval_minutes)
       VALUES ($1,$2,$3,$4,$5,$6)
       ON CONFLICT (id) DO UPDATE SET
         name = EXCLUDED.name,
         price = EXCLUDED.price,
         max_domains = EXCLUDED.max_domains,
         interval_days = EXCLUDED.interval_days,
         check_interval_minutes = EXCLUDED.check_interval_minutes`,
      [
        id,
        body.name,
        body.price,
        body.max_domains,
        body.interval_days,
        body.check_interval_minutes ?? 15,
      ],
    );
    const plan = await sqlOne(`SELECT id, name, price::text, max_domains, interval_days, check_interval_minutes FROM plans WHERE id = $1`, [id]);
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
