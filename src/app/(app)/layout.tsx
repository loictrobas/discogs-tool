import Link from "next/link";
import { requireProfile } from "@/lib/auth";
import { logout } from "@/app/actions";

export default async function AppLayout({ children }: LayoutProps<"/">) {
  const me = await requireProfile();
  return (
    <div className="mx-auto min-h-dvh max-w-3xl pb-16">
      <header className="sticky top-0 z-20 flex items-center justify-between gap-3 border-b border-line bg-bg/85 px-4 py-3 backdrop-blur">
        <Link href="/" className="flex items-center gap-2.5">
          <span className="relative size-7 rounded-full bg-ink">
            <span className="absolute inset-[35%] rounded-full bg-accent" />
            <span className="absolute inset-[46%] rounded-full bg-bg" />
          </span>
          <span className="font-bold tracking-tight">discoschetos</span>
        </Link>
        <nav className="flex items-center gap-2">
          <Link href="/nuevo" className="btn-primary px-3 py-2">+ Nuevo</Link>
          <details className="relative">
            <summary className="btn-ghost cursor-pointer list-none px-3 py-2">{me.display_name}</summary>
            <div className="card absolute right-0 mt-2 w-44 overflow-hidden p-1 text-sm shadow-xl">
              {me.is_admin ? (
                <Link href="/usuarios" className="block rounded-lg px-3 py-2 hover:bg-surface-2">Usuarios</Link>
              ) : null}
              <form action={logout}>
                <button className="w-full rounded-lg px-3 py-2 text-left hover:bg-surface-2">Salir</button>
              </form>
            </div>
          </details>
        </nav>
      </header>
      <main className="px-4 pt-5">{children}</main>
    </div>
  );
}
