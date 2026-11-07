/**
 * Basic WAF-ish blocks for obvious scanners / path probes.
 * Runs in proxy — keep cheap and false-positive-averse.
 */

const BLOCKED_PATH_RE =
  /(\.env|\.git|wp-admin|wp-login|phpmyadmin|xmlrpc\.php|\.aws|\.ssh|\.docker|\.npmrc|composer\.(json|lock)|package-lock\.json\.bak|\.htaccess|\.DS_Store)/i;

const BLOCKED_UA_RE =
  /(sqlmap|nikto|nessus|masscan|zgrab|dirbuster|wpscan|acunetix)/i;

export function isSuspiciousRequest(opts: {
  pathname: string;
  userAgent: string | null;
}): { block: boolean; reason?: string } {
  if (BLOCKED_PATH_RE.test(opts.pathname)) {
    return { block: true, reason: "blocked_path" };
  }
  if (opts.userAgent && BLOCKED_UA_RE.test(opts.userAgent)) {
    return { block: true, reason: "blocked_ua" };
  }
  // Double-encoded traversal / null bytes
  if (
    opts.pathname.includes("%2e%2e") ||
    opts.pathname.includes("..%2f") ||
    opts.pathname.includes("%00")
  ) {
    return { block: true, reason: "traversal" };
  }
  return { block: false };
}
