"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { apiFetch } from "@/lib/client-fetch";

type Plan = {
  id: string;
  name: string;
  code: string | null;
  price: string;
  price_monthly: string | null;
  price_yearly: string | null;
  max_domains: number;
  interval_days: number;
  check_interval_minutes: number;
  history_days: number;
  max_telegram_groups: number;
  badge: string | null;
  sort_order: number;
  is_active: boolean;
};

const empty = {
  id: "",
  name: "",
  code: "",
  price_monthly: "0",
  price_yearly: "0",
  max_domains: 1,
  interval_days: 30,
  check_interval_minutes: 15,
  history_days: 7,
  max_telegram_groups: 1,
  badge: "",
  sort_order: 100,
  is_active: true,
};

export default function AdminPlansPage() {
  const router = useRouter();
  const [plans, setPlans] = useState<Plan[]>([]);
  const [form, setForm] = useState(empty);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    const res = await apiFetch("/api/admin/plans");
    if (res.status === 401 || res.status === 403) {
      router.push("/login?next=/admin/plans");
      return;
    }
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Failed");
    setPlans(data.plans || []);
  }, [router]);

  useEffect(() => {
    load().catch((err) => setError(String(err)));
  }, [load]);

  async function save(e: FormEvent) {
    e.preventDefault();
    setError("");
    const res = await apiFetch("/api/admin/plans", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: form.id || undefined,
        name: form.name,
        code: form.code || undefined,
        price_monthly: Number(form.price_monthly),
        price_yearly: Number(form.price_yearly),
        max_domains: Number(form.max_domains),
        interval_days: Number(form.interval_days),
        check_interval_minutes: Number(form.check_interval_minutes),
        history_days: Number(form.history_days),
        max_telegram_groups: Number(form.max_telegram_groups),
        badge: form.badge || null,
        sort_order: Number(form.sort_order),
        is_active: form.is_active,
      }),
    });
    const data = await res.json();
    if (!res.ok) {
      setError(data.error || "Failed");
      return;
    }
    setForm(empty);
    await load();
  }

  async function remove(id: string) {
    if (!confirm(`Delete plan ${id}?`)) return;
    const res = await apiFetch("/api/admin/plans", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    });
    const data = await res.json();
    if (!res.ok) {
      setError(data.error || "Failed");
      return;
    }
    await load();
  }

  return (
    <div className="animate-rise">
      <h1 className="font-display text-4xl tracking-wide">Plans</h1>
      <p className="mt-2 text-sm text-mist">
        Full-option tiers: monthly/yearly price, domains, check interval, history,
        telegram groups.
      </p>
      {error && <p className="mt-3 text-sm text-ember-400">{error}</p>}

      <form
        onSubmit={save}
        className="mt-6 grid gap-3 border border-white/10 bg-ink-900/70 p-4 sm:grid-cols-3"
      >
        <input
          placeholder="id (optional on create)"
          value={form.id}
          onChange={(e) => setForm({ ...form, id: e.target.value })}
          className="rounded-md border border-white/10 bg-ink-800 px-3 py-2"
        />
        <input
          placeholder="name"
          required
          value={form.name}
          onChange={(e) => setForm({ ...form, name: e.target.value })}
          className="rounded-md border border-white/10 bg-ink-800 px-3 py-2"
        />
        <input
          placeholder="code"
          value={form.code}
          onChange={(e) => setForm({ ...form, code: e.target.value })}
          className="rounded-md border border-white/10 bg-ink-800 px-3 py-2"
        />
        <input
          placeholder="price_monthly"
          required
          type="number"
          step="0.01"
          value={form.price_monthly}
          onChange={(e) => setForm({ ...form, price_monthly: e.target.value })}
          className="rounded-md border border-white/10 bg-ink-800 px-3 py-2"
        />
        <input
          placeholder="price_yearly"
          required
          type="number"
          step="0.01"
          value={form.price_yearly}
          onChange={(e) => setForm({ ...form, price_yearly: e.target.value })}
          className="rounded-md border border-white/10 bg-ink-800 px-3 py-2"
        />
        <input
          placeholder="max_domains"
          type="number"
          required
          value={form.max_domains}
          onChange={(e) =>
            setForm({ ...form, max_domains: Number(e.target.value) })
          }
          className="rounded-md border border-white/10 bg-ink-800 px-3 py-2"
        />
        <input
          placeholder="check_interval_minutes"
          type="number"
          value={form.check_interval_minutes}
          onChange={(e) =>
            setForm({
              ...form,
              check_interval_minutes: Number(e.target.value),
            })
          }
          className="rounded-md border border-white/10 bg-ink-800 px-3 py-2"
        />
        <input
          placeholder="history_days"
          type="number"
          value={form.history_days}
          onChange={(e) =>
            setForm({ ...form, history_days: Number(e.target.value) })
          }
          className="rounded-md border border-white/10 bg-ink-800 px-3 py-2"
        />
        <input
          placeholder="max_telegram_groups"
          type="number"
          value={form.max_telegram_groups}
          onChange={(e) =>
            setForm({ ...form, max_telegram_groups: Number(e.target.value) })
          }
          className="rounded-md border border-white/10 bg-ink-800 px-3 py-2"
        />
        <input
          placeholder="badge (popular|enterprise)"
          value={form.badge}
          onChange={(e) => setForm({ ...form, badge: e.target.value })}
          className="rounded-md border border-white/10 bg-ink-800 px-3 py-2"
        />
        <input
          placeholder="sort_order"
          type="number"
          value={form.sort_order}
          onChange={(e) =>
            setForm({ ...form, sort_order: Number(e.target.value) })
          }
          className="rounded-md border border-white/10 bg-ink-800 px-3 py-2"
        />
        <label className="flex items-center gap-2 text-sm text-mist">
          <input
            type="checkbox"
            checked={form.is_active}
            onChange={(e) => setForm({ ...form, is_active: e.target.checked })}
          />
          active
        </label>
        <button
          type="submit"
          className="rounded-md bg-ember-500 px-4 py-2 font-semibold hover:bg-ember-400 sm:col-span-3"
        >
          Save plan (create / update)
        </button>
      </form>

      <div className="mt-6 space-y-2">
        {plans.map((p) => (
          <div
            key={p.id}
            className="flex flex-wrap items-center justify-between gap-3 border border-white/10 bg-ink-900/60 px-4 py-3"
          >
            <div>
              <div className="font-semibold">
                {p.name}
                {!p.is_active ? (
                  <span className="ml-2 text-xs text-mist">(inactive)</span>
                ) : null}
                {p.badge ? (
                  <span className="ml-2 text-xs text-ember-400">{p.badge}</span>
                ) : null}
              </div>
              <div className="text-xs text-mist">
                {p.id} · {p.code} · ฿{p.price_monthly ?? p.price}/mo · ฿
                {p.price_yearly}/yr · {p.max_domains} domains · check{" "}
                {p.check_interval_minutes}m · hist {p.history_days}d · tg{" "}
                {p.max_telegram_groups}
              </div>
            </div>
            <div className="flex gap-2">
              <button
                onClick={() =>
                  setForm({
                    id: p.id,
                    name: p.name,
                    code: p.code || "",
                    price_monthly: p.price_monthly || p.price,
                    price_yearly: p.price_yearly || "0",
                    max_domains: p.max_domains,
                    interval_days: p.interval_days,
                    check_interval_minutes: p.check_interval_minutes,
                    history_days: p.history_days,
                    max_telegram_groups: p.max_telegram_groups,
                    badge: p.badge || "",
                    sort_order: p.sort_order,
                    is_active: p.is_active,
                  })
                }
                className="rounded border border-white/10 px-3 py-1 text-sm hover:bg-white/5"
              >
                Edit
              </button>
              <button
                onClick={() => remove(p.id)}
                className="rounded border border-ember-600/40 px-3 py-1 text-sm text-ember-400 hover:bg-ember-600/20"
              >
                Delete
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
