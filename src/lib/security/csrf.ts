import { cookies } from "next/headers";
import { NextRequest } from "next/server";
import { CSRF_COOKIE, CSRF_HEADER } from "./csrf-constants";

export { CSRF_COOKIE, CSRF_HEADER };

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/** Paths that intentionally skip CSRF (public auth + secret-protected worker). */
const CSRF_EXEMPT_PREFIXES = [
  "/api/auth/login",
  "/api/auth/register",
  "/api/worker/tick",
];

export function generateCsrfToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

export async function setCsrfCookie(token?: string): Promise<string> {
  const value = token || generateCsrfToken();
  const jar = await cookies();
  jar.set(CSRF_COOKIE, value, {
    httpOnly: false,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 7,
  });
  return value;
}

export async function clearCsrfCookie() {
  const jar = await cookies();
  jar.delete(CSRF_COOKIE);
}

function originAllowed(req: NextRequest | Request): boolean {
  const origin = req.headers.get("origin");
  const referer = req.headers.get("referer");
  const host = req.headers.get("host");
  if (!host) return true;
  const allowedHosts = new Set(
    [
      host,
      process.env.NEXT_PUBLIC_APP_HOST?.trim(),
      "db357.com",
      "www.db357.com",
      "spinlytics-db357.vercel.app",
      "localhost:3000",
      "127.0.0.1:3000",
    ].filter(Boolean) as string[],
  );

  const check = (raw: string | null) => {
    if (!raw) return null;
    try {
      return new URL(raw).host;
    } catch {
      return null;
    }
  };

  const o = check(origin);
  if (o) return allowedHosts.has(o);
  const r = check(referer);
  if (r) return allowedHosts.has(r);
  // Same-origin navigations / server tools may omit Origin+Referer.
  return true;
}

export function shouldCheckCsrf(req: NextRequest | Request, pathname: string) {
  if (SAFE_METHODS.has(req.method.toUpperCase())) return false;
  if (!pathname.startsWith("/api/")) return false;
  if (CSRF_EXEMPT_PREFIXES.some((p) => pathname === p || pathname.startsWith(p + "/"))) {
    return false;
  }
  // Bearer-token API clients skip cookie CSRF (Authorization header present).
  const auth = req.headers.get("authorization");
  if (auth?.startsWith("Bearer ")) return false;
  return true;
}

export function assertCsrf(req: NextRequest | Request): void {
  const url = new URL(req.url);
  if (!shouldCheckCsrf(req, url.pathname)) return;

  if (!originAllowed(req)) {
    throw new CsrfError("Invalid origin");
  }

  const cookieHeader = req.headers.get("cookie") || "";
  const match = cookieHeader.match(
    new RegExp(`(?:^|;\\s*)${CSRF_COOKIE}=([^;]+)`),
  );
  const cookieToken = match?.[1] ? decodeURIComponent(match[1]) : null;
  const headerToken = req.headers.get(CSRF_HEADER);

  if (!cookieToken || !headerToken || cookieToken !== headerToken) {
    throw new CsrfError("CSRF token missing or invalid");
  }
}

export class CsrfError extends Error {
  status = 403;
  constructor(message = "CSRF validation failed") {
    super(message);
  }
}
