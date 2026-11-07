/** Best-effort absolute URL for ops messages (Telegram, etc.). */
export function publicAppOrigin(): string {
  const host =
    process.env.NEXT_PUBLIC_APP_HOST?.trim() ||
    process.env.VERCEL_PROJECT_PRODUCTION_URL?.trim() ||
    process.env.VERCEL_URL?.trim() ||
    "db357.com";
  if (host.startsWith("http://") || host.startsWith("https://")) {
    return host.replace(/\/$/, "");
  }
  return `https://${host.replace(/\/$/, "")}`;
}

export function absolutePublicUrl(pathOrUrl: string): string {
  if (!pathOrUrl) return pathOrUrl;
  if (pathOrUrl.startsWith("http://") || pathOrUrl.startsWith("https://")) {
    return pathOrUrl;
  }
  const path = pathOrUrl.startsWith("/") ? pathOrUrl : `/${pathOrUrl}`;
  return `${publicAppOrigin()}${path}`;
}
