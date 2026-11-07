import { NextRequest } from "next/server";
import { requireUser } from "@/lib/auth";
import { sqlOne } from "@/lib/db";
import { runDomainCheck } from "@/lib/domain-check";
import { handleRouteError, jsonError, jsonOk } from "@/lib/api";

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  try {
    const user = await requireUser(req);
    const { id } = await ctx.params;
    const domain = await sqlOne<{ id: string; user_id: string }>(
      `SELECT id, user_id FROM domains WHERE id = $1`,
      [id],
    );
    if (!domain || domain.user_id !== user.id) {
      return jsonError("Domain not found", 404);
    }
    await runDomainCheck(id);
    const latest = await sqlOne(
      `SELECT d.id, d.url, d.status, d.last_checked_at::text,
              l.ais_status, l.true_status, l.dtac_status, l.tbb_status, l.nt_status
       FROM domains d
       LEFT JOIN LATERAL (
         SELECT ais_status, true_status, dtac_status, tbb_status, nt_status
         FROM domain_check_logs WHERE domain_id = d.id
         ORDER BY checked_at DESC LIMIT 1
       ) l ON TRUE
       WHERE d.id = $1`,
      [id],
    );
    return jsonOk({ domain: latest });
  } catch (err) {
    return handleRouteError(err);
  }
}
