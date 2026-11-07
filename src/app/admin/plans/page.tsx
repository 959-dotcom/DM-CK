"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { apiFetch } from "@/lib/client-fetch";

type Plan = {
  id: string;
  name: string;
  price: string;
  max_domains: number;
  interval_days: number;
  check_interval_minutes: number;
};

const empty = {
  id: "",
  name: "",
  price: "0",
  max_domains: 1,
  interval_days: 30,
  check_interval_minutes: 15,
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
        price: Number(form.price),
        max_domains: Number(form.max_domains),
        interval_days: Number(form.interval_days),
        check_interval_minutes: Number(form.check_interval_minutes),
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
          placeholder="price"
          required
          type="number"
          step="0.01"
          value={form.price}
          onChange={(e) => setForm({ ...form, price: e.target.value })}
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
          placeholder="interval_days"
          type="number"
          required
          value={form.interval_days}
          onChange={(e) =>
            setForm({ ...form, interval_days: Number(e.target.value) })
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
              <div className="font-semibold">{p.name}</div>
              <div className="text-xs text-mist">
                {p.id} · ฿{p.price} · {p.max_domains} domains ·{" "}
                {p.interval_days}d · check {p.check_interval_minutes}m
              </div>
            </div>
            <div className="flex gap-2">
              <button
                onClick={() =>
                  setForm({
                    id: p.id,
                    name: p.name,
                    price: p.price,
                    max_domains: p.max_domains,
                    interval_days: p.interval_days,
                    check_interval_minutes: p.check_interval_minutes,
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
