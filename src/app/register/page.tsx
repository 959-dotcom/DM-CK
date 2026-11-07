"use client";

import Link from "next/link";
import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { Nav } from "@/components/Nav";

export default function RegisterPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [telegram, setTelegram] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/auth/register", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email,
          password,
          telegram_chat_id: telegram || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Register failed");
      if (data.token) {
        try {
          localStorage.setItem("spinlytics_token", data.token);
        } catch {
          /* ignore */
        }
      }
      router.replace("/dashboard");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Register failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="min-h-screen bg-ink-950 text-white">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_top,_rgba(225,29,46,0.18),_transparent_50%)]" />
      <Nav />
      <div className="relative mx-auto max-w-md px-6 py-16">
        <h1 className="font-display text-5xl tracking-wide">สมัครใช้งาน</h1>
        <p className="mt-2 text-mist">
          ทดลองฟรี 1 โดเมน · ตรวจทุก 1 ชั่วโมง
        </p>
        <form onSubmit={onSubmit} className="mt-8 space-y-4">
          <label className="block text-sm">
            <span className="text-mist">Email</span>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="mt-1 w-full rounded-md border border-white/10 bg-ink-800 px-3 py-2 outline-none ring-ember-500 focus:ring-1"
            />
          </label>
          <label className="block text-sm">
            <span className="text-mist">Password (อย่างน้อย 8 ตัวอักษร)</span>
            <input
              type="password"
              required
              minLength={8}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="mt-1 w-full rounded-md border border-white/10 bg-ink-800 px-3 py-2 outline-none ring-ember-500 focus:ring-1"
            />
          </label>
          <label className="block text-sm">
            <span className="text-mist">Telegram Chat ID (ไม่บังคับ)</span>
            <input
              type="text"
              value={telegram}
              onChange={(e) => setTelegram(e.target.value)}
              placeholder="สำหรับแจ้งเตือนบล็อก"
              className="mt-1 w-full rounded-md border border-white/10 bg-ink-800 px-3 py-2 outline-none ring-ember-500 focus:ring-1"
            />
          </label>
          {error && <p className="text-sm text-ember-400">{error}</p>}
          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-md bg-ember-500 py-2.5 font-semibold transition hover:bg-ember-400 disabled:opacity-60"
          >
            {loading ? "กำลังสมัคร..." : "สร้างบัญชี"}
          </button>
        </form>
        <p className="mt-6 text-sm text-mist">
          มีบัญชีแล้ว?{" "}
          <Link href="/login" className="text-ember-400 hover:underline">
            เข้าสู่ระบบ
          </Link>
        </p>
      </div>
    </main>
  );
}
