/**
 * SlipOK (or equivalent) slip verification.
 * When SLIPOK_API_KEY is absent, mock mode accepts demo uploads so billing flow is demoable.
 */

export type SlipVerifyResult = {
  ok: boolean;
  mock: boolean;
  amount?: number;
  paidAt?: string;
  message: string;
  raw?: unknown;
};

export async function verifySlip(opts: {
  amount: number;
  slipBuffer: Buffer;
  filename: string;
}): Promise<SlipVerifyResult> {
  const apiKey = process.env.SLIPOK_API_KEY?.trim();
  const branchId = process.env.SLIPOK_BRANCH_ID?.trim();

  if (!apiKey) {
    // Mock verify: accept any image when keys are missing.
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
    form.append(
      "file",
      new Blob([new Uint8Array(opts.slipBuffer)]),
      opts.filename || "slip.jpg",
    );
    form.append("amount", String(opts.amount));

    const url = branchId
      ? `https://api.slipok.com/api/line/apikey/${branchId}`
      : "https://api.slipok.com/api/line/apikey";

    const res = await fetch(url, {
      method: "POST",
      headers: { "x-authorization": apiKey },
      body: form,
    });
    const raw = await res.json().catch(() => ({}));
    if (!res.ok) {
      return {
        ok: false,
        mock: false,
        message: (raw as { message?: string })?.message || "Slip verify failed",
        raw,
      };
    }
    const data = raw as {
      success?: boolean;
      data?: { amount?: number; transDate?: string };
      message?: string;
    };
    const paidAmount = Number(data.data?.amount ?? 0);
    const amountOk =
      !paidAmount || Math.abs(paidAmount - opts.amount) < 0.01;
    return {
      ok: Boolean(data.success) && amountOk,
      mock: false,
      amount: paidAmount || opts.amount,
      paidAt: data.data?.transDate,
      message: amountOk
        ? data.message || "Slip verified"
        : `Amount mismatch: expected ${opts.amount}, got ${paidAmount}`,
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
