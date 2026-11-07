import { z } from "zod";
import {
  createSessionToken,
  hashPassword,
  setSessionCookie,
} from "@/lib/auth";
import { newId, sql, sqlOne } from "@/lib/db";
import { handleRouteError, jsonError, jsonOk, withRateLimitHeaders } from "@/lib/api";
import {
  clientIp,
  RATE_PRESETS,
  rateLimit,
} from "@/lib/security/rate-limit";
import { assertCsrf } from "@/lib/security/csrf";

const bodySchema = z.object({
  email: z.string().email().max(320),
  password: z.string().min(8).max(200),
  telegram_chat_id: z.string().max(64).optional(),
});

export async function POST(req: Request) {
  try {
    // Register is CSRF-exempt by design (no session yet), but still rate-limited.
    void assertCsrf;
    const ip = clientIp(req);
    const rl = rateLimit({
      key: `register:${ip}`,
      ...RATE_PRESETS.auth,
    });
    if (!rl.ok) {
      return withRateLimitHeaders(
        jsonError("Too many registration attempts", 429, {
          retryAfterSec: rl.retryAfterSec,
        }),
        rl,
      );
    }

    const body = bodySchema.parse(await req.json());
    const existing = await sqlOne("SELECT id FROM users WHERE email = $1", [
      body.email.toLowerCase(),
    ]);
    if (existing) return jsonError("Email already registered", 409);

    const id = newId("user");
    const password = await hashPassword(body.password);
    const trialExpire = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000);

    const tg = body.telegram_chat_id?.trim() || null;
    await sql(
      `INSERT INTO users
        (id, email, password, role, telegram_chat_id, telegram_chat_ids,
         subscription_status, plan_id, plan_expire_at, extra_domain_slots, disabled)
       VALUES ($1,$2,$3,'USER',$4,$5,'TRIAL','plan_free',$6,0,FALSE)`,
      [
        id,
        body.email.toLowerCase(),
        password,
        tg,
        tg ? JSON.stringify([tg]) : "[]",
        trialExpire.toISOString(),
      ],
    );

    const token = await createSessionToken({
      id,
      email: body.email.toLowerCase(),
      role: "USER",
    });
    await setSessionCookie(token);

    return withRateLimitHeaders(
      jsonOk({
        user: {
          id,
          email: body.email.toLowerCase(),
          role: "USER",
          subscription_status: "TRIAL",
          plan_id: "plan_free",
        },
        token,
      }),
      rl,
    );
  } catch (err) {
    return handleRouteError(err);
  }
}
