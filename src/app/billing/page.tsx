"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Check, Minus, Plus } from "lucide-react";
import { Nav } from "@/components/Nav";
import { apiFetch } from "@/lib/client-fetch";
import {
  DEFAULT_PROMPTPAY_ID,
  EXTRA_DOMAIN_SLOT_PRICE,
} from "@/lib/constants";

type Plan = {
  id: string;
  name: string;
  code: string | null;
  price_monthly: string;
  price_yearly: string;
  max_domains: number;
  check_interval_minutes: number;
  history_days: number;
  max_telegram_groups: number;
  badge: string | null;
};

type PendingPay = {
  kind: "plan" | "addon";
  id: string;
  title: string;
  amount: number;
  qr_ref: string;
  qr_data_url: string;
  promptpay_id: string;
};

type Cycle = "MONTHLY" | "YEARLY";

function featureLines(p: Plan): string[] {
  const telegram =
    p.max_telegram_groups >= 99
      ? "Telegram groups: ไม่จำกัด"
      : `Telegram groups: ${p.max_telegram_groups}`;
  return [
    `สูงสุด ${p.max_domains} โดเมน`,
    `ตรวจทุก ${p.check_interval_minutes} นาที`,
    `เก็บประวัติ ${p.history_days} วัน`,
    telegram,
  ];
}

