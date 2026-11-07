"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { apiFetch } from "@/lib/client-fetch";

type Health = Record<string, boolean>;

export default function AdminSystemPage() {
  const router = useRouter();
  const [health, setHealth] = useState<Health | null>(null);
  const [workerLast, setWorkerLast] = useState<unknown>(null);
  const [nodeEnv, setNodeEnv] = useState("");
  const [secret, setSecret] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const res = await apiFetch("/api/admin/system");
    if (res.status === 401 || res.status === 403) {
      router.push("/login?next=/admin/system");
      return;
    }
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Failed");
    setHealth(data.env_health);
    setWorkerLast(data.worker_last_run);
    setNodeEnv(data.node_env);
  }, [router]);

  useEffect(() => {
    load().catch((err) => setError(String(err)));
  }, [load]);

  async function triggerTick() {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const res = await apiFetch("/api/admin/system", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "tick",
          worker_secret: secret || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed");
      setMessage(`Tick ok — mode=${data.mode}, checked=${data.checked}`);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="animate-rise">
      <h1 className="font-display text-4xl tracking-wide">System</h1>
      <p className="mt-2 text-mist">
        Worker status + env health (booleans only). NODE_ENV={nodeEnv || "—"}
      </p>
      {error && <p className="mt-3 text-sm text-ember-400">{error}</p>}
      {message && <p className="mt-3 text-sm text-emerald-400">{message}</p>}

      <section className="mt-8 border border-white/10 bg-ink-900/70 p-5">
        <h2 className="font-display text-2xl">Worker last run</h2>
        <pre className="mt-3 overflow-auto rounded bg-ink-950/80 p-3 text-xs text-mist">
          {workerLast ? JSON.stringify(workerLast, null, 2) : "(never)"}
        </pre>
        <div className="mt-4 flex flex-col gap-2 sm:flex-row">
          <input
            type="password"
            value={secret}
            onChange={(e) => setSecret(e.target.value)}
            placeholder="WORKER_SECRET (if configured)"
            className="flex-1 rounded-md border border-white/10 bg-ink-800 px-3 py-2"
          />
          <button
            disabled={busy}
            onClick={triggerTick}
            className="rounded-md bg-ember-500 px-4 py-2 font-semibold hover:bg-ember-400 disabled:opacity-60"
          >
            {busy ? "Running…" : "Trigger tick"}
          </button>
        </div>
      </section>

      <section className="mt-8">
        <h2 className="font-display text-2xl">Env health</h2>
        <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {health &&
            Object.entries(health).map(([k, v]) => (
              <div
                key={k}
                className="flex items-center justify-between border border-white/10 bg-ink-900/60 px-3 py-2 text-sm"
              >
                <span className="text-mist">{k}</span>
                <span className={v ? "text-emerald-400" : "text-zinc-500"}>
                  {v ? "set" : "unset"}
                </span>
              </div>
            ))}
        </div>
      </section>
    </div>
  );
}
