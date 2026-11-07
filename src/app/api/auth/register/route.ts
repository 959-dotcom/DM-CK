import { z } from "zod";
import {
  createSessionToken,
  hashPassword,
  setSessionCookie,
} from "@/lib/auth";
import { newId, sql, sqlOne } from "@/lib/db";
import { handleRouteError, jsonError, jsonOk } from "@/lib/api";

const bodySchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  telegram_chat_id: z.string().optional(),
});

export async function POST(req: Request) {
  try {
    const body = bodySchema.parse(await req.json());
    const existing = await sqlOne("SELECT id FROM users WHERE email = $1", [
      body.email.toLowerCase(),
    ]);
    if (existing) return jsonError("Email already registered", 409);

    const id = newId("user");
    const password = await hashPassword(body.password);
    const trialExpire = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000);

    await sql(
      `INSERT INTO users
        (id, email, password, role, telegram_chat_id, subscription_status, plan_id, plan_expire_at)
       VALUES ($1,$2,$3,'USER',$4,'TRIAL','plan_free',$5)`,
      [
        id,
        body.email.toLowerCase(),
        password,
        body.telegram_chat_id || null,
        trialExpire.toISOString(),
      ],
    );

    const token = await createSessionToken({
      id,
      email: body.email.toLowerCase(),
      role: "USER",
    });
    await setSessionCookie(token);

    return jsonOk({
      user: {
        id,
        email: body.email.toLowerCase(),
        role: "USER",
        subscription_status: "TRIAL",
        plan_id: "plan_free",
      },
      token,
    });
  } catch (err) {
    return handleRouteError(err);
  }
}
