import generatePayload from "promptpay-qr";
import QRCode from "qrcode";
import { DEFAULT_PROMPTPAY_ID } from "./constants";

export { DEFAULT_PROMPTPAY_ID };

export function getPromptPayId(): string {
  return process.env.PROMPTPAY_ID?.trim() || DEFAULT_PROMPTPAY_ID;
}

export async function generatePromptPayQr(opts: {
  amount: number;
  ref?: string;
}): Promise<{ payload: string; dataUrl: string; promptpayId: string }> {
  const promptpayId = getPromptPayId();
  const amount = Number(opts.amount);
  const payload = generatePayload(promptpayId, { amount });
  const dataUrl = await QRCode.toDataURL(payload, {
    errorCorrectionLevel: "M",
    margin: 1,
    width: 320,
    color: { dark: "#0a0a0a", light: "#ffffff" },
  });
  return { payload, dataUrl, promptpayId };
}
