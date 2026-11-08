/**
 * ISP block heuristics for Thai networks (AIS / TRUE / DTAC / 3BB / NT).
 *
 * ## What we actually do
 * 1. **DNS** — resolve A/AAAA for the hostname (`dns.promises`). NXDOMAIN /
 *    SERVFAIL → UNKNOWN (not BLOCKED). Known ministry/ISP sinkhole hostnames
 *    in CNAME chains count as BLOCKED.
 * 2. **HTTP(S)** — GET with redirect follow; inspect final URL + body for Thai
 *    ministry / ISP block-page fingerprints (`ถูกระงับ`, `block.go.th`,
 *    `mdes.go.th`, status 451, etc.).
 * 3. **Per-ISP columns** — when HTML/URL names a specific ISP block page we
 *    mark that ISP BLOCKED and leave others from the shared probe. Otherwise
 *    the same probe result is mirrored across AIS/TRUE/DTAC/3BB/NT.
 *
 * ## Honest limitations
 * - This environment has **no residential Thai ISP vantage**. We do not egress
 *   from AIS/TRUE/DTAC/3BB/NT networks. DNS answers come from the host/Vercel
 *   resolver (often Cloudflare/Google), not carrier DNS hijacks that users see
 *   on-net. Some blocks are only visible on-net → false SAFE is possible.
 * - Mirrored statuses are a best-effort public signal, not five independent
 *   ISP measurements. Multi-egress / residential proxies are a future upgrade.
 * - `DEMO_FORCE_BLOCK=1` forces BLOCKED for alert demos.
 */

import dns from "node:dns/promises";
import { newId, sql, sqlOne } from "./db";
import { notifyUserDomainBlock } from "./telegram";

export type IspKey = "ais" | "true" | "dtac" | "tbb" | "nt";
export type IspStatus = "SAFE" | "BLOCKED" | "UNKNOWN" | "ERROR";

export type CheckResult = Record<IspKey, IspStatus>;

export type ProbeDetail = {
  host: string;
  dnsOk: boolean;
  addresses: string[];
  cnames: string[];
  httpStatus: number | null;
  finalUrl: string | null;
  baseStatus: IspStatus;
  result: CheckResult;
  notes: string[];
};

const BLOCK_PATTERNS = [
  /ถูกระงับ/i,
  /website\s*blocked/i,
  /access\s*denied/i,
  /block\.go\.th/i,
  /mdes\.go\.th/i,
  /thaipoliceonline/i,
  /internet\s*safety/i,
  /เนื้อหาผิดกฎหมาย/i,
  /ระงับการเข้าถึง/i,
  /โดเมนนี้ถูกระงับ/i,
  /ตามพระราชบัญญัติ/i,
  /ministry of digital/i,
  /digital economy/i,
];

/** Hostname patterns that indicate ministry / carrier sinkholes. */
const SINKHOLE_HOST_PATTERNS = [
  /block\.go\.th$/i,
  /mdes\.go\.th$/i,
  /internet\.go\.th$/i,
  /blocking\.ais\.co\.th$/i,
  /block\.true\.co\.th$/i,
  /block\.dtac\.co\.th$/i,
  /block\.3bb\.co\.th$/i,
  /block\.ntplc\.co\.th$/i,
  /warning\.dtac\.co\.th$/i,
];

const ISP_HINTS: { isp: IspKey; patterns: RegExp[] }[] = [
  {
    isp: "ais",
    patterns: [/ais\.co\.th/i, /ais fibre/i, /\bais\b.*block/i],
  },
  {
    isp: "true",
    patterns: [/true\.co\.th/i, /trueonline/i, /true internet/i],
  },
  {
    isp: "dtac",
    patterns: [/dtac\.co\.th/i, /\bdtac\b/i],
  },
  {
    isp: "tbb",
    patterns: [/3bb\.co\.th/i, /\b3bb\b/i],
  },
  {
    isp: "nt",
    patterns: [/ntplc\.co\.th/i, /tot\.co\.th/i, /\bnt\s*broadband\b/i],
  },
];

const ISPS: IspKey[] = ["ais", "true", "dtac", "tbb", "nt"];

