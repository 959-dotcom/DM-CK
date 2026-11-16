import { NextResponse, type NextRequest } from "next/server";
import { ACCESS_MAX_AGE_SEC, createSessionToken } from "@/lib/auth";
import { sql } from "@/lib/db";
import { handoffStopPage, type HandoffStop } from "@/lib/handoffPage";
import {
  consumeHandoffJti,
  decideHandoffAccount,
  HANDOFF_USER_LOOKUP_SQL,
  readHandoffSecret,
  verifyDmckHandoff,
  type HandoffAccount,
} from "@/lib/hubHandoff";
import { generateCsrfToken } from "@/lib/security/csrf";
import { CSRF_COOKIE } from "@/lib/security/csrf-constants";
import { clientIp, RATE_PRESETS, rateLimit } from "@/lib/security/rate-limit";
import { COOKIE_NAME } from "@/lib/session-cookie";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const STATUS: Record<HandoffStop, number> = {
  direct: 200,
  invalid: 401,
  missing: 404,
  ambiguous: 409,
  disabled: 403,
  unavailable: 503,
  session: 502,
  limited: 429,
};

function stop(reason: HandoffStop) {
  return new NextResponse(handoffStopPage(reason), {
    status: STATUS[reason],
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
      "referrer-policy": "no-referrer",
      "x-robots-tag": "noindex",
    },
  });
}

export function GET() {
  return stop("direct");
}

export async function POST(request: NextRequest) {
  const secret = readHandoffSecret();
  if (!secret) return stop("unavailable");

  const ip = clientIp(request);
  const rl = rateLimit({ key: `hub-handoff:${ip}`, ...RATE_PRESETS.login });
  if (!rl.ok) return stop("limited");

  let token = "";
  try {
    const form = await request.formData();
    const value = form.get("token");
    token = typeof value === "string" ? value : "";
  } catch {
    return stop("invalid");
  }

  const claims = verifyDmckHandoff(token, secret);
  if (!claims) return stop("invalid");
  if (!consumeHandoffJti(claims.jti, claims.exp)) return stop("invalid");

  let rows: HandoffAccount[];
  try {
    rows = await sql<HandoffAccount>(HANDOFF_USER_LOOKUP_SQL, [claims.email]);
  } catch (error) {
    console.error("[hub-handoff] lookup failed", error instanceof Error ? error.name : "error");
    return stop("unavailable");
  }

  const decision = decideHandoffAccount(rows);
  if (decision.status !== "ok") return stop(decision.status);

  try {
    const session = await createSessionToken({
      id: decision.account.id,
      email: decision.account.email,
      role: decision.account.role,
    });
    const response = NextResponse.redirect(new URL(decision.nextPath, request.url), 303);
    response.headers.set("cache-control", "no-store");
    response.headers.set("referrer-policy", "no-referrer");
    const secure = process.env.NODE_ENV === "production";
    response.cookies.set(COOKIE_NAME, session, {
      httpOnly: true,
      sameSite: "lax",
      secure,
      path: "/",
      maxAge: ACCESS_MAX_AGE_SEC,
    });
    response.cookies.set(CSRF_COOKIE, generateCsrfToken(), {
      httpOnly: false,
      sameSite: "lax",
      secure,
      path: "/",
      maxAge: 60 * 60 * 24 * 7,
    });
    return response;
  } catch (error) {
    console.error("[hub-handoff] session failed", error instanceof Error ? error.name : "error");
    return stop("session");
  }
}
