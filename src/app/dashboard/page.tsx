"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Nav } from "@/components/Nav";
import { apiFetch } from "@/lib/client-fetch";
import { Plus, RefreshCw, Power, Trash2, LogOut } from "lucide-react";

type DomainRow = {
  id: string;
  url: string;
  status: string;
  monitoring_enabled: boolean;
  last_checked_at: string | null;
  ais_status: string | null;
  true_status: string | null;
  dtac_status: string | null;
  tbb_status: string | null;
  nt_status: string | null;
};

type Me = {
  user: {
    email: string;
    role?: string;
    subscription_status: string;
    plan_expire_at: string | null;
    telegram_chat_id: string | null;
  };
  plan: { name: string; max_domains: number; check_interval_minutes: number } | null;
  domain_count: number;
};

const ISPS = [
  ["ais_status", "AIS"],
  ["true_status", "TRUE"],
  ["dtac_status", "DTAC"],
  ["tbb_status", "3BB"],
  ["nt_status", "NT"],
] as const;

function statusClass(s: string | null) {
  if (s === "SAFE") return "isp-safe";
  if (s === "BLOCKED") return "isp-blocked";
  return "isp-unknown";
}

export default function DashboardPage() {
  const router = useRouter();
  const [me, setMe] = useState<Me | null>(null);
  const [domains, setDomains] = useState<DomainRow[]>([]);
  const [url, setUrl] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [meRes, domRes] = await Promise.all([
      apiFetch("/api/auth/me"),
      apiFetch("/api/domains"),
    ]);
    if (meRes.status === 401) {
      router.push("/login");
      return;
    }
    setMe(await meRes.json());
    const d = await domRes.json();
    setDomains(d.domains || []);
  }, [router]);

  useEffect(() => {
    load().catch((err) => setError(String(err)));
  }, [load]);

  async function addDomain(e: FormEvent) {
    e.preventDefault();
    setError("");
    setBusy("add");
    try {
      const res = await apiFetch("/api/domains", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed");
      setUrl("");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed");
    } finally {
      setBusy(null);
    }
  }

  async function toggleMonitor(id: string, enabled: boolean) {
    setBusy(id);
    await apiFetch(`/api/domains/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ monitoring_enabled: !enabled }),
    });
    await load();
    setBusy(null);
  }

  async function recheck(id: string) {
    setBusy(id);
    await apiFetch(`/api/domains/${id}/check`, { method: "POST" });
    await load();
    setBusy(null);
  }

  async function remove(id: string) {
    if (!confirm("ลบโดเมนนี้?")) return;
    setBusy(id);
    await apiFetch(`/api/domains/${id}`, { method: "DELETE" });
    await load();
    setBusy(null);
  }

  async function logout() {
    await apiFetch("/api/auth/logout", { method: "POST" });
    router.push("/");
  }

  return (
    <main className="min-h-screen bg-ink-950 text-white">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_top_right,_rgba(225,29,46,0.14),_transparent_45%)]" />
      <Nav authed />
      <div className="relative mx-auto max-w-6xl px-6 py-10 md:px-10">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="font-display text-5xl tracking-wide">
              Spin<span className="text-ember-500">lytics</span>
            </p>
            <p className="mt-1 text-mist">
              {me?.user.email} · {me?.plan?.name || "Free"} ·{" "}
              {me?.user.subscription_status}
              {me?.plan
                ? ` · โควต้า ${me.domain_count}/${me.plan.max_domains}`
                : null}
            </p>
          </div>
          <div className="flex gap-2">
            {me?.user.role === "ADMIN" && (
              <Link
                href="/admin"
                className="rounded-md border border-ember-600/40 px-4 py-2 text-sm text-ember-400 hover:bg-ember-600/10"
              >
                Admin
              </Link>
            )}
            <Link
              href="/billing"
              className="rounded-md border border-white/10 px-4 py-2 text-sm hover:bg-white/5"
            >
              อัปเกรดแพ็ก
            </Link>
            <button
              onClick={logout}
              className="inline-flex items-center gap-2 rounded-md border border-white/10 px-4 py-2 text-sm hover:bg-white/5"
            >
              <LogOut className="h-4 w-4" /> ออก
            </button>
          </div>
        </div>

        <form
          onSubmit={addDomain}
          className="mt-8 flex flex-col gap-3 sm:flex-row"
        >
          <input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="example.com หรือ https://example.com"
            required
            className="flex-1 rounded-md border border-white/10 bg-ink-800 px-3 py-2.5 outline-none ring-ember-500 focus:ring-1"
          />
          <button
            type="submit"
            disabled={busy === "add"}
            className="inline-flex items-center justify-center gap-2 rounded-md bg-ember-500 px-5 py-2.5 font-semibold hover:bg-ember-400 disabled:opacity-60"
          >
            <Plus className="h-4 w-4" /> เพิ่มโดเมน
          </button>
        </form>
        {error && <p className="mt-3 text-sm text-ember-400">{error}</p>}

        <div className="mt-10 space-y-4">
          {domains.length === 0 && (
            <p className="text-mist">ยังไม่มีโดเมน — เพิ่มโดเมนแรกเพื่อเริ่มมอนิเตอร์</p>
          )}
          {domains.map((d) => (
            <article
              key={d.id}
              className="border border-white/10 bg-ink-900/70 p-5 backdrop-blur"
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h2 className="text-lg font-semibold">{d.url}</h2>
                  <p className="mt-1 text-xs text-mist">
                    สถานะรวม:{" "}
                    <span className={statusClass(d.status === "BLOCKED" ? "BLOCKED" : "SAFE")}>
                      {d.status}
                    </span>
                    {d.last_checked_at
                      ? ` · ตรวจล่าสุด ${new Date(d.last_checked_at).toLocaleString("th-TH")}`
                      : " · ยังไม่เคยตรวจ"}
                    {" · "}
                    มอนิเตอร์ {d.monitoring_enabled ? "เปิด" : "ปิด"}
                  </p>
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => toggleMonitor(d.id, d.monitoring_enabled)}
                    disabled={busy === d.id}
                    className="rounded-md border border-white/10 p-2 hover:bg-white/5"
                    title="Toggle monitoring"
                  >
                    <Power
                      className={`h-4 w-4 ${d.monitoring_enabled ? "text-emerald-400" : "text-zinc-500"}`}
                    />
                  </button>
                  <button
                    onClick={() => recheck(d.id)}
                    disabled={busy === d.id}
                    className="rounded-md border border-white/10 p-2 hover:bg-white/5"
                    title="Recheck now"
                  >
                    <RefreshCw className="h-4 w-4" />
                  </button>
                  <button
                    onClick={() => remove(d.id)}
                    disabled={busy === d.id}
                    className="rounded-md border border-white/10 p-2 hover:bg-white/5"
                    title="Delete"
                  >
                    <Trash2 className="h-4 w-4 text-ember-400" />
                  </button>
                </div>
              </div>
              <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-5">
                {ISPS.map(([key, label]) => (
                  <div
                    key={key}
                    className="border border-white/5 bg-ink-950/60 px-3 py-2 text-center"
                  >
                    <div className="text-xs text-mist">{label}</div>
                    <div
                      className={`mt-1 text-sm font-semibold ${statusClass(d[key])}`}
                    >
                      {d[key] || "—"}
                    </div>
                  </div>
                ))}
              </div>
            </article>
          ))}
        </div>
      </div>
    </main>
  );
}
