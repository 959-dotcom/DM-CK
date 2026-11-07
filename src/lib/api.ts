import { NextResponse } from "next/server";
import { AuthError } from "./auth";

export function jsonOk<T>(data: T, init?: ResponseInit) {
  return NextResponse.json(data, init);
}

export function jsonError(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

export function handleRouteError(err: unknown) {
  if (err instanceof AuthError) {
    return jsonError(err.message, err.status);
  }
  console.error(err);
  return jsonError(
    err instanceof Error ? err.message : "Internal server error",
    500,
  );
}
