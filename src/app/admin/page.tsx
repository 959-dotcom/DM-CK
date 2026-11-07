"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { apiFetch } from "@/lib/client-fetch";

type Stats = {
  users: number;
  active_subs: number;
  domains: number;
  pending_slips: number;
};

type Block = {
  id: string;
  url: string;
  status: string;
  last_checked_at: string | null;
  email: string;
};

export default function AdminDashboardPage() {
  const router = useRouter();
  const [stats, setStats] = useState<Stats | null>(null);
  const [blocks, setBlocks] = useState<Block[]>([]);
  const [error, setError] = useState("");

  useEffect(() => {
    (async () => {
      const me = await apiFetch("/api/auth/me");
      if (me.status === 401) {
        router.push("/login?next=/admin");
        return;
      }
      const meData = await me.json();
      if (meData.user?.role !== "ADMIN") {
        router.push("/dashboard");
        return;
      }
      const res = await apiFetch("/api/admin/stats");
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed");
      setStats(data.stats);
      setBlocks(data.recent_blocks || []);
    })().catch((err) => setError(String(err)));
  }, [router]);

  const cards = [
    { label: "Users", value: stats?.users },
    { label: "Active / Trial", value: stats?.active_subs },
    { label: "Domains", value: stats?.domains },
    { label: "Pending slips", value: stats?.pending_slips },
  ];

  return (
    <div className="animate-rise">
      <h1 className="font-display text-5xl tracking-wide">
        Control <span className="text-ember-500">Panel</span>
      </h1>
      <p className="mt-2 text-mist">Overview of Spinlytics production state</p>
      {error && <p className="mt-4 text-sm text-ember-400">{error}</p>}

      <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {cards.map((c) => (
          <div
            key={c.label}
            className="border border-ember-700/30 bg-ink-900/80 px-5 py-6"
          >
            <div className="text-xs uppercase tracking-[0.18em] text-mist">
              {c.label}
            </div>
            <div className="mt-3 font-display text-5xl text-white">
              {c.value ?? "—"}
            </div>
          </div>
        ))}
      </div>

      <section className="mt-10">
        <h2 className="font-display text-3xl tracking-wide">Recent blocks</h2>
        <div className="mt-4 space-y-2">
          {blocks.length === 0 && (
            <p className="text-sm text-mist">No blocked domains right now.</p>
          )}
          {blocks.map((b) => (
            <div
              key={b.id}
              className="flex flex-wrap items-center justify-between gap-2 border border-white/10 bg-ink-900/60 px-4 py-3 text-sm"
            >
              <div>
                <div className="font-medium text-ember-400">{b.url}</div>
                <div className="text-mist">{b.email}</div>
              </div>
              <div className="text-xs text-mist">
                {b.last_checked_at
                  ? new Date(b.last_checked_at).toLocaleString("th-TH")
                  : "—"}
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
