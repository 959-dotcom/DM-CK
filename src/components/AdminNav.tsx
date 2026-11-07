"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { apiFetch } from "@/lib/client-fetch";

const LINKS = [
  { href: "/admin", label: "Dashboard", exact: true },
  { href: "/admin/users", label: "Users" },
  { href: "/admin/plans", label: "Plans" },
  { href: "/admin/transactions", label: "Transactions" },
  { href: "/admin/domains", label: "Domains" },
  { href: "/admin/system", label: "System" },
];

export function AdminNav() {
  const pathname = usePathname();
  const router = useRouter();

  async function logout() {
    await apiFetch("/api/auth/logout", { method: "POST" });
    router.push("/");
  }

  return (
    <header className="relative z-20 border-b border-ember-700/40 bg-ink-950/90 backdrop-blur">
      <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3 px-4 py-4 md:px-8">
        <Link href="/admin" className="font-display text-2xl tracking-tight text-white">
          Spin<span className="text-ember-500">lytics</span>{" "}
          <span className="text-sm font-sans font-semibold uppercase tracking-[0.2em] text-ember-400">
            Admin
          </span>
        </Link>
        <nav className="flex flex-wrap items-center gap-1 text-sm">
          {LINKS.map((l) => {
            const active = l.exact
              ? pathname === l.href
              : pathname.startsWith(l.href);
            return (
              <Link
                key={l.href}
                href={l.href}
                className={`rounded-md px-3 py-2 transition ${
                  active
                    ? "bg-ember-600/30 text-white"
                    : "text-mist hover:bg-white/5 hover:text-white"
                }`}
              >
                {l.label}
              </Link>
            );
          })}
          <button
            onClick={logout}
            className="ml-2 rounded-md border border-white/10 px-3 py-2 text-mist hover:bg-white/5 hover:text-white"
          >
            Logout
          </button>
        </nav>
      </div>
    </header>
  );
}
