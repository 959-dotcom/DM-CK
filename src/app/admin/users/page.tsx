"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { apiFetch } from "@/lib/client-fetch";

type UserRow = {
  id: string;
  email: string;
  role: string;
  subscription_status: string;
  plan_id: string | null;
  plan_expire_at: string | null;
  telegram_chat_id: string | null;
  disabled: boolean;
};

export default function AdminUsersPage() {
  const router = useRouter();
  const [users, setUsers] = useState<UserRow[]>([]);
  const [q, setQ] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async (query = "") => {
    const res = await apiFetch(
      `/api/admin/users${query ? `?q=${encodeURIComponent(query)}` : ""}`,
    );
    if (res.status === 401 || res.status === 403) {
      router.push("/login?next=/admin/users");
      return;
    }
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Failed");
    setUsers(data.users || []);
  }, [router]);

  useEffect(() => {
    load().catch((err) => setError(String(err)));
  }, [load]);

  async function search(e: FormEvent) {
    e.preventDefault();
    setError("");
    try {
      await load(q);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed");
    }
  }

  async function patch(id: string, body: Record<string, unknown>) {
    setBusy(id);
    setError("");
    try {
      const res = await apiFetch("/api/admin/users", {
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
      <h1 className="font-display text-4xl tracking-wide">Users</h1>
      <form onSubmit={search} className="mt-6 flex gap-2">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search email / id / telegram"
          className="flex-1 rounded-md border border-white/10 bg-ink-800 px-3 py-2 outline-none ring-ember-500 focus:ring-1"
        />
        <button
          type="submit"
          className="rounded-md bg-ember-500 px-4 py-2 font-semibold hover:bg-ember-400"
        >
          Search
        </button>
      </form>
      {error && <p className="mt-3 text-sm text-ember-400">{error}</p>}

      <div className="mt-6 space-y-3">
        {users.map((u) => (
          <article
            key={u.id}
            className="border border-white/10 bg-ink-900/70 p-4"
          >
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="font-semibold">
                  {u.email}{" "}
                  {u.disabled && (
                    <span className="text-xs text-ember-400">(disabled)</span>
                  )}
                </div>
                <div className="mt-1 text-xs text-mist">
                  {u.role} · {u.subscription_status} · {u.plan_id || "no plan"}
                  {u.plan_expire_at
                    ? ` · expires ${new Date(u.plan_expire_at).toLocaleDateString("th-TH")}`
                    : ""}
                </div>
                <div className="mt-1 text-xs text-mist">
                  telegram: {u.telegram_chat_id || "—"}
                </div>
              </div>
              <div className="flex flex-wrap gap-2 text-xs">
                <select
                  disabled={busy === u.id}
                  defaultValue={u.role}
                  onChange={(e) => patch(u.id, { role: e.target.value })}
                  className="rounded border border-white/10 bg-ink-800 px-2 py-1"
                >
                  <option value="USER">USER</option>
                  <option value="ADMIN">ADMIN</option>
                </select>
                <select
                  disabled={busy === u.id}
                  defaultValue={u.subscription_status}
                  onChange={(e) =>
                    patch(u.id, { subscription_status: e.target.value })
                  }
                  className="rounded border border-white/10 bg-ink-800 px-2 py-1"
                >
                  <option value="FREE">FREE</option>
                  <option value="TRIAL">TRIAL</option>
                  <option value="ACTIVE">ACTIVE</option>
                  <option value="EXPIRED">EXPIRED</option>
                </select>
                <button
                  disabled={busy === u.id}
                  onClick={() => {
                    const v = prompt(
                      "telegram_chat_id",
                      u.telegram_chat_id || "",
                    );
                    if (v === null) return;
                    patch(u.id, { telegram_chat_id: v || null });
                  }}
                  className="rounded border border-white/10 px-2 py-1 hover:bg-white/5"
                >
                  Telegram
                </button>
                <button
                  disabled={busy === u.id}
                  onClick={() => {
                    const v = prompt(
                      "plan_expire_at (ISO or empty)",
                      u.plan_expire_at || "",
                    );
                    if (v === null) return;
                    patch(u.id, { plan_expire_at: v || null });
                  }}
                  className="rounded border border-white/10 px-2 py-1 hover:bg-white/5"
                >
                  Expiry
                </button>
                <button
                  disabled={busy === u.id}
                  onClick={() => patch(u.id, { disabled: !u.disabled })}
                  className="rounded border border-ember-600/50 px-2 py-1 text-ember-400 hover:bg-ember-600/20"
                >
                  {u.disabled ? "Enable" : "Disable"}
                </button>
              </div>
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}
