/**
 * Backup manual slip approval via Telegram inline buttons / reply commands.
 * Separate from SlipOK auto-approve path.
 */

import {
  decidePayment,
  PaymentKind,
} from "./payment-decision";
import {
  answerCallbackQuery,
  editMessageText,
  getTelegramSlipApproveChatId,
  InlineKeyboardMarkup,
  sendMessage,
} from "./telegram";

const CALLBACK_RE = /^s([ar]):([pa]):([a-zA-Z0-9_:-]+)$/;
const COMMAND_RE =
  /^\/(approve|reject)(?:@\w+)?\s+([a-zA-Z0-9_:-]+)(?:\s+(plan|addon))?\s*$/i;

export type ManualSlipRequest = {
  kind: PaymentKind;
  id: string;
  email: string;
  title: string;
  amount: number;
  slipUrl?: string | null;
  verifyMessage?: string | null;
};

function kindCode(kind: PaymentKind): "p" | "a" {
  return kind === "addon" ? "a" : "p";
}

function parseKind(code: string): PaymentKind | null {
  if (code === "p") return "plan";
  if (code === "a") return "addon";
  return null;
}

function approvalKeyboard(kind: PaymentKind, id: string): InlineKeyboardMarkup {
  const k = kindCode(kind);
  return {
    inline_keyboard: [
      [
        { text: "✅ Approve", callback_data: `sa:${k}:${id}` },
        { text: "❌ Reject", callback_data: `sr:${k}:${id}` },
      ],
    ],
  };
}

function formatPendingText(opts: ManualSlipRequest): string {
  return [
    `<b>Spinlytics — Manual slip review</b>`,
    `Kind: ${opts.kind}`,
    `User: ${opts.email}`,
    `Item: ${opts.title}`,
    `Amount: ฿${opts.amount}`,
    `Id: <code>${opts.id}</code>`,
    opts.slipUrl ? `Slip: ${opts.slipUrl}` : null,
    opts.verifyMessage ? `SlipOK: ${opts.verifyMessage}` : null,
    ``,
    `Tap Approve / Reject, or reply:`,
    `<code>/approve ${opts.id} ${opts.kind}</code>`,
    `<code>/reject ${opts.id} ${opts.kind}</code>`,
  ]
    .filter((line) => line !== null)
    .join("\n");
}

/** Send pending slip to TELEGRAM_SLIP_APPROVE_CHAT_ID. Returns false if unset/failed. */
export async function requestManualSlipApproval(
  opts: ManualSlipRequest,
): Promise<boolean> {
  const chatId = getTelegramSlipApproveChatId();
  if (!chatId) {
    console.info("[telegram:mock:slip-approve]", opts);
    return false;
  }
  return sendMessage(chatId, formatPendingText(opts), {
    replyMarkup: approvalKeyboard(opts.kind, opts.id),
  });
}

export function isAuthorizedApproveChat(chatId: string | number | undefined | null): boolean {
  const expected = getTelegramSlipApproveChatId();
  if (!expected || chatId === undefined || chatId === null) return false;
  return String(chatId) === expected;
}

export async function applyManualDecision(opts: {
  kind: PaymentKind;
  id: string;
  status: "APPROVED" | "REJECTED";
  actorLabel?: string;
}): Promise<{ ok: boolean; message: string }> {
  const note =
    opts.status === "APPROVED"
      ? `Telegram manual approve${opts.actorLabel ? ` by ${opts.actorLabel}` : ""}`
      : `Telegram manual reject${opts.actorLabel ? ` by ${opts.actorLabel}` : ""}`;

  const result = await decidePayment({
    kind: opts.kind,
    id: opts.id,
    status: opts.status,
    note,
    via: "telegram",
  });

  if (!result.ok) {
    return { ok: false, message: result.error };
  }
  if (result.already) {
    return {
      ok: true,
      message: `Already ${result.status.toLowerCase()}`,
    };
  }
  return {
    ok: true,
    message: `${result.kind} ${result.id} → ${result.status}`,
  };
}

type TelegramUser = {
  id?: number;
  username?: string;
  first_name?: string;
};

type TelegramMessage = {
  message_id?: number;
  text?: string;
  chat?: { id?: number };
  from?: TelegramUser;
};

type TelegramCallbackQuery = {
  id: string;
  data?: string;
  from?: TelegramUser;
  message?: TelegramMessage;
};

