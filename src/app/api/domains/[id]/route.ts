import { NextRequest } from "next/server";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { sql, sqlOne } from "@/lib/db";
import { handleRouteError, jsonError, jsonOk } from "@/lib/api";

const patchSchema = z.object({
  monitoring_enabled: z.boolean().optional(),
  url: z.string().min(3).max(500).optional(),
});

async function ownedDomain(userId: string, id: string) {
  return sqlOne<{ id: string; user_id: string }>(
    `SELECT id, user_id FROM domains WHERE id = $1`,
    [id],
  ).then((d) => (d && d.user_id === userId ? d : null));
}

export async function PATCH(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  try {
    const user = await requireUser(req);
    const { id } = await ctx.params;
    const domain = await ownedDomain(user.id, id);
    if (!domain) return jsonError("Domain not found", 404);

    const body = patchSchema.parse(await req.json());
    if (body.monitoring_enabled !== undefined) {
      await sql(`UPDATE domains SET monitoring_enabled = $1 WHERE id = $2`, [
        body.monitoring_enabled,
        id,
      ]);
    }
    if (body.url) {
      let url = body.url.trim();
      if (!/^https?:\/\//i.test(url)) url = `https://${url}`;
      await sql(`UPDATE domains SET url = $1 WHERE id = $2`, [url, id]);
    }

    const updated = await sqlOne(
      `SELECT id, url, status, monitoring_enabled, last_checked_at::text
       FROM domains WHERE id = $1`,
      [id],
    );
    return jsonOk({ domain: updated });
  } catch (err) {
    return handleRouteError(err);
  }
}

export async function DELETE(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  try {
    const user = await requireUser(req);
    const { id } = await ctx.params;
    const domain = await ownedDomain(user.id, id);
    if (!domain) return jsonError("Domain not found", 404);
    await sql(`DELETE FROM domains WHERE id = $1`, [id]);
    return jsonOk({ ok: true });
  } catch (err) {
    return handleRouteError(err);
  }
}
