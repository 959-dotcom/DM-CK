import { NextRequest, NextResponse } from "next/server";
import { applySecurityHeaders } from "@/lib/security/headers";
import { ensureRequestId, REQUEST_ID_HEADER } from "@/lib/security/request-id";
import { isSuspiciousRequest } from "@/lib/security/waf";
import { COOKIE_NAME } from "@/lib/session-cookie";

/**
 * Next.js 16 Proxy (formerly middleware).
 * - Request ID
 * - Basic scanner blocks
 * - Soft admin gate for /admin pages (JWT role claim — APIs still use requireAdmin)
 * - Security headers on responses
 */
export function proxy(request: NextRequest) {
  const requestId = ensureRequestId(request.headers.get(REQUEST_ID_HEADER));
  const { pathname } = request.nextUrl;

  const suspicious = isSuspiciousRequest({
    pathname,
    userAgent: request.headers.get("user-agent"),
  });
  if (suspicious.block) {
    const blocked = NextResponse.json(
      { error: "Forbidden" },
      { status: 403 },
    );
    blocked.headers.set(REQUEST_ID_HEADER, requestId);
    applySecurityHeaders(blocked.headers);
    console.warn("[waf]", suspicious.reason, pathname, requestId);
    return blocked;
  }

  // Admin UI soft gate — cookie JWT role claim (verified again in API/layout).
  if (pathname.startsWith("/admin")) {
    const token = request.cookies.get(COOKIE_NAME)?.value;
    if (!token) {
      const login = NextResponse.redirect(new URL("/login?next=/admin", request.url));
      login.headers.set(REQUEST_ID_HEADER, requestId);
      applySecurityHeaders(login.headers);
      return login;
    }
    // Decode payload without verify (edge-safe optimistic check). Full verify in requireAdmin.
    try {
      const parts = token.split(".");
      if (parts.length < 2) throw new Error("bad token");
      const json = JSON.parse(
        atob(parts[1]!.replace(/-/g, "+").replace(/_/g, "/")),
      ) as { role?: string; exp?: number };
      if (json.exp && json.exp * 1000 < Date.now()) {
        const login = NextResponse.redirect(
          new URL("/login?next=/admin", request.url),
        );
        login.headers.set(REQUEST_ID_HEADER, requestId);
        applySecurityHeaders(login.headers);
        return login;
      }
      if (json.role !== "ADMIN") {
        const forbidden = NextResponse.redirect(new URL("/dashboard", request.url));
        forbidden.headers.set(REQUEST_ID_HEADER, requestId);
        applySecurityHeaders(forbidden.headers);
        return forbidden;
      }
    } catch {
      const login = NextResponse.redirect(new URL("/login?next=/admin", request.url));
      login.headers.set(REQUEST_ID_HEADER, requestId);
      applySecurityHeaders(login.headers);
      return login;
    }
  }

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set(REQUEST_ID_HEADER, requestId);

  const response = NextResponse.next({
    request: { headers: requestHeaders },
  });
  response.headers.set(REQUEST_ID_HEADER, requestId);
  applySecurityHeaders(response.headers);
  return response;
}

export const config = {
  matcher: [
    /*
     * Match all paths except static assets / image optimizer.
     */
    "/((?!_next/static|_next/image|favicon.ico|uploads/).*)",
  ],
};
