"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Nav } from "@/components/Nav";
import { apiFetch } from "@/lib/client-fetch";
import {
  Plus,
  RefreshCw,
  Power,
  Trash2,
  LogOut,
  ListPlus,
  Search,
  X,
  Zap,
} from "lucide-react";

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
    billing_cycle?: string | null;
    telegram_chat_id: string | null;
    telegram_chat_ids?: string[];
  };
  plan: {
    name: string;
    max_domains: number;
    check_interval_minutes: number;
    max_telegram_groups?: number;
  } | null;
  domain_count: number;
  domain_quota?: {
    max_domains: number;
    extra_domain_slots: number;
    total_slots: number;
    used: number;
  };
};

type CheckJobView = {
  id: string;
  status: string;
  total: number;
  completed: number;
  failed: number;
  currentDomainId: string | null;
  percent: number;
  results: { domainId: string; ok: boolean; error?: string }[];
};

type FilterMode = "all" | "blocked" | "safe";

const ISPS = [
  ["ais_status", "AIS"],
  ["true_status", "TRUE"],
  ["dtac_status", "DTAC"],
  ["tbb_status", "3BB"],
  ["nt_status", "NT"],
] as const;

const PAGE_SIZE = 10;

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
  const [telegramInput, setTelegramInput] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState<string | null>(null);

  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkText, setBulkText] = useState("");
  const [bulkReport, setBulkReport] = useState<string>("");

  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<FilterMode>("all");
  const [page, setPage] = useState(1);

  const [checkJob, setCheckJob] = useState<CheckJobView | null>(null);
  const [checkingIds, setCheckingIds] = useState<Set<string>>(new Set());

  const load = useCallback(async () => {
    const [meRes, domRes] = await Promise.all([
      apiFetch("/api/auth/me"),
      apiFetch("/api/domains"),
    ]);
    if (meRes.status === 401) {
      router.push("/login");
      return;
    }
    const meJson = await meRes.json();
    setMe(meJson);
    const ids: string[] = meJson.user?.telegram_chat_ids || [];
    setTelegramInput(ids.join(", "));
    const d = await domRes.json();
    setDomains(d.domains || []);
  }, [router]);

  useEffect(() => {
    load().catch((err) => setError(String(err)));
  }, [load]);

  // Poll Check All Now job until DONE
  useEffect(() => {
    if (!checkJob || checkJob.status === "DONE" || checkJob.status === "FAILED") {
      return;
    }
    let cancelled = false;
    const tick = async () => {
      try {
        const res = await apiFetch(
          `/api/domains/check-all?jobId=${encodeURIComponent(checkJob.id)}&batch=2`,
        );
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Poll failed");
        if (cancelled) return;
        setCheckJob(data.job);
        if (data.domains) setDomains(data.domains);
        const done = new Set<string>(
          (data.job.results || []).map(
            (r: { domainId: string }) => r.domainId,
          ),
        );
        const pending = new Set<string>();
        if (data.job.currentDomainId) pending.add(data.job.currentDomainId);
        for (const id of data.job.pendingDomainIds || []) pending.add(id);
        // Highlight in-flight + not-yet-done
        const active = new Set<string>();
        for (const id of pending) {
          if (!done.has(id)) active.add(id);
        }
        if (data.job.currentDomainId) active.add(data.job.currentDomainId);
        setCheckingIds(active);
        if (data.job.status === "DONE" || data.job.status === "FAILED") {
          setCheckingIds(new Set());
          setBusy(null);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Check-all failed");
          setBusy(null);
          setCheckingIds(new Set());
        }
      }
    };
    const handle = setInterval(() => {
      tick().catch(() => undefined);
    }, 600);
    tick().catch(() => undefined);
    return () => {
      cancelled = true;
      clearInterval(handle);
    };
  }, [checkJob?.id, checkJob?.status]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return domains.filter((d) => {
      if (filter === "blocked" && d.status !== "BLOCKED") return false;
      if (filter === "safe" && d.status === "BLOCKED") return false;
      if (q && !d.url.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [domains, search, filter]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const pageSafe = Math.min(page, totalPages);
  const pageRows = filtered.slice(
    (pageSafe - 1) * PAGE_SIZE,
    pageSafe * PAGE_SIZE,
  );

  useEffect(() => {
    setPage(1);
  }, [search, filter]);

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

  async function submitBulk(e: FormEvent) {
    e.preventDefault();
    setError("");
    setBulkReport("");
    setBusy("bulk");
    try {
      const res = await apiFetch("/api/domains/bulk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: bulkText }),
      });
      const data = await res.json();
      if (!res.ok && !data.created) {
        throw new Error(data.error || "Bulk add failed");
      }
      const parts: string[] = [];
      parts.push(`เพิ่มได้ ${data.createdCount ?? 0} โดเมน`);
      if (data.invalid?.length) {
        parts.push(
          `ไม่ผ่าน ${data.invalid.length}: ${data.invalid
            .slice(0, 5)
            .map((i: { input: string; error: string }) => `${i.input} (${i.error})`)
            .join("; ")}${data.invalid.length > 5 ? "…" : ""}`,
        );
      }
      if (data.alreadyOwned?.length) {
        parts.push(`มีอยู่แล้ว ${data.alreadyOwned.length}`);
      }
      if (data.skippedQuota?.length) {
        parts.push(`เกินโควต้า ข้าม ${data.skippedQuota.length}`);
      }
      if (data.duplicatesInInput?.length) {
        parts.push(`ซ้ำในรายการ ${data.duplicatesInInput.length}`);
      }
      setBulkReport(parts.join(" · "));
      setBulkText("");
      if ((data.createdCount ?? 0) > 0) {
        setBulkOpen(false);
        await load();
      }
      if (!res.ok) setError(data.error || "");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Bulk add failed");
    } finally {
      setBusy(null);
    }
  }

  async function checkAllNow() {
    setError("");
    setBusy("check-all");
    try {
      const res = await apiFetch("/api/domains/check-all", { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Check all failed");
      setCheckJob(data.job);
      if (data.domains) setDomains(data.domains);
      const active = new Set<string>();
      if (data.job.currentDomainId) active.add(data.job.currentDomainId);
      for (const id of data.job.pendingDomainIds || []) active.add(id);
      setCheckingIds(active);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Check all failed");
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
    setCheckingIds(new Set([id]));
    await apiFetch(`/api/domains/${id}/check`, { method: "POST" });
    await load();
    setCheckingIds(new Set());
    setBusy(null);
  }

  async function remove(id: string) {
    if (!confirm("ลบโดเมนนี้?")) return;
    setBusy(id);
    await apiFetch(`/api/domains/${id}`, { method: "DELETE" });
    await load();
    setBusy(null);
  }

  async function saveTelegram(e: FormEvent) {
    e.preventDefault();
    setBusy("tg");
    setError("");
    try {
      const ids = telegramInput
        .split(/[,\n]+/)
        .map((s) => s.trim())
        .filter(Boolean);
      const res = await apiFetch("/api/auth/me", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ telegram_chat_ids: ids }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed");
    } finally {
      setBusy(null);
    }
  }

  async function logout() {
    await apiFetch("/api/auth/logout", { method: "POST" });
    router.push("/");
  }

  const quotaLabel = me?.domain_quota
    ? `${me.domain_quota.used}/${me.domain_quota.total_slots}`
    : me?.plan
      ? `${me.domain_count}/${me.plan.max_domains}`
      : null;

  const remainingSlots = me?.domain_quota
    ? Math.max(0, me.domain_quota.total_slots - me.domain_quota.used)
    : null;

  const checkAllRunning =
    !!checkJob && checkJob.status !== "DONE" && checkJob.status !== "FAILED";

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
              {me?.user.email} · {me?.plan?.name || "Free"}
              {me?.user.billing_cycle ? ` (${me.user.billing_cycle})` : ""} ·{" "}
              {me?.user.subscription_status}
              {quotaLabel ? ` · โควต้า ${quotaLabel}` : null}
              {me?.domain_quota?.extra_domain_slots
                ? ` (+${me.domain_quota.extra_domain_slots} extra)`
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

        <div className="mt-6 flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={checkAllNow}
            disabled={busy === "check-all" || checkAllRunning || domains.length === 0}
            className="inline-flex items-center gap-2 rounded-md bg-ember-500 px-4 py-2.5 text-sm font-semibold hover:bg-ember-400 disabled:opacity-60"
          >
            <Zap className={`h-4 w-4 ${checkAllRunning ? "animate-pulse" : ""}`} />
            ⚡ ตรวจสอบทั้งหมด (Check All Now)
          </button>
          {checkJob && (
            <div className="min-w-[200px] flex-1 sm:max-w-sm">
              <div className="flex justify-between text-xs text-mist">
                <span>
                  {checkJob.status === "DONE"
                    ? "ตรวจครบแล้ว"
                    : "กำลังตรวจ…"}{" "}
                  {checkJob.completed}/{checkJob.total}
                </span>
                <span>{checkJob.percent}%</span>
              </div>
              <div className="mt-1 h-2 overflow-hidden rounded bg-ink-800">
                <div
                  className="h-full bg-ember-500 transition-all duration-300"
                  style={{ width: `${checkJob.percent}%` }}
                />
              </div>
            </div>
          )}
        </div>

        <form
          onSubmit={saveTelegram}
          className="mt-6 flex flex-col gap-2 sm:flex-row sm:items-end"
        >
          <label className="flex-1 text-sm text-mist">
            Telegram chat/group IDs
            {me?.plan?.max_telegram_groups
              ? ` (สูงสุด ${me.plan.max_telegram_groups >= 99 ? "ไม่จำกัด" : me.plan.max_telegram_groups})`
              : ""}
            <input
              value={telegramInput}
              onChange={(e) => setTelegramInput(e.target.value)}
              placeholder="-100..., -100... (คั่นด้วยจุลภาค)"
              className="mt-1 w-full rounded-md border border-white/10 bg-ink-800 px-3 py-2.5 outline-none ring-ember-500 focus:ring-1"
            />
          </label>
          <button
            type="submit"
            disabled={busy === "tg"}
            className="rounded-md border border-white/10 px-4 py-2.5 text-sm hover:bg-white/5 disabled:opacity-60"
          >
            บันทึก Telegram
          </button>
        </form>

        <div className="mt-8 flex flex-col gap-3 sm:flex-row">
          <form onSubmit={addDomain} className="flex flex-1 flex-col gap-3 sm:flex-row">
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
          <button
            type="button"
            onClick={() => {
              setBulkOpen(true);
              setBulkReport("");
            }}
            className="inline-flex items-center justify-center gap-2 rounded-md border border-white/10 px-4 py-2.5 text-sm hover:bg-white/5"
          >
            <ListPlus className="h-4 w-4" /> เพิ่มหลายโดเมน
          </button>
        </div>
        {error && <p className="mt-3 text-sm text-ember-400">{error}</p>}
        {bulkReport && !bulkOpen && (
          <p className="mt-2 text-sm text-mist">{bulkReport}</p>
        )}

        <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:items-center">
          <label className="relative flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-mist" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="ค้นหาโดเมน…"
              className="w-full rounded-md border border-white/10 bg-ink-800 py-2.5 pl-10 pr-3 outline-none ring-ember-500 focus:ring-1"
            />
          </label>
          <div className="flex gap-2 text-sm">
            {(
              [
                ["all", "ทั้งหมด"],
                ["blocked", "ถูกบล็อก"],
                ["safe", "ปลอดภัย"],
              ] as const
            ).map(([key, label]) => (
              <button
                key={key}
                type="button"
                onClick={() => setFilter(key)}
                className={`rounded-md px-3 py-2 ${
                  filter === key
                    ? "bg-ember-500/20 text-ember-400 ring-1 ring-ember-500/40"
                    : "border border-white/10 text-mist hover:bg-white/5"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        <div className="mt-4 flex items-center justify-between text-xs text-mist">
          <span>
            แสดง {filtered.length === 0 ? 0 : (pageSafe - 1) * PAGE_SIZE + 1}–
            {Math.min(pageSafe * PAGE_SIZE, filtered.length)} จาก{" "}
            {filtered.length} โดเมน
            {domains.length !== filtered.length
              ? ` (ทั้งหมด ${domains.length})`
              : ""}
          </span>
          <div className="flex gap-2">
            <button
              type="button"
              disabled={pageSafe <= 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              className="rounded border border-white/10 px-2 py-1 disabled:opacity-40"
            >
              ก่อนหน้า
            </button>
            <span className="px-1 py-1">
              {pageSafe}/{totalPages}
            </span>
            <button
              type="button"
              disabled={pageSafe >= totalPages}
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              className="rounded border border-white/10 px-2 py-1 disabled:opacity-40"
            >
              ถัดไป
            </button>
          </div>
        </div>

        <div className="mt-4 space-y-4">
          {pageRows.length === 0 && (
            <p className="text-mist">
              {domains.length === 0
                ? "ยังไม่มีโดเมน — เพิ่มโดเมนแรกเพื่อเริ่มมอนิเตอร์"
                : "ไม่พบโดเมนตามตัวกรอง"}
            </p>
          )}
          {pageRows.map((d) => {
            const rowBusy =
              busy === d.id || checkingIds.has(d.id) || checkAllRunning;
            return (
              <article
                key={d.id}
                className={`border border-white/10 bg-ink-900/70 p-5 backdrop-blur transition ${
                  checkingIds.has(d.id) ? "ring-1 ring-ember-500/50" : ""
                }`}
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h2 className="flex items-center gap-2 text-lg font-semibold">
                      {d.url}
                      {checkingIds.has(d.id) && (
                        <RefreshCw className="h-4 w-4 animate-spin text-ember-400" />
                      )}
                    </h2>
                    <p className="mt-1 text-xs text-mist">
                      สถานะรวม:{" "}
                      <span
                        className={statusClass(
                          d.status === "BLOCKED" ? "BLOCKED" : "SAFE",
                        )}
                      >
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
                      disabled={rowBusy}
                      className="rounded-md border border-white/10 p-2 hover:bg-white/5 disabled:opacity-50"
                      title="Toggle monitoring"
                    >
                      <Power
                        className={`h-4 w-4 ${d.monitoring_enabled ? "text-emerald-400" : "text-zinc-500"}`}
                      />
                    </button>
                    <button
                      onClick={() => recheck(d.id)}
                      disabled={rowBusy}
                      className="rounded-md border border-white/10 p-2 hover:bg-white/5 disabled:opacity-50"
                      title="Recheck now"
                    >
                      <RefreshCw className="h-4 w-4" />
                    </button>
                    <button
                      onClick={() => remove(d.id)}
                      disabled={rowBusy}
                      className="rounded-md border border-white/10 p-2 hover:bg-white/5 disabled:opacity-50"
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
            );
          })}
        </div>
      </div>

      {bulkOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
          <div className="w-full max-w-lg border border-white/10 bg-ink-900 p-6 shadow-xl">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold">เพิ่มหลายโดเมน</h2>
                <p className="mt-1 text-sm text-mist">
                  วางโดเมนทีละบรรทัด (สูงสุดตามโควต้า
                  {remainingSlots != null ? ` — เหลือ ${remainingSlots}` : ""}
                  ). ตัด http(s):// อัตโนมัติ
                </p>
              </div>
              <button
                type="button"
                onClick={() => setBulkOpen(false)}
                className="rounded p-1 hover:bg-white/5"
                aria-label="Close"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <form onSubmit={submitBulk} className="mt-4 space-y-3">
              <textarea
                value={bulkText}
                onChange={(e) => setBulkText(e.target.value)}
                rows={10}
                placeholder={"example.com\nhttps://foo.co.th\nbar.net"}
                className="w-full rounded-md border border-white/10 bg-ink-800 px-3 py-2.5 font-mono text-sm outline-none ring-ember-500 focus:ring-1"
                required
              />
              {bulkReport && (
                <p className="text-sm text-mist">{bulkReport}</p>
              )}
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setBulkOpen(false)}
                  className="rounded-md border border-white/10 px-4 py-2 text-sm hover:bg-white/5"
                >
                  ยกเลิก
                </button>
                <button
                  type="submit"
                  disabled={busy === "bulk"}
                  className="rounded-md bg-ember-500 px-4 py-2 text-sm font-semibold hover:bg-ember-400 disabled:opacity-60"
                >
                  {busy === "bulk" ? "กำลังเพิ่ม…" : "เพิ่มทั้งหมดที่ถูกต้อง"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </main>
  );
}
