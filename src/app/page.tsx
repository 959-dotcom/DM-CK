import Link from "next/link";
import { Nav } from "@/components/Nav";
import { Activity, ShieldAlert, Radio } from "lucide-react";

export default function HomePage() {
  return (
    <main className="relative min-h-screen overflow-hidden bg-ink-950 text-white">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_top,_rgba(225,29,46,0.22),_transparent_55%),radial-gradient(ellipse_at_bottom_right,_rgba(255,90,90,0.08),_transparent_40%)]" />
      <div
        className="pointer-events-none absolute inset-0 opacity-[0.18] bg-grid"
        style={{ backgroundSize: "48px 48px" }}
      />

      <Nav />

      <section className="relative z-10 mx-auto grid min-h-[calc(100vh-88px)] max-w-6xl items-center gap-10 px-6 pb-16 pt-6 md:grid-cols-[1.1fr_0.9fr] md:px-10">
        <div>
          <p className="animate-rise mb-4 font-display text-6xl leading-none tracking-wide text-white md:text-8xl">
            Spin<span className="text-ember-500">lytics</span>
          </p>
          <h1 className="animate-rise-delay max-w-xl text-balance text-2xl font-medium text-white/90 md:text-3xl">
            ตรวจโดเมนบนเครือข่ายไทย — รู้ก่อนว่าถูกบล็อก
          </h1>
          <p className="animate-rise-delay-2 mt-4 max-w-lg text-mist">
            มอนิเตอร์ AIS · TRUE · DTAC · 3BB · NT แจ้งเตือนผ่าน Telegram
            เมื่อสถานะเปลี่ยนเป็น Blocked
          </p>
          <div className="animate-rise-delay-2 mt-8 flex flex-wrap gap-3">
            <Link
              href="/register"
              className="rounded-md bg-ember-500 px-6 py-3 text-sm font-semibold text-white shadow-glow transition hover:bg-ember-400"
            >
              เริ่มทดลองฟรี
            </Link>
            <Link
              href="/login"
              className="rounded-md border border-white/15 bg-white/5 px-6 py-3 text-sm font-medium text-white backdrop-blur transition hover:bg-white/10"
            >
              เข้าสู่ระบบ
            </Link>
          </div>
        </div>

        <div className="hero-scan relative overflow-hidden rounded-2xl border border-white/10 bg-ink-900/80 p-6 shadow-glow backdrop-blur">
          <div className="mb-6 flex items-center justify-between">
            <span className="font-display text-3xl tracking-wide text-ember-400">
              LIVE GRID
            </span>
            <Activity className="h-5 w-5 animate-pulse text-ember-400" />
          </div>
          <ul className="space-y-3">
            {[
              ["AIS", "SAFE"],
              ["TRUE", "SAFE"],
              ["DTAC", "BLOCKED"],
              ["3BB", "SAFE"],
              ["NT", "UNKNOWN"],
            ].map(([isp, status]) => (
              <li
                key={isp}
                className="flex items-center justify-between border-b border-white/5 py-2 text-sm"
              >
                <span className="flex items-center gap-2 text-mist">
                  <Radio className="h-3.5 w-3.5 text-ember-500" />
                  {isp}
                </span>
                <span
                  className={
                    status === "SAFE"
                      ? "isp-safe font-semibold"
                      : status === "BLOCKED"
                        ? "isp-blocked font-semibold"
                        : "isp-unknown font-semibold"
                  }
                >
                  {status}
                </span>
              </li>
            ))}
          </ul>
          <div className="mt-6 flex items-start gap-3 rounded-lg bg-ember-500/10 p-3 text-sm text-mist">
            <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-ember-400" />
            <p>
              เมื่อพบการบล็อกใหม่ Spinlytics ส่งแจ้งเตือนไปยัง Telegram ของคุณทันที
            </p>
          </div>
        </div>
      </section>
    </main>
  );
}
