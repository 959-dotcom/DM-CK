/** Hub Supabase project aozoakeghslgnhdegdyr. Not a secret. */
export const HUB_PROJECT_REF = "aozoakeghslgnhdegdyr";

/** DM-CK tables live here. Hub tables stay in public. */
export const DMCK_SCHEMA = "dmck";

/**
 * True when a Postgres URL is the Hub project.
 * The ref is in the direct host (db.<ref>.supabase.co) or the pooler user
 * (postgres.<ref>). Other databases, including the previous DM-CK database, stay false.
 */
export function isHubProjectDatabaseUrl(url) {
  if (typeof url !== "string") return false;
  const trimmed = url.trim();
  if (trimmed === "") return false;
  return trimmed.includes(HUB_PROJECT_REF);
}