export type TelegramUpdate = {
  update_id?: number;
  message?: TelegramMessage;
  callback_query?: TelegramCallbackQuery;
};

function actorLabel(user?: TelegramUser): string {
  if (!user) return "unknown";
  if (user.username) return `@${user.username}`;
  if (user.first_name) return user.first_name;
  return String(user.id ?? "unknown");
}

export async function handleTelegramUpdate(
  update: TelegramUpdate,
): Promise<{ handled: boolean; detail?: string }> {
  if (update.callback_query) {
    return handleCallbackQuery(update.callback_query);
  }
  if (update.message?.text) {
    return handleCommandMessage(update.message);
  }
  return { handled: false };
}

async function handleCallbackQuery(
  cq: TelegramCallbackQuery,
): Promise<{ handled: boolean; detail?: string }> {
  const chatId = cq.message?.chat?.id;
  if (!isAuthorizedApproveChat(chatId)) {
    await answerCallbackQuery({
      callbackQueryId: cq.id,
      text: "Unauthorized chat",
      showAlert: true,
    });
    return { handled: true, detail: "unauthorized chat" };
  }

  const data = cq.data || "";
  const m = CALLBACK_RE.exec(data);
  if (!m) {
    await answerCallbackQuery({
      callbackQueryId: cq.id,
      text: "Unknown action",
    });
    return { handled: true, detail: "unknown callback" };
  }

  const status = m[1] === "a" ? "APPROVED" : "REJECTED";
  const kind = parseKind(m[2]);
  const id = m[3];
  if (!kind || !id) {
    await answerCallbackQuery({
      callbackQueryId: cq.id,
      text: "Bad callback",
      showAlert: true,
    });
    return { handled: true, detail: "bad callback" };
  }

  const actor = actorLabel(cq.from);
  const result = await applyManualDecision({
    kind,
    id,
    status,
    actorLabel: actor,
  });

  await answerCallbackQuery({
    callbackQueryId: cq.id,
    text: result.ok ? result.message : result.message,
    showAlert: !result.ok,
  });

  if (cq.message?.message_id != null && chatId != null) {
    const original = cq.message.text || formatPendingText({
      kind,
      id,
      email: "?",
      title: "?",
      amount: 0,
    });
    const stamp = result.ok
      ? `\n\n<b>${status}</b> by ${actor}`
      : `\n\n⚠️ ${result.message}`;
    await editMessageText({
      chatId,
      messageId: cq.message.message_id,
      text: `${original}${stamp}`,
      replyMarkup: { inline_keyboard: [] },
    });
  }

  return { handled: true, detail: result.message };
}

async function handleCommandMessage(
  message: TelegramMessage,
): Promise<{ handled: boolean; detail?: string }> {
  const text = (message.text || "").trim();
  const m = COMMAND_RE.exec(text);
  if (!m) return { handled: false };

  if (!isAuthorizedApproveChat(message.chat?.id)) {
    return { handled: true, detail: "unauthorized chat" };
  }

  const status = m[1].toLowerCase() === "approve" ? "APPROVED" : "REJECTED";
  const id = m[2];
  const kindHint = (m[3] || "").toLowerCase();

  let kind: PaymentKind | null =
    kindHint === "addon" ? "addon" : kindHint === "plan" ? "plan" : null;

  // Auto-detect kind from id prefix when not specified.
  if (!kind) {
    if (id.startsWith("addon_")) kind = "addon";
    else kind = "plan";
  }

  const actor = actorLabel(message.from);
  const result = await applyManualDecision({
    kind,
    id,
    status,
    actorLabel: actor,
  });

  const chatId = String(message.chat?.id || "");
  if (chatId) {
    await sendMessage(
      chatId,
      result.ok
        ? `<b>${status}</b> ${id}\n${result.message}\nby ${actor}`
        : `⚠️ ${result.message}`,
    );
  }

  return { handled: true, detail: result.message };
}

/** Process a batch of Telegram updates (webhook body or getUpdates). */
export async function processTelegramUpdates(
  updates: TelegramUpdate[],
): Promise<{ processed: number; details: string[] }> {
  const details: string[] = [];
  let processed = 0;
  for (const update of updates) {
    const res = await handleTelegramUpdate(update);
    if (res.handled) {
      processed += 1;
      if (res.detail) details.push(res.detail);
    }
  }
  return { processed, details };
}
