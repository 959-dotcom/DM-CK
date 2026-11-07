/**
 * Telegram Bot API helpers. No-ops with a console note when tokens are missing.
 */

import { parseTelegramChatIds } from "./constants";

export type InlineKeyboardButton = {
  text: string;
  callback_data: string;
};

export type InlineKeyboardMarkup = {
  inline_keyboard: InlineKeyboardButton[][];
};

export function getTelegramBotToken(): string | null {
  return process.env.TELEGRAM_BOT_TOKEN?.trim() || null;
}

export function getTelegramAdminChatId(): string | null {
  return process.env.TELEGRAM_ADMIN_CHAT_ID?.trim() || null;
}

export function getTelegramSlipApproveChatId(): string | null {
  return process.env.TELEGRAM_SLIP_APPROVE_CHAT_ID?.trim() || null;
}

export function getTelegramWebhookSecret(): string | null {
  return (
    process.env.TELEGRAM_WEBHOOK_SECRET?.trim() ||
    process.env.WORKER_SECRET?.trim() ||
    null
  );
}

async function botApi(
  method: string,
  body: Record<string, unknown>,
): Promise<{ ok: boolean; result?: unknown; description?: string }> {
  const token = getTelegramBotToken();
  if (!token) {
    console.info(`[telegram:mock] ${method}`, JSON.stringify(body).slice(0, 300));
    return { ok: false, description: "TELEGRAM_BOT_TOKEN unset" };
  }
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const json = (await res.json().catch(() => ({}))) as {
      ok?: boolean;
      result?: unknown;
      description?: string;
    };
    if (!res.ok || !json.ok) {
      console.error(`[telegram] ${method} failed`, json.description || res.status);
      return {
        ok: false,
        description: json.description || `HTTP ${res.status}`,
      };
    }
    return { ok: true, result: json.result };
  } catch (err) {
    console.error(`[telegram] ${method} error`, err);
    return {
      ok: false,
      description: err instanceof Error ? err.message : "fetch failed",
    };
  }
}

export async function sendMessage(
  chatId: string,
  text: string,
  opts?: { replyMarkup?: InlineKeyboardMarkup },
): Promise<boolean> {
  if (!chatId) {
    console.info("[telegram:mock]", "(no chat)", text.slice(0, 200));
    return false;
  }
  const res = await botApi("sendMessage", {
    chat_id: chatId,
    text,
    parse_mode: "HTML",
    disable_web_page_preview: true,
    ...(opts?.replyMarkup ? { reply_markup: opts.replyMarkup } : {}),
  });
  return res.ok;
}

export async function answerCallbackQuery(opts: {
  callbackQueryId: string;
  text?: string;
  showAlert?: boolean;
}): Promise<boolean> {
  const res = await botApi("answerCallbackQuery", {
    callback_query_id: opts.callbackQueryId,
    text: opts.text,
    show_alert: opts.showAlert ?? false,
  });
  return res.ok;
}

export async function editMessageText(opts: {
  chatId: string | number;
  messageId: number;
  text: string;
  replyMarkup?: InlineKeyboardMarkup | { inline_keyboard: never[] };
}): Promise<boolean> {
  const res = await botApi("editMessageText", {
    chat_id: opts.chatId,
    message_id: opts.messageId,
    text: opts.text,
    parse_mode: "HTML",
    disable_web_page_preview: true,
    reply_markup: opts.replyMarkup ?? { inline_keyboard: [] },
  });
  return res.ok;
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
  via?: "live" | "mock" | "telegram" | "admin";
}): Promise<void> {
  const chatId = getTelegramAdminChatId();
  if (!chatId) {
    console.info("[telegram:mock:admin-payment]", opts);
    return;
  }
  const viaLabel =
    opts.via === "telegram"
      ? "(telegram manual approve)"
      : opts.via === "admin"
        ? "(admin panel)"
        : opts.mock
          ? "(mock verify)"
          : "(live verify)";
  await sendMessage(
    chatId,
    [
      `<b>Spinlytics — Payment Approved</b>`,
      `User: ${opts.email}`,
      `Plan: ${opts.planName}`,
      `Amount: ฿${opts.amount}`,
      `Txn: ${opts.transactionId}`,
      viaLabel,
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

  const adminChat = getTelegramAdminChatId();
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
  const adminChat = getTelegramAdminChatId();
  if (adminChat && !ids.includes(adminChat)) {
    await sendMessage(adminChat, text);
  }
}

/** One-shot test message into the slip-approve group (ops / smoke). */
export async function sendSlipApproveTestMessage(
  text = "Spinlytics slip-approve channel OK",
): Promise<{ ok: boolean; description?: string }> {
  const chatId = getTelegramSlipApproveChatId();
  if (!chatId) {
    return { ok: false, description: "TELEGRAM_SLIP_APPROVE_CHAT_ID unset" };
  }
  const res = await botApi("sendMessage", {
    chat_id: chatId,
    text,
    disable_web_page_preview: true,
  });
  return { ok: res.ok, description: res.description };
}
