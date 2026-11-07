/**
 * BullMQ + Redis when REDIS_URL is set; otherwise in-process setInterval fallback.
 */

import { runDueDomainChecks } from "./domain-check";

let started = false;
let intervalHandle: ReturnType<typeof setInterval> | null = null;

export async function startDomainCheckWorker(): Promise<"bullmq" | "inplace"> {
  if (started) {
    return process.env.REDIS_URL?.trim() ? "bullmq" : "inplace";
  }
  started = true;

  const redisUrl = process.env.REDIS_URL?.trim();
  if (redisUrl) {
    try {
      const { Queue, Worker } = await import("bullmq");
      const { default: IORedis } = await import("ioredis");
      const connection = new IORedis(redisUrl, { maxRetriesPerRequest: null });

      const queue = new Queue("domain-checks", { connection });
      new Worker(
        "domain-checks",
        async () => {
          const n = await runDueDomainChecks();
          return { checked: n };
        },
        { connection },
      );

      // Repeat every minute; per-domain interval is enforced in SQL.
      // BullMQ v5+/v6 prefers upsertJobScheduler for repeating jobs.
      if (typeof queue.upsertJobScheduler === "function") {
        await queue.upsertJobScheduler(
          "domain-check-tick",
          { every: 60_000 },
          {
            name: "tick",
            data: {},
            opts: { removeOnComplete: 100, removeOnFail: 50 },
          },
        );
      } else {
        await queue.add(
          "tick",
          {},
          {
            // @ts-expect-error older BullMQ JobsOptions.repeat
            repeat: { every: 60_000 },
            removeOnComplete: 100,
            removeOnFail: 50,
          },
        );
      }

      console.info("[queue] BullMQ worker started");
      return "bullmq";
    } catch (err) {
      console.warn("[queue] BullMQ failed, falling back to in-process", err);
    }
  }

  const everyMs = Number(process.env.CHECK_TICK_MS || 60_000);
  intervalHandle = setInterval(() => {
    runDueDomainChecks().catch((err) =>
      console.error("[queue:inplace] tick failed", err),
    );
  }, everyMs);
  // Kick once shortly after boot.
  setTimeout(() => {
    runDueDomainChecks().catch(() => undefined);
  }, 5_000);
  console.info("[queue] in-process scheduler started", { everyMs });
  return "inplace";
}

export function stopDomainCheckWorker() {
  if (intervalHandle) clearInterval(intervalHandle);
  started = false;
}
