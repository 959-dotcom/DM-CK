/**
 * Telegram Bot API helpers. No-ops with a console note when tokens are missing.
 */

import { parseTelegramChatIds } from "./constants";

async function sendMessage(chatId: string, text: string): Promise<boolean> {
  const token = process.env.TELEGRAM_BOT_TOKEN?.trim();
  if (!token || !chatId) {
    console.info("[telegram:mock]", chatId || "(no chat)", text.slice(0, 200));
    return false;
  }
  try {
    const res = await fetch(
      `https://api.telegram.org/bot${token}/sendMessage`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: chatId,
          text,
          parse_mode: "HTML",
          disable_web_page_preview: true,
        }),
      },
    );
    return res.ok;
  } catch (err) {
    console.error("[telegram] send failed", err);
    return false;
  }
}

async function sendToMany(chatIds: string[], text: string): Promise<void> {
  const unique = [...new Set(chatIds.map((c) => c.trim()).filter(Boolean))];
  for (const chatId of unique) {
    await sendMessage(chatId, text);
  }
}

export async function notifyAdminPayment(opts: {
  email: string;
  planName: string;
  amount: number;
  transactionId: string;
  mock: boolean;
}): Promise<void> {
  const chatId = process.env.TELEGRAM_ADMIN_CHAT_ID?.trim();
  if (!chatId) {
    console.info("[telegram:mock:admin-payment]", opts);
    return;
  }
  await sendMessage(
    chatId,
    [
      `<b>Spinlytics — Payment Approved</b>`,
      `User: ${opts.email}`,
      `Plan: ${opts.planName}`,
      `Amount: ฿${opts.amount}`,
      `Txn: ${opts.transactionId}`,
      opts.mock ? `(mock verify)` : `(live verify)`,
    ].join("\n"),
  );
}

export async function notifyUserPaymentDecision(opts: {
  chatId?: string | null;
  chatIds?: string[] | null;
  email: string;
  planName: string;
  amount: number;
  transactionId: string;
  status: "APPROVED" | "REJECTED";
  note?: string | null;
}): Promise<void> {
  const text = [
    `<b>Spinlytics — Payment ${opts.status}</b>`,
    `User: ${opts.email}`,
    `Plan: ${opts.planName}`,
    `Amount: ฿${opts.amount}`,
    `Txn: ${opts.transactionId}`,
    opts.note ? `Note: ${opts.note}` : null,
  ]
    .filter(Boolean)
    .join("\n");

  const ids = [
    ...(opts.chatIds || []),
    ...(opts.chatId ? [opts.chatId] : []),
  ];
  await sendToMany(ids, text);

  const adminChat = process.env.TELEGRAM_ADMIN_CHAT_ID?.trim();
  if (adminChat && !ids.includes(adminChat)) {
    await sendMessage(adminChat, text);
  }
}

export async function notifyUserDomainBlock(opts: {
  chatId?: string | null;
  chatIds?: string[] | null;
  telegramChatIdsJson?: string | null;
  domain: string;
  isp: string;
  userEmail?: string | null;
}): Promise<void> {
  const text = [
    `<b>Spinlytics Alert</b>`,
    opts.userEmail ? `User: ${opts.userEmail}` : null,
    `Domain: <code>${opts.domain}</code>`,
    `ISP: <b>${opts.isp}</b> — BLOCKED`,
    `ตรวจพบการบล็อกใหม่บนเครือข่ายนี้`,
  ]
    .filter(Boolean)
    .join("\n");

  const ids = [
    ...parseTelegramChatIds(opts.telegramChatIdsJson, opts.chatId),
    ...(opts.chatIds || []),
  ];
  await sendToMany(ids, text);

  // Always CC admin group when configured
  const adminChat = process.env.TELEGRAM_ADMIN_CHAT_ID?.trim();
  if (adminChat && !ids.includes(adminChat)) {
    await sendMessage(adminChat, text);
  }
}
