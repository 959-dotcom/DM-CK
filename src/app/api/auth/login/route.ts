import { z } from "zod";
import {
  createSessionToken,
  setSessionCookie,
  verifyPassword,
} from "@/lib/auth";
import { sqlOne } from "@/lib/db";
import { handleRouteError, jsonError, jsonOk, withRateLimitHeaders } from "@/lib/api";
import {
  clientIp,
  RATE_PRESETS,
  rateLimit,
} from "@/lib/security/rate-limit";
import {
  getLockout,
  recordLoginAttempt,
  sleep,
} from "@/lib/security/lockout";

const bodySchema = z.object({
  email: z.string().email().max(320),
  password: z.string().min(1).max(200),
});

export async function POST(req: Request) {
  try {
    const ip = clientIp(req);
    const rl = rateLimit({
      key: `login:${ip}`,
      ...RATE_PRESETS.login,
    });
    if (!rl.ok) {
      const res = jsonError("Too many login attempts", 429, {
        retryAfterSec: rl.retryAfterSec,
      });
      return withRateLimitHeaders(res, rl);
    }

    const body = bodySchema.parse(await req.json());
    const email = body.email.toLowerCase();

    const lock = await getLockout(email);
    if (lock.locked) {
      await sleep(Math.min(lock.delayMs, 2000));
      return jsonError("Account temporarily locked. Try again later.", 429, {
        retryAfterSec: lock.retryAfterSec,
      });
    }
    if (lock.delayMs > 0) {
      await sleep(Math.min(lock.delayMs, 5000));
    }

    const user = await sqlOne<{
      id: string;
      email: string;
      password: string;
      role: string;
      subscription_status: string;
      plan_id: string | null;
      disabled: boolean;
    }>(
      `SELECT id, email, password, role, subscription_status, plan_id,
              COALESCE(disabled, FALSE) AS disabled
       FROM users WHERE email = $1`,
      [email],
    );

    if (!user || user.disabled) {
      await recordLoginAttempt({ email, ip, success: false });
      return jsonError("Invalid email or password", 401);
    }

    const ok = await verifyPassword(body.password, user.password);
    if (!ok) {
      await recordLoginAttempt({ email, ip, success: false });
      return jsonError("Invalid email or password", 401);
    }

    await recordLoginAttempt({ email, ip, success: true });

    const token = await createSessionToken({
      id: user.id,
      email: user.email,
      role: user.role,
    });
    await setSessionCookie(token);

    const res = jsonOk({
      user: {
        id: user.id,
        email: user.email,
        role: user.role,
        subscription_status: user.subscription_status,
        plan_id: user.plan_id,
      },
      token,
    });
    return withRateLimitHeaders(res, rl);
  } catch (err) {
    return handleRouteError(err);
  }
}
