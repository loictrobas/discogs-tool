"use client";

import { useActionState } from "react";
import { login, type ActionResult } from "@/app/actions";

export function LoginForm() {
  const [state, action, pending] = useActionState<ActionResult, FormData>(login, {});
  return (
    <form action={action} className="space-y-4">
      <div>
        <label className="label" htmlFor="username">Usuario</label>
        <input id="username" name="username" className="input" autoCapitalize="none" autoComplete="username" required />
      </div>
      <div>
        <label className="label" htmlFor="password">Contraseña</label>
        <input id="password" name="password" type="password" className="input" autoComplete="current-password" required />
      </div>
      {state.error ? <p className="text-sm text-bad">{state.error}</p> : null}
      <button className="btn-primary w-full py-3" disabled={pending}>
        {pending ? "Entrando…" : "Entrar"}
      </button>
    </form>
  );
}
