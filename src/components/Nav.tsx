import Link from "next/link";

export function Nav({
  authed = false,
}: {
  authed?: boolean;
}) {
  return (
    <header className="relative z-20 flex items-center justify-between px-6 py-5 md:px-10">
      <Link href="/" className="font-display text-2xl tracking-tight text-white">
        Spin<span className="text-ember-500">lytics</span>
      </Link>
      <nav className="flex items-center gap-3 text-sm">
        {authed ? (
          <>
            <Link
              href="/dashboard"
              className="rounded-md px-3 py-2 text-mist transition hover:text-white"
            >
              Dashboard
            </Link>
            <Link
              href="/billing"
              className="rounded-md px-3 py-2 text-mist transition hover:text-white"
            >
              Billing
            </Link>
          </>
        ) : (
          <>
            <Link
              href="/login"
              className="rounded-md px-3 py-2 text-mist transition hover:text-white"
            >
              เข้าสู่ระบบ
            </Link>
            <Link
              href="/register"
              className="rounded-md bg-ember-500 px-4 py-2 font-medium text-white transition hover:bg-ember-400"
            >
              เริ่มทดลองใช้
            </Link>
          </>
        )}
      </nav>
    </header>
  );
}
