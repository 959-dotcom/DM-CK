import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/** Hub and DM-CK must stay on this exact token shape. Audience is dmck, not land. */
export const HANDOFF_VERSION = "v1";
export const HANDOFF_ISSUER = "db357-hub";
export const HANDOFF_AUDIENCE = "dmck";
export const HANDOFF_TTL_SECONDS = 60;
export const HANDOFF_CLOCK_SKEW_SECONDS = 15;
export const MIN_HANDOFF_SECRET_LENGTH = 32;
export const MAX_HANDOFF_TOKEN_LENGTH = 2048;

const JTI_PATTERN = /^[A-Za-z0-9_-]{16,64}$/;

/** Lookup only. The handoff route must not insert, update, or delete a user. */
export const HANDOFF_USER_LOOKUP_SQL = `SELECT id, email, role,
            COALESCE(disabled, FALSE) AS disabled
     FROM users
     WHERE lower(email) = $1`;

export type HandoffClaims = {
  iss: typeof HANDOFF_ISSUER;
  aud: typeof HANDOFF_AUDIENCE;
  email: string;
  iat: number;
  exp: number;
  jti: string;
};

export type HandoffAccount = {
  id: string;
  email: string;
  role: string;
  disabled: boolean;
};

export type HandoffDecision =
  | { status: "ok"; account: HandoffAccount; nextPath: "/admin" | "/dashboard" }
  | { status: "missing" | "disabled" | "ambiguous" };

export function readHandoffSecret(value = process.env.DMCK_HANDOFF_SECRET): string | null {
  const secret = (value ?? "").trim();
  if (secret.length < MIN_HANDOFF_SECRET_LENGTH) return null;
  return secret;
}

export function isHandoffEmail(email: string): boolean {
  if (email.length < 3 || email.length > 320) return false;
  if (/[\s\u0000-\u001f\u007f]/.test(email)) return false;
  const at = email.indexOf("@");
  return at > 0 && at === email.lastIndexOf("@") && at < email.length - 1;
}

export function signDmckHandoff(
  rawEmail: string,
  secret: string,
  options?: { nowMs?: number; jti?: string },
): string | null {
  if (secret.trim().length < MIN_HANDOFF_SECRET_LENGTH || secret !== secret.trim()) return null;
  const email = rawEmail.trim().toLowerCase();
  if (!isHandoffEmail(email)) return null;
  const jti = options?.jti ?? "";
  if (options?.jti !== undefined && !JTI_PATTERN.test(jti)) return null;
  const nonce = options?.jti ?? randomJti();
  if (!JTI_PATTERN.test(nonce)) return null;
  const iat = Math.floor((options?.nowMs ?? Date.now()) / 1000);
  const payload: HandoffClaims = {
    iss: HANDOFF_ISSUER,
    aud: HANDOFF_AUDIENCE,
    email,
    iat,
    exp: iat + HANDOFF_TTL_SECONDS,
    jti: nonce,
  };
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const sig = createHmac("sha256", secret).update(`${HANDOFF_VERSION}.${body}`).digest().toString("base64url");
  return `${HANDOFF_VERSION}.${body}.${sig}`;
}

export function verifyDmckHandoff(token: string, secret: string, nowMs = Date.now()): HandoffClaims | null {
  if (secret.trim().length < MIN_HANDOFF_SECRET_LENGTH || secret !== secret.trim()) return null;
  if (typeof token !== "string" || token.length < 20 || token.length > MAX_HANDOFF_TOKEN_LENGTH) return null;
  const parts = token.split(".");
  if (parts.length !== 3 || parts[0] !== HANDOFF_VERSION) return null;
  const [version, body, signature] = parts;
  if (!body || !signature) return null;
  const expected = createHmac("sha256", secret).update(`${version}.${body}`).digest();
  let actual: Buffer;
  try {
    actual = Buffer.from(signature, "base64url");
  } catch {
    return null;
  }
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
  } catch {
    return null;
  }
  const claims = asClaims(parsed);
  if (!claims) return null;
  if (claims.exp - claims.iat !== HANDOFF_TTL_SECONDS) return null;
  const nowSec = Math.floor(nowMs / 1000);
  if (claims.iat > nowSec + HANDOFF_CLOCK_SKEW_SECONDS) return null;
  if (nowSec > claims.exp + HANDOFF_CLOCK_SKEW_SECONDS) return null;
  return claims;
}

export function decideHandoffAccount(rows: HandoffAccount[]): HandoffDecision {
  if (rows.length === 0) return { status: "missing" };
  if (rows.length > 1) return { status: "ambiguous" };
  const row = rows[0];
  if (!row?.id || !row.email) return { status: "missing" };
  const account: HandoffAccount = {
    id: String(row.id),
    email: String(row.email),
    role: String(row.role || "USER"),
    disabled: isDisabled(row.disabled),
  };
  if (account.disabled) return { status: "disabled" };
  return {
    status: "ok",
    account,
    nextPath: account.role === "ADMIN" ? "/admin" : "/dashboard",
  };
}

function asClaims(value: unknown): HandoffClaims | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  if (row.iss !== HANDOFF_ISSUER || row.aud !== HANDOFF_AUDIENCE) return null;
  if (typeof row.email !== "string" || row.email !== row.email.trim().toLowerCase() || !isHandoffEmail(row.email)) {
    return null;
  }
  if (typeof row.iat !== "number" || typeof row.exp !== "number") return null;
  if (!Number.isInteger(row.iat) || !Number.isInteger(row.exp)) return null;
  if (typeof row.jti !== "string" || !JTI_PATTERN.test(row.jti)) return null;
  return {
    iss: HANDOFF_ISSUER,
    aud: HANDOFF_AUDIENCE,
    email: row.email,
    iat: row.iat,
    exp: row.exp,
    jti: row.jti,
  };
}

function isDisabled(value: unknown): boolean {
  return value === true || value === 1 || value === "t" || value === "true";
}

function randomJti(): string {
  return randomBytes(16).toString("base64url");
}

const seenJti = new Map<string, number>();

/** One process remembers a token id until it expires. Other instances still rely on the 60 second lifetime. */
export function consumeHandoffJti(jti: string, expSeconds: number, nowMs = Date.now()): boolean {
  if (!JTI_PATTERN.test(jti)) return false;
  for (const [key, until] of seenJti) {
    if (until <= nowMs) seenJti.delete(key);
  }
  if (seenJti.has(jti)) return false;
  seenJti.set(jti, expSeconds * 1000 + HANDOFF_CLOCK_SKEW_SECONDS * 1000);
  if (seenJti.size > 1000) {
    const oldest = seenJti.keys().next().value;
    if (oldest) seenJti.delete(oldest);
  }
  return true;
}

export function clearHandoffReplayForTests() {
  seenJti.clear();
}