export default function BillingPage() {
  const router = useRouter();
  const [plans, setPlans] = useState<Plan[]>([]);
  const [cycle, setCycle] = useState<Cycle>("MONTHLY");
  const [addonQty, setAddonQty] = useState(1);
  const [pending, setPending] = useState<PendingPay | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [extraSlots, setExtraSlots] = useState(0);

  useEffect(() => {
    (async () => {
      const me = await apiFetch("/api/auth/me");
      if (me.status === 401) {
        router.push("/login");
        return;
      }
      const meData = await me.json();
      setExtraSlots(meData.domain_quota?.extra_domain_slots ?? 0);

      const res = await apiFetch("/api/plans");
      const data = await res.json();
      setPlans(
        (data.plans || []).filter(
          (p: Plan) => Number(p.price_monthly) > 0 || Number(p.price_yearly) > 0,
        ),
      );
    })().catch((err) => setError(String(err)));
  }, [router]);

  const paidPlans = useMemo(
    () => plans.filter((p) => p.code !== "free"),
    [plans],
  );

  function priceFor(p: Plan): number {
    return cycle === "YEARLY"
      ? Number(p.price_yearly)
      : Number(p.price_monthly);
  }

  async function choosePlan(planId: string) {
    setError("");
    setMessage("");
    setLoading(true);
    try {
      const res = await apiFetch("/api/transactions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ plan_id: planId, billing_cycle: cycle }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed");
      setPending({
        kind: "plan",
        id: data.transaction.id,
        title: `${data.transaction.plan_name} · ${cycle === "YEARLY" ? "Yearly" : "Monthly"}`,
        amount: data.transaction.amount,
        qr_ref: data.transaction.qr_ref,
        qr_data_url: data.promptpay.qr_data_url,
        promptpay_id: data.promptpay.id,
      });
      setFile(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed");
    } finally {
      setLoading(false);
    }
  }

  async function checkoutAddon() {
    setError("");
    setMessage("");
    setLoading(true);
    try {
      const res = await apiFetch("/api/addons", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slots: addonQty }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed");
      setPending({
        kind: "addon",
        id: data.addon.id,
        title: data.addon.name,
        amount: data.addon.amount,
        qr_ref: data.addon.qr_ref,
        qr_data_url: data.promptpay.qr_data_url,
        promptpay_id: data.promptpay.id,
      });
      setFile(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed");
    } finally {
      setLoading(false);
    }
  }

  async function uploadSlip(e: FormEvent) {
    e.preventDefault();
    if (!pending || !file) return;
    setLoading(true);
    setError("");
    setMessage("");
    try {
      const form = new FormData();
      form.append("slip", file);
      const path =
        pending.kind === "addon"
          ? `/api/addons/${pending.id}/slip`
          : `/api/transactions/${pending.id}/slip`;
      const res = await apiFetch(path, { method: "POST", body: form });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Verify failed");
      if (data.pending_manual) {
        setMessage(
          data.message ||
            "สลิปถูกส่งให้แอดมินตรวจสอบแล้ว — จะแจ้งเมื่ออนุมัติ",
        );
        setPending(null);
        return;
      }
      setMessage(
        data.verify?.mock
          ? "ชำระเงินสำเร็จ (mock verify)"
          : "ชำระเงินสำเร็จ — อัปเกรดเรียบร้อย",
      );
      if (pending.kind === "addon" && typeof data.extra_domain_slots === "number") {
        setExtraSlots(data.extra_domain_slots);
      }
      setPending(null);
      setTimeout(() => router.push("/dashboard"), 1200);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="min-h-screen bg-ink-950 text-white">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_top,_rgba(225,29,46,0.18),_transparent_55%)]" />
      <div className="pointer-events-none absolute inset-0 bg-grid bg-[size:48px_48px] opacity-40" />
      <Nav authed />
      <div className="relative mx-auto max-w-6xl px-6 py-10 md:px-10">
        <div className="animate-rise">
          <p className="font-display text-sm tracking-[0.2em] text-ember-400">
            SPINLYTICS BILLING
          </p>
          <h1 className="mt-2 font-display text-5xl tracking-wide md:text-6xl">
            เลือกแพ็กที่ใช่
          </h1>
          <p className="mt-3 max-w-2xl text-mist">
            PromptPay {DEFAULT_PROMPTPAY_ID} · สแกน QR ตามยอดเป๊ะ แล้วอัปโหลดสลิปเพื่อยืนยันอัตโนมัติ
          </p>
        </div>

        {!pending && (
          <>
            <div className="animate-rise-delay mt-8 flex flex-wrap items-center gap-3">
              <div className="inline-flex rounded-md border border-white/10 bg-ink-900/80 p-1">
                <button
                  type="button"
                  onClick={() => setCycle("MONTHLY")}
                  className={`rounded px-4 py-2 text-sm font-semibold transition ${
                    cycle === "MONTHLY"
                      ? "bg-ember-500 text-white"
                      : "text-mist hover:text-white"
                  }`}
                >
                  Monthly
                </button>
                <button
                  type="button"
                  onClick={() => setCycle("YEARLY")}
                  className={`rounded px-4 py-2 text-sm font-semibold transition ${
                    cycle === "YEARLY"
                      ? "bg-ember-500 text-white"
                      : "text-mist hover:text-white"
                  }`}
                >
                  Yearly — ประหยัด 2 เดือน
                </button>
              </div>
            </div>

            <div className="animate-rise-delay-2 mt-8 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              {paidPlans.map((p) => {
                const amount = priceFor(p);
                const popular = p.badge === "popular";
                const enterprise = p.badge === "enterprise";
                return (
                  <article
                    key={p.id}
                    className={`relative flex flex-col border bg-ink-900/80 p-5 backdrop-blur transition hover:border-ember-500/50 ${
                      popular
                        ? "border-ember-500/70 shadow-glow"
                        : "border-white/10"
                    }`}
                  >
                    {(popular || enterprise) && (
                      <span
                        className={`absolute -top-3 left-4 rounded px-2 py-0.5 text-xs font-semibold uppercase tracking-wide ${
                          popular
                            ? "bg-ember-500 text-white"
                            : "bg-white text-ink-950"
                        }`}
                      >
                        {popular ? "Popular" : "Enterprise"}
                      </span>
                    )}
                    <h2 className="font-display text-3xl tracking-wide">
                      {p.name}
                    </h2>
                    <p className="mt-3 text-4xl font-semibold text-ember-400">
                      ฿{amount.toLocaleString("th-TH")}
                      <span className="ml-1 text-sm font-normal text-mist">
                        /{cycle === "YEARLY" ? "ปี" : "เดือน"}
                      </span>
                    </p>
                    <ul className="mt-5 flex-1 space-y-2 text-sm text-mist">
                      {featureLines(p).map((line) => (
                        <li key={line} className="flex gap-2">
                          <Check className="mt-0.5 h-4 w-4 shrink-0 text-ember-400" />
                          <span>{line}</span>
                        </li>
                      ))}
                    </ul>
                    <button
                      disabled={loading}
                      onClick={() => choosePlan(p.id)}
                      className="mt-6 w-full rounded-md bg-ember-500 py-2.5 font-semibold hover:bg-ember-400 disabled:opacity-60"
                    >
                      เลือกแพ็กนี้
                    </button>
                  </article>
                );
              })}
            </div>

            <section className="mt-12 border border-white/10 bg-ink-900/70 p-6">
              <h2 className="font-display text-3xl tracking-wide">
                Add-on · Extra Domain Slot
              </h2>
              <p className="mt-2 text-sm text-mist">
                เพิ่มโควต้าโดเมน +฿{EXTRA_DOMAIN_SLOT_PRICE}/โดเมน/เดือน · ปัจจุบันมี extra{" "}
                {extraSlots} สล็อต
              </p>
              <div className="mt-5 flex flex-wrap items-center gap-4">
                <div className="inline-flex items-center gap-3 rounded-md border border-white/10 bg-ink-800 px-3 py-2">
                  <button
                    type="button"
                    aria-label="decrease"
                    onClick={() => setAddonQty((q) => Math.max(1, q - 1))}
                    className="rounded p-1 hover:bg-white/10"
                  >
                    <Minus className="h-4 w-4" />
                  </button>
                  <span className="min-w-8 text-center text-lg font-semibold">
                    {addonQty}
                  </span>
                  <button
                    type="button"
                    aria-label="increase"
                    onClick={() => setAddonQty((q) => Math.min(100, q + 1))}
                    className="rounded p-1 hover:bg-white/10"
                  >
                    <Plus className="h-4 w-4" />
                  </button>
                </div>
                <p className="text-xl font-semibold text-ember-400">
                  ฿{(addonQty * EXTRA_DOMAIN_SLOT_PRICE).toLocaleString("th-TH")}
                </p>
                <button
                  type="button"
                  disabled={loading}
                  onClick={checkoutAddon}
                  className="rounded-md bg-ember-500 px-5 py-2.5 font-semibold hover:bg-ember-400 disabled:opacity-60"
                >
                  ชำระ Add-on
                </button>
              </div>
            </section>

            <section className="mt-12 overflow-x-auto">
              <h2 className="font-display text-3xl tracking-wide">
                เปรียบเทียบแพ็ก
              </h2>
              <table className="mt-5 w-full min-w-[640px] border-collapse text-left text-sm">
                <thead>
                  <tr className="border-b border-white/10 text-mist">
                    <th className="py-3 pr-4 font-medium">ฟีเจอร์</th>
                    {paidPlans.map((p) => (
                      <th key={p.id} className="px-3 py-3 font-medium">
                        {p.name}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {(
                    [
                      ["ราคา/เดือน", (p: Plan) => `฿${Number(p.price_monthly).toLocaleString("th-TH")}`],
                      ["ราคา/ปี", (p: Plan) => `฿${Number(p.price_yearly).toLocaleString("th-TH")}`],
                      ["โดเมน", (p: Plan) => String(p.max_domains)],
                      ["รอบตรวจ (นาที)", (p: Plan) => String(p.check_interval_minutes)],
                      ["ประวัติ (วัน)", (p: Plan) => String(p.history_days)],
                      [
                        "Telegram groups",
                        (p: Plan) =>
                          p.max_telegram_groups >= 99
                            ? "ไม่จำกัด"
                            : String(p.max_telegram_groups),
                      ],
                    ] as const
                  ).map(([label, fn]) => (
                    <tr key={label} className="border-b border-white/5">
                      <td className="py-3 pr-4 text-mist">{label}</td>
                      {paidPlans.map((p) => (
                        <td key={p.id} className="px-3 py-3 font-medium">
                          {fn(p)}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          </>
        )}

        {pending && (
          <div className="mt-10 grid gap-8 md:grid-cols-2">
            <div className="border border-white/10 bg-ink-900/70 p-6">
              <h2 className="font-display text-3xl tracking-wide">
                สแกน QR เพื่อชำระ
              </h2>
              <p className="mt-2 text-mist">
                {pending.title} · ฿{pending.amount.toLocaleString("th-TH")}
              </p>
              <p className="mt-1 text-xs text-mist">
                PromptPay: {pending.promptpay_id} · Ref: {pending.qr_ref}
              </p>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={pending.qr_data_url}
                alt="PromptPay QR"
                className="mt-4 w-64 rounded-md bg-white p-2"
              />
            </div>
            <form
              onSubmit={uploadSlip}
              className="border border-white/10 bg-ink-900/70 p-6"
            >
              <h2 className="font-display text-3xl tracking-wide">
                อัปโหลดสลิป
              </h2>
              <p className="mt-2 text-sm text-mist">
                หลังโอนแล้วแนบสลิปเพื่อยืนยันอัตโนมัติ
              </p>
              <input
                type="file"
                accept="image/*,application/pdf"
                required
                onChange={(e) => setFile(e.target.files?.[0] || null)}
                className="mt-4 block w-full text-sm"
              />
              <button
                type="submit"
                disabled={loading || !file}
                className="mt-6 w-full rounded-md bg-ember-500 py-2.5 font-semibold hover:bg-ember-400 disabled:opacity-60"
              >
                {loading ? "กำลังตรวจสอบ..." : "ยืนยันสลิป"}
              </button>
              <button
                type="button"
                onClick={() => setPending(null)}
                className="mt-3 w-full rounded-md border border-white/10 py-2 text-sm hover:bg-white/5"
              >
                ยกเลิก
              </button>
            </form>
          </div>
        )}

        {message && <p className="mt-6 text-emerald-400">{message}</p>}
        {error && <p className="mt-6 text-ember-400">{error}</p>}
      </div>
    </main>
  );
}
