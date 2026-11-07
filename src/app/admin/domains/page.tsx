"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { apiFetch } from "@/lib/client-fetch";
import { Power, RefreshCw } from "lucide-react";

type Domain = {
  id: string;
  url: string;
  status: string;
  monitoring_enabled: boolean;
  last_checked_at: string | null;
  email: string;
};

export default function AdminDomainsPage() {
  const router = useRouter();
  const [domains, setDomains] = useState<Domain[]>([]);
  const [q, setQ] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(
    async (query = "") => {
      const res = await apiFetch(
        `/api/admin/domains${query ? `?q=${encodeURIComponent(query)}` : ""}`,
      );
      if (res.status === 401 || res.status === 403) {
        router.push("/login?next=/admin/domains");
        return;
      }
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed");
      setDomains(data.domains || []);
    },
    [router],
  );

  useEffect(() => {
    load().catch((err) => setError(String(err)));
  }, [load]);

  async function search(e: FormEvent) {
    e.preventDefault();
    try {
      await load(q);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed");
    }
  }

  async function act(
    id: string,
    body: { monitoring_enabled?: boolean; action?: "recheck" },
  ) {
    setBusy(id);
    setError("");
    try {
      const res = await apiFetch("/api/admin/domains", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, ...body }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed");
      await load(q);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="animate-rise">
      <h1 className="font-display text-4xl tracking-wide">Domains</h1>
      <form onSubmit={search} className="mt-6 flex gap-2">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search url / email"
          className="flex-1 rounded-md border border-white/10 bg-ink-800 px-3 py-2"
        />
        <button
          type="submit"
          className="rounded-md bg-ember-500 px-4 py-2 font-semibold hover:bg-ember-400"
        >
          Search
        </button>
      </form>
      {error && <p className="mt-3 text-sm text-ember-400">{error}</p>}

      <div className="mt-6 space-y-2">
        {domains.map((d) => (
          <div
            key={d.id}
            className="flex flex-wrap items-center justify-between gap-3 border border-white/10 bg-ink-900/60 px-4 py-3"
          >
            <div>
              <div className="font-semibold">{d.url}</div>
              <div className="text-xs text-mist">
                {d.email} · {d.status} · monitor{" "}
                {d.monitoring_enabled ? "on" : "off"}
                {d.last_checked_at
                  ? ` · ${new Date(d.last_checked_at).toLocaleString("th-TH")}`
                  : ""}
              </div>
            </div>
            <div className="flex gap-2">
              <button
                disabled={busy === d.id}
                onClick={() =>
                  act(d.id, { monitoring_enabled: !d.monitoring_enabled })
                }
                className="rounded border border-white/10 p-2 hover:bg-white/5"
                title="Toggle monitoring"
              >
                <Power
                  className={`h-4 w-4 ${d.monitoring_enabled ? "text-emerald-400" : "text-zinc-500"}`}
                />
              </button>
              <button
                disabled={busy === d.id}
                onClick={() => act(d.id, { action: "recheck" })}
                className="rounded border border-white/10 p-2 hover:bg-white/5"
                title="Force recheck"
              >
                <RefreshCw className="h-4 w-4" />
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
