import { NextRequest } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth";
import { sql, sqlOne } from "@/lib/db";
import { runDomainCheck } from "@/lib/domain-check";
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
    const q = req.nextUrl.searchParams.get("q")?.trim() || "";
    const domains = q
      ? await sql(
          `SELECT d.id, d.url, d.status, d.monitoring_enabled,
                  d.last_checked_at::text, d.user_id, u.email
           FROM domains d
           JOIN users u ON u.id = d.user_id
           WHERE d.url ILIKE $1 OR u.email ILIKE $1
           ORDER BY d.created_at DESC
           LIMIT 200`,
          [`%${q}%`],
        )
      : await sql(
          `SELECT d.id, d.url, d.status, d.monitoring_enabled,
                  d.last_checked_at::text, d.user_id, u.email
           FROM domains d
           JOIN users u ON u.id = d.user_id
           ORDER BY d.created_at DESC
           LIMIT 200`,
        );
    return jsonOk({ domains });
  } catch (err) {
    return handleRouteError(err);
  }
}

const patchSchema = z.object({
  id: z.string().min(1),
  monitoring_enabled: z.boolean().optional(),
  action: z.enum(["recheck"]).optional(),
});

export async function PATCH(req: NextRequest) {
  try {
    assertCsrf(req);
    await requireAdmin(req);
    const body = patchSchema.parse(await req.json());
    const domain = await sqlOne<{ id: string }>(
      `SELECT id FROM domains WHERE id = $1`,
      [body.id],
    );
    if (!domain) return jsonError("Domain not found", 404);

    if (body.monitoring_enabled !== undefined) {
      await sql(`UPDATE domains SET monitoring_enabled = $1 WHERE id = $2`, [
        body.monitoring_enabled,
        body.id,
      ]);
    }
    if (body.action === "recheck") {
      await runDomainCheck(body.id);
    }

    const updated = await sqlOne(
      `SELECT d.id, d.url, d.status, d.monitoring_enabled,
              d.last_checked_at::text, u.email
       FROM domains d
       JOIN users u ON u.id = d.user_id
       WHERE d.id = $1`,
      [body.id],
    );
    return jsonOk({ domain: updated });
  } catch (err) {
    return handleRouteError(err);
  }
}
