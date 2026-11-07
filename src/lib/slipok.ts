/**
 * SlipOK slip verification.
 * Docs: https://docs.google.com/document/d/1l2ot68Pw3CL7JBeYfUIHLzeBC5F7jm2wzBfm84kwxBA
 *
 * Live: POST https://api.slipok.com/api/line/apikey/<BRANCH_ID>
 *   Header: x-authorization: <API_KEY>
 *   multipart/form-data: files (image), amount (number), optional log=true
 *
 * When SLIPOK_API_KEY is absent → mock mode (demoable without credentials).
 */

export type SlipVerifyResult = {
  ok: boolean;
  mock: boolean;
  amount?: number;
  paidAt?: string;
  message: string;
  raw?: unknown;
};

const DEFAULT_BRANCH_ID = "80454";
const API_BASE = "https://api.slipok.com/api/line/apikey";

export function getSlipOkConfig(): {
  apiKey: string | null;
  branchId: string;
  url: string;
  live: boolean;
} {
  const apiKey = process.env.SLIPOK_API_KEY?.trim() || null;
  const branchId =
    process.env.SLIPOK_BRANCH_ID?.trim() || DEFAULT_BRANCH_ID;
  return {
    apiKey,
    branchId,
    url: `${API_BASE}/${branchId}`,
    live: Boolean(apiKey),
  };
}

export async function verifySlip(opts: {
  amount: number;
  slipBuffer: Buffer;
  filename: string;
}): Promise<SlipVerifyResult> {
  const { apiKey, url, live } = getSlipOkConfig();

  if (!live || !apiKey) {
    // Mock verify only when key absent.
    if (opts.slipBuffer.length < 100) {
      return {
        ok: false,
        mock: true,
        message: "Slip file too small (mock verify).",
      };
    }
    return {
      ok: true,
      mock: true,
      amount: opts.amount,
      paidAt: new Date().toISOString(),
      message:
        "Mock slip verification passed (set SLIPOK_API_KEY for live verify).",
    };
  }

  try {
    const form = new FormData();
    // SlipOK docs: field name is `files` (multipart image)
    form.append(
      "files",
      new Blob([new Uint8Array(opts.slipBuffer)]),
      opts.filename || "slip.jpg",
    );
    form.append("amount", String(opts.amount));
    // Ask SlipOK to store + dedupe slips against linked receiving account
    form.append("log", "true");

    const res = await fetch(url, {
      method: "POST",
      headers: { "x-authorization": apiKey },
      body: form,
    });
    const raw = (await res.json().catch(() => ({}))) as {
      success?: boolean;
      code?: number | string;
      message?: string;
      data?: {
        amount?: number;
        paidLocalAmount?: number;
        transFeeAmount?: number;
        transDate?: string;
        transTime?: string;
      };
    };

    if (!res.ok) {
      return {
        ok: false,
        mock: false,
        message: raw.message || `SlipOK HTTP ${res.status}`,
        raw,
      };
    }

    const paidAmount = Number(
      raw.data?.amount ?? raw.data?.paidLocalAmount ?? 0,
    );
    const amountOk =
      !paidAmount || Math.abs(paidAmount - opts.amount) < 0.01;
    const ok = Boolean(raw.success) && amountOk;

    return {
      ok,
      mock: false,
      amount: paidAmount || opts.amount,
      paidAt: raw.data?.transDate
        ? `${raw.data.transDate}${raw.data.transTime ? ` ${raw.data.transTime}` : ""}`
        : undefined,
      message: !ok
        ? amountOk
          ? raw.message || "Slip verification failed"
          : `Amount mismatch: expected ${opts.amount}, got ${paidAmount}`
        : raw.message || "Slip verified",
      raw,
    };
  } catch (err) {
    return {
      ok: false,
      mock: false,
      message: err instanceof Error ? err.message : "Slip verify error",
    };
  }
}
