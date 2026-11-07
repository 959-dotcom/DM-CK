import { NextRequest } from "next/server";
import { clearSessionCookie } from "@/lib/auth";
import { jsonOk, handleRouteError } from "@/lib/api";
import { assertCsrf } from "@/lib/security/csrf";

export async function POST(req: NextRequest) {
  try {
    // Best-effort CSRF; still clear cookie if missing (logout should work).
    try {
      assertCsrf(req);
    } catch {
      /* allow logout without CSRF to avoid sticky sessions */
    }
    await clearSessionCookie();
    return jsonOk({ ok: true });
  } catch (err) {
    return handleRouteError(err);
  }
}