function hostnameFromUrl(raw: string): string {
  try {
    const withProto = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
    return new URL(withProto).hostname.toLowerCase();
  } catch {
    return raw.replace(/^https?:\/\//i, "").split("/")[0]?.toLowerCase() ?? raw;
  }
}

function normalizeUrl(raw: string): string {
  const trimmed = raw.trim();
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  return `https://${trimmed}`;
}

function looksBlocked(text: string): boolean {
  return BLOCK_PATTERNS.some((re) => re.test(text));
}

function isSinkholeHost(host: string): boolean {
  return SINKHOLE_HOST_PATTERNS.some((re) => re.test(host));
}

async function resolveDns(host: string): Promise<{
  ok: boolean;
  addresses: string[];
  cnames: string[];
  error?: string;
}> {
  const addresses: string[] = [];
  const cnames: string[] = [];
  try {
    try {
      const cn = await dns.resolveCname(host);
      cnames.push(...cn);
    } catch {
      // no CNAME — fine
    }
    try {
      addresses.push(...(await dns.resolve4(host)));
    } catch {
      // ignore
    }
    try {
      addresses.push(...(await dns.resolve6(host)));
    } catch {
      // ignore
    }
    if (addresses.length === 0 && cnames.length === 0) {
      const looked = await dns.lookup(host, { all: true });
      addresses.push(...looked.map((l) => l.address));
    }
    if (addresses.length === 0 && cnames.length === 0) {
      return { ok: false, addresses, cnames, error: "NXDOMAIN or empty" };
    }
    return { ok: true, addresses, cnames };
  } catch (err) {
    return {
      ok: false,
      addresses,
      cnames,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

async function probeHttp(url: string): Promise<{
  status: IspStatus;
  httpStatus: number | null;
  finalUrl: string | null;
  bodySnippet: string;
}> {
  if (process.env.DEMO_FORCE_BLOCK === "1") {
    return {
      status: "BLOCKED",
      httpStatus: 451,
      finalUrl: url,
      bodySnippet: "DEMO_FORCE_BLOCK",
    };
  }

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 12_000);
    const res = await fetch(normalizeUrl(url), {
      method: "GET",
      redirect: "follow",
      signal: controller.signal,
      headers: {
        "User-Agent":
          "SpinlyticsDomainChecker/1.0 (+https://db357.com; Thai ISP monitor)",
        Accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "th-TH,th;q=0.9,en;q=0.8",
      },
    });
    clearTimeout(timer);

    const finalUrl = res.url || url;
    const text = (await res.text().catch(() => "")).slice(0, 80_000);
    let finalHost = "";
    try {
      finalHost = new URL(finalUrl).hostname;
    } catch {
      finalHost = "";
    }

    if (
      res.status === 451 ||
      looksBlocked(finalUrl) ||
      looksBlocked(text) ||
      (finalHost && isSinkholeHost(finalHost))
    ) {
      return {
        status: "BLOCKED",
        httpStatus: res.status,
        finalUrl,
        bodySnippet: text.slice(0, 2_000),
      };
    }
    if (res.status >= 500) {
      return {
        status: "UNKNOWN",
        httpStatus: res.status,
        finalUrl,
        bodySnippet: text.slice(0, 2_000),
      };
    }
    return {
      status: "SAFE",
      httpStatus: res.status,
      finalUrl,
      bodySnippet: text.slice(0, 2_000),
    };
  } catch {
    return {
      status: "ERROR",
      httpStatus: null,
      finalUrl: null,
      bodySnippet: "",
    };
  }
}

function distributeIspStatuses(
  base: IspStatus,
  haystack: string,
): CheckResult {
  const result: CheckResult = {
    ais: base,
    true: base,
    dtac: base,
    tbb: base,
    nt: base,
  };

  if (base !== "BLOCKED") return result;

  // If content clearly names specific ISP(s), prefer marking those BLOCKED
  // and leave unnamed ISPs as UNKNOWN (shared vantage cannot confirm others).
  const hinted = new Set<IspKey>();
  for (const { isp, patterns } of ISP_HINTS) {
    if (patterns.some((re) => re.test(haystack))) hinted.add(isp);
  }
  if (hinted.size > 0 && hinted.size < ISPS.length) {
    for (const isp of ISPS) {
      result[isp] = hinted.has(isp) ? "BLOCKED" : "UNKNOWN";
    }
  }
  return result;
}

export async function probeDomainDetailed(url: string): Promise<ProbeDetail> {
  const host = hostnameFromUrl(url);
  const notes: string[] = [];

  if (process.env.DEMO_FORCE_BLOCK === "1") {
    notes.push("DEMO_FORCE_BLOCK=1");
    const blocked = distributeIspStatuses("BLOCKED", "DEMO_FORCE_BLOCK");
    return {
      host,
      dnsOk: true,
      addresses: [],
      cnames: [],
      httpStatus: 451,
      finalUrl: url,
      baseStatus: "BLOCKED",
      result: blocked,
      notes,
    };
  }

  const dnsResult = await resolveDns(host);
  const sinkholeCname = dnsResult.cnames.some((c) => isSinkholeHost(c));
  if (sinkholeCname) {
    notes.push("CNAME points at known sinkhole host");
  }
  if (!dnsResult.ok) {
    notes.push(`DNS failed: ${dnsResult.error || "unknown"}`);
    const unknown: CheckResult = {
      ais: "UNKNOWN",
      true: "UNKNOWN",
      dtac: "UNKNOWN",
      tbb: "UNKNOWN",
      nt: "UNKNOWN",
    };
    return {
      host,
      dnsOk: false,
      addresses: dnsResult.addresses,
      cnames: dnsResult.cnames,
      httpStatus: null,
      finalUrl: null,
      baseStatus: "UNKNOWN",
      result: unknown,
      notes,
    };
  }

  const http = await probeHttp(url);
  let base = http.status;
  if (sinkholeCname && base !== "BLOCKED") {
    base = "BLOCKED";
    notes.push("Overrode HTTP with sinkhole CNAME → BLOCKED");
  }

  const haystack = `${http.finalUrl || ""}\n${http.bodySnippet}`;
  const result = distributeIspStatuses(base, haystack);
  notes.push(
    "No residential ISP vantage — statuses mirrored from one public DNS+HTTP probe unless ISP-specific fingerprints matched.",
  );

  return {
    host,
    dnsOk: true,
    addresses: dnsResult.addresses,
    cnames: dnsResult.cnames,
    httpStatus: http.httpStatus,
    finalUrl: http.finalUrl,
    baseStatus: base,
    result,
    notes,
  };
}

export async function checkDomainOnce(url: string): Promise<CheckResult> {
  const detail = await probeDomainDetailed(url);
  return detail.result;
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
