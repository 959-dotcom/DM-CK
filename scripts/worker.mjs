/**
 * Standalone domain-check worker.
 * Prefer REDIS_URL + BullMQ; falls back to setInterval.
 *
 * Usage: node --import tsx scripts/worker.mjs
 *    or: npm run worker
 */
import { pathToFileURL } from "node:url";
import path from "node:path";

// Boot Next-compiled paths via dynamic import of TS through tsx when available.
const root = process.cwd();

async function loadCheck() {
  try {
    // When run via `tsx`, we can import TS sources directly.
    const mod = await import(
      pathToFileURL(path.join(root, "src/lib/domain-check.ts")).href
    );
    const queue = await import(
      pathToFileURL(path.join(root, "src/lib/queue.ts")).href
    );
    return { runDueDomainChecks: mod.runDueDomainChecks, start: queue.startDomainCheckWorker };
  } catch (err) {
    console.error("worker: failed to load modules — run with tsx", err);
    process.exit(1);
  }
}

const { runDueDomainChecks, start } = await loadCheck();
const mode = await start();
console.log(`[worker] running in ${mode} mode`);

// Also tick immediately
const n = await runDueDomainChecks();
console.log(`[worker] initial tick checked=${n}`);

// Keep process alive for BullMQ / interval
process.on("SIGINT", () => process.exit(0));
process.on("SIGTERM", () => process.exit(0));
