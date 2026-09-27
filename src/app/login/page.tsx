import { LoginForm } from "./login-form";

export default function LoginPage() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center px-6">
      <div className="mb-10">
        <Logo />
        <p className="mt-3 text-sm text-muted">Inventario y publicación de vinilos.</p>
      </div>
      <LoginForm />
    </main>
  );
}

function Logo() {
  return (
    <div className="flex items-center gap-3">
      <div className="relative size-10 rounded-full bg-ink">
        <div className="absolute inset-[35%] rounded-full bg-accent" />
        <div className="absolute inset-[46%] rounded-full bg-bg" />
      </div>
      <span className="text-2xl font-bold tracking-tight">discoschetos</span>
    </div>
  );
}
