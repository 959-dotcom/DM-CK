import { NextRequest } from "next/server";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { newId, sql, sqlOne } from "@/lib/db";
import { runDomainCheck } from "@/lib/domain-check";
import { handleRouteError, jsonError, jsonOk } from "@/lib/api";

const createSchema = z.object({
  url: z.string().min(3).max(500),
});

export async function GET(req: NextRequest) {
  try {
    const user = await requireUser(req);
    const domains = await sql<{
      id: string;
      url: string;
      status: string;
      monitoring_enabled: boolean;
      last_checked_at: string | null;
      ais_status: string | null;
      true_status: string | null;
      dtac_status: string | null;
      tbb_status: string | null;
      nt_status: string | null;
    }>(
      `SELECT d.id, d.url, d.status, d.monitoring_enabled,
              d.last_checked_at::text,
              l.ais_status, l.true_status, l.dtac_status, l.tbb_status, l.nt_status
       FROM domains d
       LEFT JOIN LATERAL (
         SELECT ais_status, true_status, dtac_status, tbb_status, nt_status
         FROM domain_check_logs
         WHERE domain_id = d.id
         ORDER BY checked_at DESC
         LIMIT 1
       ) l ON TRUE
       WHERE d.user_id = $1
       ORDER BY d.created_at DESC`,
      [user.id],
    );
    return jsonOk({ domains });
  } catch (err) {
    return handleRouteError(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    const user = await requireUser(req);
    const body = createSchema.parse(await req.json());

    const plan = user.plan_id
      ? await sqlOne<{ max_domains: number }>(
          `SELECT max_domains FROM plans WHERE id = $1`,
          [user.plan_id],
        )
      : { max_domains: 1 };

    const count = await sqlOne<{ count: number }>(
      `SELECT count(*)::int AS count FROM domains WHERE user_id = $1`,
      [user.id],
    );
    const max = plan?.max_domains ?? 1;
    if ((count?.count ?? 0) >= max) {
      return jsonError(
        `Plan quota reached (${max} domain${max === 1 ? "" : "s"}). Upgrade to add more.`,
        403,
      );
    }

    let url = body.url.trim();
    if (!/^https?:\/\//i.test(url)) url = `https://${url}`;

    const id = newId("dom");
    await sql(
      `INSERT INTO domains (id, user_id, url, status, monitoring_enabled)
       VALUES ($1,$2,$3,'ACTIVE',TRUE)`,
      [id, user.id, url],
    );

    // Fire-and-forget first check
    runDomainCheck(id).catch((err) =>
      console.error("[domains] initial check failed", err),
    );

    return jsonOk({ domain: { id, url, status: "ACTIVE", monitoring_enabled: true } });
  } catch (err) {
    return handleRouteError(err);
  }
}
