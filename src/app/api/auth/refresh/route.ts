import { NextRequest } from "next/server";
import {
  createSessionToken,
  getCurrentUser,
  setSessionCookie,
} from "@/lib/auth";
import { handleRouteError, jsonError, jsonOk } from "@/lib/api";
import { assertCsrf } from "@/lib/security/csrf";
import {
  clientIp,
  RATE_PRESETS,
  rateLimit,
} from "@/lib/security/rate-limit";

export async function POST(req: NextRequest) {
  try {
    assertCsrf(req);
    const ip = clientIp(req);
    const rl = rateLimit({ key: `refresh:${ip}`, ...RATE_PRESETS.auth });
    if (!rl.ok) return jsonError("Too many requests", 429);

    const user = await getCurrentUser(req);
    if (!user) return jsonError("Unauthorized", 401);

    const token = await createSessionToken({
      id: user.id,
      email: user.email,
      role: user.role,
    });
    await setSessionCookie(token);
    return jsonOk({ ok: true, token });
  } catch (err) {
    return handleRouteError(err);
  }
}
