import { z } from "zod";
import {
  createSessionToken,
  setSessionCookie,
  verifyPassword,
} from "@/lib/auth";
import { sqlOne } from "@/lib/db";
import { handleRouteError, jsonError, jsonOk } from "@/lib/api";

const bodySchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

export async function POST(req: Request) {
  try {
    const body = bodySchema.parse(await req.json());
    const user = await sqlOne<{
      id: string;
      email: string;
      password: string;
      role: string;
      subscription_status: string;
      plan_id: string | null;
    }>(
      `SELECT id, email, password, role, subscription_status, plan_id
       FROM users WHERE email = $1`,
      [body.email.toLowerCase()],
    );
    if (!user) return jsonError("Invalid email or password", 401);

    const ok = await verifyPassword(body.password, user.password);
    if (!ok) return jsonError("Invalid email or password", 401);

    const token = await createSessionToken({
      id: user.id,
      email: user.email,
      role: user.role,
    });
    await setSessionCookie(token);

    return jsonOk({
      user: {
        id: user.id,
        email: user.email,
        role: user.role,
        subscription_status: user.subscription_status,
        plan_id: user.plan_id,
      },
      token,
    });
  } catch (err) {
    return handleRouteError(err);
  }
}
