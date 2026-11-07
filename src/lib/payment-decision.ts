/**
 * Shared plan/addon payment approve + reject (admin UI + Telegram backup).
 */

import { BillingCycle, parseTelegramChatIds } from "./constants";
import { sql, sqlOne } from "./db";
import { expireAtForCycle } from "./plans";
import {
  notifyAdminPayment,
  notifyUserPaymentDecision,
} from "./telegram";

export type PaymentKind = "plan" | "addon";

export type DecisionResult =
  | {
      ok: true;
      status: "APPROVED" | "REJECTED";
      kind: PaymentKind;
      id: string;
      already?: boolean;
    }
  | { ok: false; error: string; status?: number };

type UserNotifyFields = {
  email: string;
  telegram_chat_id: string | null;
  telegram_chat_ids: string | null;
};

async function loadPlanTxn(id: string) {
  return sqlOne<{
    id: string;
    user_id: string;
    plan_id: string;
    amount: string;
    payment_status: string;
    billing_cycle: BillingCycle | null;
    plan_name: string;
  } & UserNotifyFields>(
    `SELECT t.id, t.user_id, t.plan_id, t.amount::text, t.payment_status, t.billing_cycle,
            u.email, u.telegram_chat_id, u.telegram_chat_ids, p.name AS plan_name
     FROM transactions t
     JOIN users u ON u.id = t.user_id
     JOIN plans p ON p.id = t.plan_id
     WHERE t.id = $1`,
    [id],
  );
}

async function loadAddon(id: string) {
  return sqlOne<{
    id: string;
    user_id: string;
    slots: number;
    amount: string;
    payment_status: string;
  } & UserNotifyFields>(
    `SELECT a.id, a.user_id, a.slots, a.amount::text, a.payment_status,
            u.email, u.telegram_chat_id, u.telegram_chat_ids
     FROM addon_purchases a
     JOIN users u ON u.id = a.user_id
     WHERE a.id = $1`,
    [id],
  );
}

export async function decidePlanPayment(opts: {
  id: string;
  status: "APPROVED" | "REJECTED";
  note?: string | null;
  notifyAdminOnApprove?: boolean;
  via?: "slipok" | "telegram" | "admin";
}): Promise<DecisionResult> {
  const txn = await loadPlanTxn(opts.id);
  if (!txn) return { ok: false, error: "Transaction not found", status: 404 };

  if (txn.payment_status === opts.status) {
    return {
      ok: true,
      status: opts.status,
      kind: "plan",
      id: txn.id,
      already: true,
    };
  }
  if (txn.payment_status !== "PENDING") {
    return {
      ok: false,
      error: `Transaction is ${txn.payment_status}`,
      status: 400,
    };
  }

  const claimed = await sqlOne<{ id: string }>(
    `UPDATE transactions SET payment_status = $1
     WHERE id = $2 AND payment_status = 'PENDING'
     RETURNING id`,
    [opts.status, opts.id],
  );
  if (!claimed) {
    return { ok: false, error: "Transaction already decided", status: 409 };
  }

  const cycle: BillingCycle =
    txn.billing_cycle === "YEARLY" ? "YEARLY" : "MONTHLY";
  const planLabel = `${txn.plan_name} (${cycle})`;

  if (opts.status === "APPROVED") {
    const expireAt = expireAtForCycle(cycle);
    await sql(
      `UPDATE users
       SET subscription_status = 'ACTIVE',
           plan_id = $1,
           plan_expire_at = $2,
           billing_cycle = $3
       WHERE id = $4`,
      [txn.plan_id, expireAt.toISOString(), cycle, txn.user_id],
    );

    if (opts.notifyAdminOnApprove !== false) {
      await notifyAdminPayment({
        email: txn.email,
        planName: planLabel,
        amount: Number(txn.amount),
        transactionId: txn.id,
        mock: false,
        via: opts.via === "telegram" ? "telegram" : opts.via === "admin" ? "admin" : "live",
      });
    }
  }

  await notifyUserPaymentDecision({
    chatId: txn.telegram_chat_id,
    chatIds: parseTelegramChatIds(
      txn.telegram_chat_ids,
      txn.telegram_chat_id,
    ),
    email: txn.email,
    planName: planLabel,
    amount: Number(txn.amount),
    transactionId: txn.id,
    status: opts.status,
    note: opts.note,
  });

  return { ok: true, status: opts.status, kind: "plan", id: txn.id };
}

export async function decideAddonPayment(opts: {
  id: string;
  status: "APPROVED" | "REJECTED";
  note?: string | null;
  notifyAdminOnApprove?: boolean;
  via?: "slipok" | "telegram" | "admin";
}): Promise<DecisionResult> {
  const addon = await loadAddon(opts.id);
  if (!addon) return { ok: false, error: "Addon purchase not found", status: 404 };

  if (addon.payment_status === opts.status) {
    return {
      ok: true,
      status: opts.status,
      kind: "addon",
      id: addon.id,
      already: true,
    };
  }
  if (addon.payment_status !== "PENDING") {
    return {
      ok: false,
      error: `Addon purchase is ${addon.payment_status}`,
      status: 400,
    };
  }

  const claimed = await sqlOne<{ id: string }>(
    `UPDATE addon_purchases SET payment_status = $1
     WHERE id = $2 AND payment_status = 'PENDING'
     RETURNING id`,
    [opts.status, opts.id],
  );
  if (!claimed) {
    return { ok: false, error: "Addon purchase already decided", status: 409 };
  }

  const planLabel = `Extra Domain Slot × ${addon.slots}`;

  if (opts.status === "APPROVED") {
    await sql(
      `UPDATE users
       SET extra_domain_slots = COALESCE(extra_domain_slots, 0) + $1
       WHERE id = $2`,
      [addon.slots, addon.user_id],
    );

    if (opts.notifyAdminOnApprove !== false) {
      await notifyAdminPayment({
        email: addon.email,
        planName: planLabel,
        amount: Number(addon.amount),
        transactionId: addon.id,
        mock: false,
        via: opts.via === "telegram" ? "telegram" : opts.via === "admin" ? "admin" : "live",
      });
    }
  }

  await notifyUserPaymentDecision({
    chatId: addon.telegram_chat_id,
    chatIds: parseTelegramChatIds(
      addon.telegram_chat_ids,
      addon.telegram_chat_id,
    ),
    email: addon.email,
    planName: planLabel,
    amount: Number(addon.amount),
    transactionId: addon.id,
    status: opts.status,
    note: opts.note,
  });

  return { ok: true, status: opts.status, kind: "addon", id: addon.id };
}

export async function decidePayment(opts: {
  kind: PaymentKind;
  id: string;
  status: "APPROVED" | "REJECTED";
  note?: string | null;
  via?: "slipok" | "telegram" | "admin";
}): Promise<DecisionResult> {
  if (opts.kind === "addon") {
    return decideAddonPayment(opts);
  }
  return decidePlanPayment(opts);
}
