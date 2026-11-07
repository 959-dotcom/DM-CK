/** Browser helper: credentials + CSRF header for mutating cookie-session calls. */

import { CSRF_COOKIE, CSRF_HEADER } from "@/lib/security/csrf-constants";

function readCookie(name: string): string | null {
  if (typeof document === "undefined") return null;
  const match = document.cookie.match(
    new RegExp(`(?:^|;\\s*)${name}=([^;]+)`),
  );
  return match?.[1] ? decodeURIComponent(match[1]) : null;
}

export async function apiFetch(
  input: RequestInfo | URL,
  init: RequestInit = {},
): Promise<Response> {
  const method = (init.method || "GET").toUpperCase();
  const headers = new Headers(init.headers || {});
  if (!["GET", "HEAD", "OPTIONS"].includes(method)) {
    const csrf = readCookie(CSRF_COOKIE);
    if (csrf && !headers.has(CSRF_HEADER)) {
      headers.set(CSRF_HEADER, csrf);
    }
  }
  return fetch(input, {
    ...init,
    credentials: init.credentials ?? "include",
    headers,
  });
}
