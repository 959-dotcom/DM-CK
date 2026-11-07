import { NextRequest } from "next/server";
import { z } from "zod";
import { cookies } from "next/headers";
import { getCurrentUser, maybeRefreshSession } from "@/lib/auth";
import {
  parseTelegramChatIds,
  serializeTelegramChatIds,
} from "@/lib/constants";
import { sql } from "@/lib/db";
import { domainQuotaForUser, getPlanById } from "@/lib/plans";
import { handleRouteError, jsonError, jsonOk } from "@/lib/api";
import { assertCsrf, CSRF_COOKIE, setCsrfCookie } from "@/lib/security/csrf";

const patchSchema = z
  .object({
    telegram_chat_id: z.string().max(64).nullable().optional(),
    telegram_chat_ids: z.array(z.string().min(1).max(64)).max(99).optional(),
  })
  .refine(
    (v) => v.telegram_chat_id !== undefined || v.telegram_chat_ids !== undefined,
    { message: "Provide telegram_chat_id or telegram_chat_ids" },
  );

export async function GET(req: NextRequest) {
  try {
    const user = await getCurrentUser(req);
    if (!user) return jsonError("Unauthorized", 401);

    const jar = await cookies();
    if (!jar.get(CSRF_COOKIE)?.value) {
      await setCsrfCookie();
    }

    const refreshed = await maybeRefreshSession(req);

    const plan = user.plan_id ? await getPlanById(user.plan_id) : null;
    const quota = await domainQuotaForUser(user.id);
    const chatIds = parseTelegramChatIds(
      user.telegram_chat_ids,
      user.telegram_chat_id,
    );

    return jsonOk({
      user: {
        ...user,
        telegram_chat_ids: chatIds,
      },
      plan: plan
        ? {
            id: plan.id,
            name: plan.name,
            code: plan.code,
            price: plan.price,
            price_monthly: plan.price_monthly,
            price_yearly: plan.price_yearly,
            max_domains: plan.max_domains,
            interval_days: plan.interval_days,
            check_interval_minutes: plan.check_interval_minutes,
            history_days: plan.history_days,
            max_telegram_groups: plan.max_telegram_groups,
            badge: plan.badge,
          }
        : null,
      domain_count: quota.used,
      domain_quota: quota,
      refreshed: Boolean(refreshed),
    });
  } catch (err) {
    return handleRouteError(err);
  }
}

export async function PATCH(req: NextRequest) {
  try {
    assertCsrf(req);
    const user = await getCurrentUser(req);
    if (!user) return jsonError("Unauthorized", 401);
    const body = patchSchema.parse(await req.json());

    const plan = user.plan_id ? await getPlanById(user.plan_id) : null;
    const maxGroups = plan?.max_telegram_groups ?? 1;

    let ids: string[];
    if (body.telegram_chat_ids) {
      ids = body.telegram_chat_ids.map((s) => s.trim()).filter(Boolean);
    } else if (body.telegram_chat_id === null) {
      ids = [];
    } else {
      ids = body.telegram_chat_id?.trim() ? [body.telegram_chat_id.trim()] : [];
    }

    if (ids.length > maxGroups) {
      return jsonError(
        `Plan allows up to ${maxGroups} Telegram group${maxGroups === 1 ? "" : "s"}. Upgrade for more.`,
        403,
      );
    }

    const serialized = serializeTelegramChatIds(ids);
    const primary = ids[0] ?? null;

    await sql(
      `UPDATE users SET telegram_chat_id = $1, telegram_chat_ids = $2 WHERE id = $3`,
      [primary, serialized, user.id],
    );
    return jsonOk({ ok: true, telegram_chat_ids: ids });
  } catch (err) {
    return handleRouteError(err);
  }
}
