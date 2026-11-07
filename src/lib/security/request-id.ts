export const REQUEST_ID_HEADER = "x-request-id";

export function ensureRequestId(existing: string | null): string {
  if (existing && /^[a-zA-Z0-9_-]{8,64}$/.test(existing)) return existing;
  return crypto.randomUUID();
}
