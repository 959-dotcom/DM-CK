"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { apiFetch } from "@/lib/client-fetch";

type Txn = {
  id: string;
  email: string;
  plan_name: string;
  amount: string;
  payment_status: string;
  slip_url: string | null;
  qr_ref: string | null;
  created_at: string;
};

export default function AdminTransactionsPage() {
  const router = useRouter();
  const [status, setStatus] = useState("PENDING");
  const [rows, setRows] = useState<Txn[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await apiFetch(
      `/api/admin/transactions?status=${encodeURIComponent(status)}`,
    );
    if (res.status === 401 || res.status === 403) {
      router.push("/login?next=/admin/transactions");
      return;
    }
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Failed");
    setRows(data.transactions || []);
  }, [router, status]);

  useEffect(() => {
    load().catch((err) => setError(String(err)));
  }, [load]);

  async function decide(id: string, next: "APPROVED" | "REJECTED") {
    setBusy(id);
    setError("");
    try {
      const note =
        next === "REJECTED"
          ? prompt("Rejection note (optional)") || undefined
          : undefined;
      const res = await apiFetch("/api/admin/transactions", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, status: next, note }),
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

  return (
    <div className="animate-rise">
      <h1 className="font-display text-4xl tracking-wide">Transactions</h1>
      <div className="mt-4 flex flex-wrap gap-2">
        {["PENDING", "APPROVED", "REJECTED", "ALL"].map((s) => (
          <button
            key={s}
            onClick={() => setStatus(s === "ALL" ? "" : s)}
            className={`rounded-md px-3 py-1.5 text-sm ${
              (s === "ALL" ? status === "" : status === s)
                ? "bg-ember-600/40 text-white"
                : "border border-white/10 text-mist hover:bg-white/5"
            }`}
          >
            {s}
          </button>
        ))}
      </div>
      {error && <p className="mt-3 text-sm text-ember-400">{error}</p>}

      <div className="mt-6 space-y-3">
        {rows.length === 0 && (
          <p className="text-sm text-mist">No transactions in this filter.</p>
        )}
        {rows.map((t) => (
          <article
            key={t.id}
            className="border border-white/10 bg-ink-900/70 p-4"
          >
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="font-semibold">
                  {t.email} · {t.plan_name} · ฿{t.amount}
                </div>
                <div className="mt-1 text-xs text-mist">
                  {t.payment_status} · {t.qr_ref || "—"} ·{" "}
                  {new Date(t.created_at).toLocaleString("th-TH")}
                </div>
                {t.slip_url && (
                  <a
                    href={t.slip_url}
                    target="_blank"
                    rel="noreferrer"
                    className="mt-1 inline-block text-xs text-ember-400 hover:underline"
                  >
                    View slip
                  </a>
                )}
              </div>
              {t.payment_status === "PENDING" && (
                <div className="flex gap-2">
                  <button
                    disabled={busy === t.id}
                    onClick={() => decide(t.id, "APPROVED")}
                    className="rounded-md bg-emerald-600/80 px-3 py-1.5 text-sm font-semibold hover:bg-emerald-500"
                  >
                    Approve
                  </button>
                  <button
                    disabled={busy === t.id}
                    onClick={() => decide(t.id, "REJECTED")}
                    className="rounded-md bg-ember-600/80 px-3 py-1.5 text-sm font-semibold hover:bg-ember-500"
                  >
                    Reject
                  </button>
                </div>
              )}
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}
