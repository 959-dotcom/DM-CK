import { NextRequest } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { sqlOne } from "@/lib/db";
import { handleRouteError, jsonError, jsonOk } from "@/lib/api";

export async function GET(req: NextRequest) {
  try {
    const user = await getCurrentUser(req);
    if (!user) return jsonError("Unauthorized", 401);

    const plan = user.plan_id
      ? await sqlOne<{
          id: string;
          name: string;
          price: string;
          max_domains: number;
          interval_days: number;
          check_interval_minutes: number;
        }>(
          `SELECT id, name, price::text, max_domains, interval_days, check_interval_minutes
           FROM plans WHERE id = $1`,
          [user.plan_id],
        )
      : null;

    const domainCount = await sqlOne<{ count: number }>(
      `SELECT count(*)::int AS count FROM domains WHERE user_id = $1`,
      [user.id],
    );

    return jsonOk({
      user,
      plan,
      domain_count: domainCount?.count ?? 0,
    });
  } catch (err) {
    return handleRouteError(err);
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const user = await getCurrentUser(req);
    if (!user) return jsonError("Unauthorized", 401);
    const body = (await req.json()) as { telegram_chat_id?: string };
    await (
      await import("@/lib/db")
    ).sql(`UPDATE users SET telegram_chat_id = $1 WHERE id = $2`, [
      body.telegram_chat_id || null,
      user.id,
    ]);
    return jsonOk({ ok: true });
  } catch (err) {
    return handleRouteError(err);
  }
}
