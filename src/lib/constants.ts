/** Default merchant PromptPay ID (phone) provided by owner. */
export const DEFAULT_PROMPTPAY_ID = "0846301733";

/** Extra Domain Slot add-on price (THB per domain per month). */
export const EXTRA_DOMAIN_SLOT_PRICE = 50;

export type BillingCycle = "MONTHLY" | "YEARLY";

export function cycleDays(cycle: BillingCycle | null | undefined): number {
  return cycle === "YEARLY" ? 365 : 30;
}

export function parseTelegramChatIds(
  raw: string | null | undefined,
  legacy?: string | null,
): string[] {
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (Array.isArray(parsed)) {
        return parsed
          .map((v) => String(v).trim())
          .filter((v) => v.length > 0);
      }
    } catch {
      // fall through
    }
  }
  if (legacy?.trim()) return [legacy.trim()];
  return [];
}

export function serializeTelegramChatIds(ids: string[]): string {
  const unique = [...new Set(ids.map((id) => id.trim()).filter(Boolean))];
  return JSON.stringify(unique);
}
