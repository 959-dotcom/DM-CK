import { NextRequest } from "next/server";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { newId, sql } from "@/lib/db";
import { runDomainCheck } from "@/lib/domain-check";
import { parseBulkDomainText } from "@/lib/domain-url";
import { domainQuotaForUser } from "@/lib/plans";
import { handleRouteError, jsonError, jsonOk, withRateLimitHeaders } from "@/lib/api";
import { assertCsrf } from "@/lib/security/csrf";
import {
  clientIp,
  RATE_PRESETS,
  rateLimit,
} from "@/lib/security/rate-limit";

const bulkSchema = z.object({
  text: z.string().min(1).max(100_000),
});

export async function POST(req: NextRequest) {
  try {
    assertCsrf(req);
    const ip = clientIp(req);
    const rl = rateLimit({ key: `domains-bulk:${ip}`, ...RATE_PRESETS.api });
    if (!rl.ok) {
      return withRateLimitHeaders(
        jsonError("Too many requests", 429, { retryAfterSec: rl.retryAfterSec }),
        rl,
      );
    }

    const user = await requireUser(req);
    const body = bulkSchema.parse(await req.json());
    const parsed = parseBulkDomainText(body.text);

    const quota = await domainQuotaForUser(user.id);
    const remaining = Math.max(0, quota.total_slots - quota.used);

    if (remaining <= 0) {
      return withRateLimitHeaders(
        jsonError(
          `Domain quota reached (${quota.total_slots} = ${quota.max_domains} plan + ${quota.extra_domain_slots} extra). Upgrade or buy Extra Domain slots.`,
          403,
          {
            quota,
            invalid: parsed.invalid,
            duplicatesInInput: parsed.duplicatesInInput,
          },
        ),
        rl,
      );
    }

    // Existing hosts for this user (normalized)
    const existing = await sql<{ url: string }>(
      `SELECT url FROM domains WHERE user_id = $1`,
      [user.id],
    );
    const existingHosts = new Set(
      existing.map((r) => {
        try {
          return new URL(
            /^https?:\/\//i.test(r.url) ? r.url : `https://${r.url}`,
          ).hostname.toLowerCase();
        } catch {
          return r.url.toLowerCase();
        }
      }),
    );

    const alreadyOwned: string[] = [];
    const toInsert = [];
    for (const v of parsed.valid) {
      if (existingHosts.has(v.host)) {
        alreadyOwned.push(v.host);
        continue;
      }
      toInsert.push(v);
    }

    const accepted = toInsert.slice(0, remaining);
    const skippedQuota = toInsert.slice(remaining).map((v) => v.host);

    const created: { id: string; url: string }[] = [];
    for (const item of accepted) {
      const id = newId("dom");
      await sql(
        `INSERT INTO domains (id, user_id, url, status, monitoring_enabled)
         VALUES ($1,$2,$3,'ACTIVE',TRUE)`,
        [id, user.id, item.url],
      );
      created.push({ id, url: item.url });
      existingHosts.add(item.host);
      runDomainCheck(id).catch((err) =>
        console.error("[domains/bulk] initial check failed", err),
      );
    }

    return withRateLimitHeaders(
      jsonOk({
        created,
        createdCount: created.length,
        invalid: parsed.invalid,
        duplicatesInInput: parsed.duplicatesInInput,
        alreadyOwned,
        skippedQuota,
        quota: {
          ...quota,
          used: quota.used + created.length,
          remaining: Math.max(0, remaining - created.length),
        },
      }),
      rl,
    );
  } catch (err) {
    return handleRouteError(err);
  }
}
