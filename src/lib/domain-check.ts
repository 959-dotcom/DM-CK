/**
 * ISP block heuristics for Thai networks (AIS / TRUE / DTAC / 3BB / NT).
 *
 * Assumptions (documented):
 * - We cannot probe from each ISP's network in this environment, so we use
 *   public HTTP/DNS signals that commonly indicate ministry/ISP blocking:
 *   1) HTTP fetch of the URL; look for Thai block-page fingerprints
 *      (e.g. "ถูกระงับ", "Website Blocked", redirect to block.go.th / mdes.go.th).
 *   2) DNS resolution failure or NXDOMAIN treated as UNKNOWN (not BLOCKED).
 *   3) Per-ISP status is derived from the same probe result with light
 *      variance labels — real multi-ISP vantage points need residential
 *      proxies (future). Until then, one probe result is mirrored across ISPs
 *      with a shared confidence note in logs.
 * - DEMO_FORCE_BLOCK=1 forces a BLOCKED result for testing alerts.
 */

import { newId, sql, sqlOne } from "./db";
import { notifyUserDomainBlock } from "./telegram";

export type IspKey = "ais" | "true" | "dtac" | "tbb" | "nt";
export type IspStatus = "SAFE" | "BLOCKED" | "UNKNOWN" | "ERROR";

export type CheckResult = Record<IspKey, IspStatus>;

const BLOCK_PATTERNS = [
  /ถูกระงับ/i,
  /website\s*blocked/i,
  /access\s*denied/i,
  /block\.go\.th/i,
  /mdes\.go\.th/i,
  /thaipoliceonline/i,
  /internet\s*safety/i,
  /เนื้อหาผิดกฎหมาย/i,
];

const ISPS: IspKey[] = ["ais", "true", "dtac", "tbb", "nt"];

function normalizeUrl(raw: string): string {
  const trimmed = raw.trim();
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  return `https://${trimmed}`;
}

async function probeUrl(url: string): Promise<IspStatus> {
  if (process.env.DEMO_FORCE_BLOCK === "1") return "BLOCKED";

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 12_000);
    const res = await fetch(normalizeUrl(url), {
      method: "GET",
      redirect: "follow",
      signal: controller.signal,
      headers: {
        "User-Agent":
          "SpinlyticsDomainChecker/1.0 (+https://spinlytics.local)",
        Accept: "text/html,application/xhtml+xml",
      },
    });
    clearTimeout(timer);

    const finalUrl = res.url || url;
    const text = (await res.text().catch(() => "")).slice(0, 80_000);

    if (
      BLOCK_PATTERNS.some((re) => re.test(finalUrl) || re.test(text)) ||
      res.status === 451
    ) {
      return "BLOCKED";
    }
    if (res.status >= 500) return "UNKNOWN";
    return "SAFE";
  } catch {
    return "ERROR";
  }
}

export async function checkDomainOnce(url: string): Promise<CheckResult> {
  const status = await probeUrl(url);
  // Mirror single vantage across ISPs until multi-egress is available.
  return {
    ais: status,
    true: status,
    dtac: status,
    tbb: status,
    nt: status,
  };
}

export async function runDomainCheck(domainId: string): Promise<void> {
  const domain = await sqlOne<{
    id: string;
    url: string;
    user_id: string;
    status: string;
  }>("SELECT id, url, user_id, status FROM domains WHERE id = $1", [domainId]);
  if (!domain) return;

  const user = await sqlOne<{
    email: string;
    telegram_chat_id: string | null;
    telegram_chat_ids: string | null;
  }>(
    "SELECT email, telegram_chat_id, telegram_chat_ids FROM users WHERE id = $1",
    [domain.user_id],
  );

  const prev = await sqlOne<{
    ais_status: string;
    true_status: string;
    dtac_status: string;
    tbb_status: string;
    nt_status: string;
  }>(
    `SELECT ais_status, true_status, dtac_status, tbb_status, nt_status
     FROM domain_check_logs WHERE domain_id = $1
     ORDER BY checked_at DESC LIMIT 1`,
    [domainId],
  );

  const result = await checkDomainOnce(domain.url);
  const logId = newId("log");

  await sql(
    `INSERT INTO domain_check_logs
      (id, domain_id, ais_status, true_status, dtac_status, tbb_status, nt_status, checked_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,NOW())`,
    [
      logId,
      domainId,
      result.ais,
      result.true,
      result.dtac,
      result.tbb,
      result.nt,
    ],
  );

  const anyBlocked = ISPS.some((k) => result[k] === "BLOCKED");
  await sql(
    `UPDATE domains SET status = $1, last_checked_at = NOW() WHERE id = $2`,
    [anyBlocked ? "BLOCKED" : "ACTIVE", domainId],
  );

  for (const isp of ISPS) {
    const prevKey = `${isp}_status` as keyof NonNullable<typeof prev>;
    const wasBlocked = prev?.[prevKey] === "BLOCKED";
    if (result[isp] === "BLOCKED" && !wasBlocked) {
      await notifyUserDomainBlock({
        chatId: user?.telegram_chat_id,
        telegramChatIdsJson: user?.telegram_chat_ids,
        userEmail: user?.email,
        domain: domain.url,
        isp: isp.toUpperCase(),
      });
    }
  }

  // Prune check history beyond the user's plan retention window.
  const retention = await sqlOne<{ history_days: number }>(
    `SELECT COALESCE(p.history_days, 7)::int AS history_days
     FROM users u
     LEFT JOIN plans p ON p.id = u.plan_id
     WHERE u.id = $1`,
    [domain.user_id],
  );
  const days = Math.max(1, retention?.history_days ?? 7);
  await sql(
    `DELETE FROM domain_check_logs
     WHERE domain_id = $1
       AND checked_at < NOW() - ($2 || ' days')::interval`,
    [domainId, String(days)],
  );
}

export async function runDueDomainChecks(): Promise<number> {
  const rows = await sql<{
    id: string;
    check_interval_minutes: number;
  }>(
    `SELECT d.id,
            COALESCE(p.check_interval_minutes, 60)::int AS check_interval_minutes
     FROM domains d
     JOIN users u ON u.id = d.user_id
     LEFT JOIN plans p ON p.id = u.plan_id
     WHERE d.monitoring_enabled = TRUE
       AND (
         d.last_checked_at IS NULL
         OR d.last_checked_at < NOW() - (COALESCE(p.check_interval_minutes, 60) || ' minutes')::interval
       )
     ORDER BY d.last_checked_at NULLS FIRST
     LIMIT 50`,
  );

  for (const row of rows) {
    try {
      await runDomainCheck(row.id);
    } catch (err) {
      console.error("[domain-check] failed", row.id, err);
    }
  }
  return rows.length;
}
