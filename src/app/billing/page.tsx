"use client";

import { FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Nav } from "@/components/Nav";
import { apiFetch } from "@/lib/client-fetch";
import { DEFAULT_PROMPTPAY_ID } from "@/lib/constants";

type Plan = {
  id: string;
  name: string;
  price: string;
  max_domains: number;
  interval_days: number;
  check_interval_minutes: number;
};

type PendingPay = {
  transaction: {
    id: string;
    plan_name: string;
    amount: number;
    qr_ref: string;
  };
  promptpay: {
    id: string;
    qr_data_url: string;
  };
};

export default function BillingPage() {
  const router = useRouter();
  const [plans, setPlans] = useState<Plan[]>([]);
  const [pending, setPending] = useState<PendingPay | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    (async () => {
      const me = await apiFetch("/api/auth/me");
      if (me.status === 401) {
        router.push("/login");
        return;
      }
      const res = await apiFetch("/api/plans");
      const data = await res.json();
      setPlans(
        (data.plans || []).filter((p: Plan) => Number(p.price) > 0),
      );
    })().catch((err) => setError(String(err)));
  }, [router]);

  async function choosePlan(planId: string) {
    setError("");
    setMessage("");
    setLoading(true);
    try {
      const res = await apiFetch("/api/transactions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ plan_id: planId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed");
      setPending(data);
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
      const res = await apiFetch(
        `/api/transactions/${pending.transaction.id}/slip`,
        {
          method: "POST",
          body: form,
        },
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Verify failed");
      setMessage(
        data.verify?.mock
          ? "ชำระเงินสำเร็จ (mock verify) — สมัครสมาชิกถูกอัปเกรดแล้ว"
          : "ชำระเงินสำเร็จ — สมัครสมาชิกถูกอัปเกรดแล้ว",
      );
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
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_top,_rgba(225,29,46,0.16),_transparent_50%)]" />
      <Nav authed />
      <div className="relative mx-auto max-w-5xl px-6 py-10 md:px-10">
        <h1 className="font-display text-5xl tracking-wide">
          Billing · PromptPay
        </h1>
        <p className="mt-2 text-mist">
          ชำระผ่าน PromptPay {DEFAULT_PROMPTPAY_ID} แล้วอัปโหลดสลิปเพื่อยืนยัน
        </p>

        {!pending && (
          <div className="mt-10 grid gap-4 md:grid-cols-3">
            {plans.map((p) => (
              <div
                key={p.id}
                className="border border-white/10 bg-ink-900/70 p-5"
              >
                <h2 className="font-display text-3xl tracking-wide">{p.name}</h2>
                <p className="mt-2 text-3xl font-semibold text-ember-400">
                  ฿{Number(p.price).toLocaleString("th-TH")}
                </p>
                <ul className="mt-4 space-y-1 text-sm text-mist">
                  <li>สูงสุด {p.max_domains} โดเมน</li>
                  <li>ตรวจทุก {p.check_interval_minutes} นาที</li>
                  <li>ระยะเวลา {p.interval_days} วัน</li>
                </ul>
                <button
                  disabled={loading}
                  onClick={() => choosePlan(p.id)}
                  className="mt-6 w-full rounded-md bg-ember-500 py-2.5 font-semibold hover:bg-ember-400 disabled:opacity-60"
                >
                  เลือกแพ็กนี้
                </button>
              </div>
            ))}
          </div>
        )}

        {pending && (
          <div className="mt-10 grid gap-8 md:grid-cols-2">
            <div className="border border-white/10 bg-ink-900/70 p-6">
              <h2 className="font-display text-3xl tracking-wide">
                สแกน QR เพื่อชำระ
              </h2>
              <p className="mt-2 text-mist">
                {pending.transaction.plan_name} · ฿
                {pending.transaction.amount.toLocaleString("th-TH")}
              </p>
              <p className="mt-1 text-xs text-mist">
                PromptPay: {pending.promptpay.id} · Ref:{" "}
                {pending.transaction.qr_ref}
              </p>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={pending.promptpay.qr_data_url}
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
                หลังโอนแล้วแนบสลิปเพื่อยืนยัน (ไม่มี SlipOK key จะใช้ mock
                verify)
              </p>
              <input
                type="file"
                accept="image/*"
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
