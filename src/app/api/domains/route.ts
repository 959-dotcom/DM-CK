import { NextRequest } from "next/server";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { newId, sql } from "@/lib/db";
import { runDomainCheck } from "@/lib/domain-check";
import { parseDomainInput } from "@/lib/domain-url";
import { domainQuotaForUser } from "@/lib/plans";
import { handleRouteError, jsonError, jsonOk, withRateLimitHeaders } from "@/lib/api";
import { assertCsrf } from "@/lib/security/csrf";
import {
  clientIp,
  RATE_PRESETS,
  rateLimit,
} from "@/lib/security/rate-limit";

const createSchema = z.object({
  url: z.string().min(1).max(500),
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
    assertCsrf(req);
    const ip = clientIp(req);
    const rl = rateLimit({ key: `domains:${ip}`, ...RATE_PRESETS.api });
    if (!rl.ok) {
      return withRateLimitHeaders(
        jsonError("Too many requests", 429, { retryAfterSec: rl.retryAfterSec }),
        rl,
      );
    }

    const user = await requireUser(req);
    const body = createSchema.parse(await req.json());

    const parsed = parseDomainInput(body.url);
    if (!parsed.ok) {
      return jsonError(parsed.error, 400);
    }

    const quota = await domainQuotaForUser(user.id);
    if (quota.used >= quota.total_slots) {
      return jsonError(
        `Domain quota reached (${quota.total_slots} = ${quota.max_domains} plan + ${quota.extra_domain_slots} extra). Upgrade or buy Extra Domain slots.`,
        403,
      );
    }

    const url = parsed.url;

    const id = newId("dom");
    await sql(
      `INSERT INTO domains (id, user_id, url, status, monitoring_enabled)
       VALUES ($1,$2,$3,'ACTIVE',TRUE)`,
      [id, user.id, url],
    );

    runDomainCheck(id).catch((err) =>
      console.error("[domains] initial check failed", err),
    );

    return withRateLimitHeaders(
      jsonOk({
        domain: { id, url, status: "ACTIVE", monitoring_enabled: true },
      }),
      rl,
    );
  } catch (err) {
    return handleRouteError(err);
  }
}
