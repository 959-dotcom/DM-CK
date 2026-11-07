import { NextResponse } from "next/server";
import { AuthError } from "./auth";
import { CsrfError } from "./security/csrf";

export function jsonOk<T>(data: T, init?: ResponseInit) {
  return NextResponse.json(data, init);
}

export function jsonError(message: string, status = 400, extra?: Record<string, unknown>) {
  return NextResponse.json({ error: message, ...extra }, { status });
}

export function handleRouteError(err: unknown) {
  if (err instanceof AuthError) {
    return jsonError(err.message, err.status);
  }
  if (err instanceof CsrfError) {
    return jsonError(err.message, err.status);
  }
  if (err && typeof err === "object" && "name" in err && (err as { name: string }).name === "ZodError") {
    return jsonError("Invalid request", 400);
  }
  console.error(err);
  return jsonError(
    err instanceof Error ? err.message : "Internal server error",
    500,
  );
}

export function withRateLimitHeaders(
  res: NextResponse,
  info: { remaining: number; resetAt: number; retryAfterSec?: number },
) {
  res.headers.set("X-RateLimit-Remaining", String(Math.max(0, info.remaining)));
  res.headers.set("X-RateLimit-Reset", String(Math.ceil(info.resetAt / 1000)));
  if (info.retryAfterSec && info.retryAfterSec > 0) {
    res.headers.set("Retry-After", String(info.retryAfterSec));
  }
  return res;
}
