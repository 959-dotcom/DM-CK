/**
 * Domain / URL parsing for single + bulk dashboard input.
 * Strips http(s)://, trims whitespace, validates host, normalizes to https://host.
 */

export type ParsedDomain = {
  ok: true;
  input: string;
  host: string;
  url: string;
};

export type InvalidDomain = {
  ok: false;
  input: string;
  error: string;
};

export type DomainParseResult = ParsedDomain | InvalidDomain;

const MAX_INPUT_LEN = 500;

function isIpv4(host: string): boolean {
  const parts = host.split(".");
  if (parts.length !== 4) return false;
  return parts.every((p) => {
    if (!/^\d{1,3}$/.test(p)) return false;
    const n = Number(p);
    return n >= 0 && n <= 255;
  });
}

function isValidHostname(host: string): boolean {
  if (!host || host.length > 253) return false;
  if (host === "localhost") return true;
  if (isIpv4(host)) return true;
  // Reject spaces / illegal chars early
  if (/[^a-z0-9.-]/i.test(host)) return false;
  const labels = host.split(".");
  if (labels.length < 2) return false;
  return labels.every((label) => {
    if (label.length < 1 || label.length > 63) return false;
    if (label.startsWith("-") || label.endsWith("-")) return false;
    return /^[a-z0-9-]+$/i.test(label);
  });
}

/** Parse one line / value into a normalized https://host URL. */
export function parseDomainInput(raw: string): DomainParseResult {
  const input = raw ?? "";
  let s = input.trim();
  if (!s) {
    return { ok: false, input, error: "ว่างเปล่า / empty" };
  }
  if (s.length > MAX_INPUT_LEN) {
    return { ok: false, input, error: "ยาวเกินกำหนด (max 500)" };
  }

  // Strip scheme
  s = s.replace(/^https?:\/\//i, "");
  // Strip credentials if pasted
  s = s.replace(/^[^/@]+@/, "");
  // Take host part before path / query / fragment / port-only noise
  // Allow optional port then path
  const hostPortPath = s.split(/[/?#]/)[0] ?? "";
  const hostOnly = hostPortPath.split(":")[0]?.trim().toLowerCase() ?? "";

  if (!hostOnly) {
    return { ok: false, input, error: "ไม่พบโฮสต์ / missing host" };
  }
  if (!isValidHostname(hostOnly)) {
    return {
      ok: false,
      input,
      error: `โฮสต์ไม่ถูกต้อง / invalid host: ${hostOnly}`,
    };
  }

  // Reject obviously non-domain placeholders
  if (hostOnly === "example" || hostOnly.endsWith(".local")) {
    // .local allowed for lab; example bare rejected above by TLD rule
  }

  const url = `https://${hostOnly}`;
  try {
    // Final URL constructor check
    const u = new URL(url);
    if (!u.hostname) {
      return { ok: false, input, error: "URL ไม่ถูกต้อง" };
    }
  } catch {
    return { ok: false, input, error: "URL ไม่ถูกต้อง / invalid URL" };
  }

  return { ok: true, input, host: hostOnly, url };
}

export type BulkParseOutcome = {
  valid: ParsedDomain[];
  invalid: InvalidDomain[];
  /** Duplicate lines within the paste (kept once in valid). */
  duplicatesInInput: string[];
};

/** Split newline / comma / semicolon separated paste into parsed domains. */
export function parseBulkDomainText(text: string): BulkParseOutcome {
  const lines = text
    .split(/[\n\r,;]+/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !l.startsWith("#"));

  const seen = new Set<string>();
  const valid: ParsedDomain[] = [];
  const invalid: InvalidDomain[] = [];
  const duplicatesInInput: string[] = [];

  for (const line of lines) {
    const parsed = parseDomainInput(line);
    if (!parsed.ok) {
      invalid.push(parsed);
      continue;
    }
    if (seen.has(parsed.host)) {
      duplicatesInInput.push(parsed.input);
      continue;
    }
    seen.add(parsed.host);
    valid.push(parsed);
  }

  return { valid, invalid, duplicatesInInput };
}
