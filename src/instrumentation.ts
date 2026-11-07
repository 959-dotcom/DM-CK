export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { startDomainCheckWorker } = await import("./lib/queue");
    startDomainCheckWorker().catch((err) =>
      console.warn("[instrumentation] worker start failed", err),
    );
  }
}
