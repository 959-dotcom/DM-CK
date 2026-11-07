import { NextRequest } from "next/server";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { newId, sql, sqlOne } from "@/lib/db";
import { generatePromptPayQr } from "@/lib/promptpay";
import { handleRouteError, jsonError, jsonOk } from "@/lib/api";

const createSchema = z.object({
  plan_id: z.string().min(1),
});

export async function GET(req: NextRequest) {
  try {
    const user = await requireUser(req);
    const rows = await sql(
      `SELECT t.id, t.plan_id, t.amount::text, t.slip_url, t.payment_status,
              t.qr_ref, t.created_at::text, p.name AS plan_name
       FROM transactions t
       JOIN plans p ON p.id = t.plan_id
       WHERE t.user_id = $1
       ORDER BY t.created_at DESC
       LIMIT 50`,
      [user.id],
    );
    return jsonOk({ transactions: rows });
  } catch (err) {
    return handleRouteError(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    const user = await requireUser(req);
    const body = createSchema.parse(await req.json());
    const plan = await sqlOne<{
      id: string;
      name: string;
      price: string;
      interval_days: number;
    }>(`SELECT id, name, price::text, interval_days FROM plans WHERE id = $1`, [
      body.plan_id,
    ]);
    if (!plan) return jsonError("Plan not found", 404);
    if (Number(plan.price) <= 0) {
      return jsonError("Free plan does not require payment", 400);
    }

    const id = newId("txn");
    const amount = Number(plan.price);
    const qrRef = `SPN${Date.now().toString(36).toUpperCase()}`;
    const qr = await generatePromptPayQr({ amount, ref: qrRef });

    await sql(
      `INSERT INTO transactions (id, user_id, plan_id, amount, payment_status, qr_ref)
       VALUES ($1,$2,$3,$4,'PENDING',$5)`,
      [id, user.id, plan.id, amount, qrRef],
    );

    return jsonOk({
      transaction: {
        id,
        plan_id: plan.id,
        plan_name: plan.name,
        amount,
        payment_status: "PENDING",
        qr_ref: qrRef,
      },
      promptpay: {
        id: qr.promptpayId,
        payload: qr.payload,
        qr_data_url: qr.dataUrl,
      },
    });
  } catch (err) {
    return handleRouteError(err);
  }
}
