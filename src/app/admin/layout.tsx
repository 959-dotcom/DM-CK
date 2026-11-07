import { AdminNav } from "@/components/AdminNav";

export default function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <main className="min-h-screen bg-ink-950 text-white">
      <div className="pointer-events-none fixed inset-0 bg-[radial-gradient(ellipse_at_top,_rgba(225,29,46,0.16),_transparent_50%)]" />
      <div className="pointer-events-none fixed inset-0 bg-grid bg-[size:48px_48px] opacity-[0.07]" />
      <AdminNav />
      <div className="relative mx-auto max-w-7xl px-4 py-8 md:px-8">{children}</div>
    </main>
  );
}
