"use client";

import { useActionState, useEffect, useRef } from "react";
import { createUser, resetPassword, type ActionResult } from "@/app/actions";

type State = ActionResult & { ok?: boolean };

function withOk(fn: (s: ActionResult, f: FormData) => Promise<ActionResult>) {
  return async (s: State, f: FormData): Promise<State> => {
    const res = await fn(s, f);
    return { ...res, ok: !res.error };
  };
}

const createUserOk = withOk(createUser);
const resetPasswordOk = withOk(resetPassword);

export function CreateUserForm() {
  const [state, action, pending] = useActionState<State, FormData>(createUserOk, {});
  const form = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state.ok) form.current?.reset();
  }, [state]);

  return (
    <form ref={form} action={action} className="space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="label" htmlFor="display_name">Nombre</label>
          <input id="display_name" name="display_name" className="input" placeholder="Pato" required />
        </div>
        <div>
          <label className="label" htmlFor="username">Usuario</label>
          <input id="username" name="username" className="input" placeholder="pato" autoCapitalize="none" required />
        </div>
      </div>
      <div>
        <label className="label" htmlFor="password">Contraseña</label>
        <input id="password" name="password" type="text" className="input" minLength={8} autoComplete="new-password" required />
      </div>
      {state.error ? <p className="text-sm text-bad">{state.error}</p> : null}
      {state.ok ? <p className="text-sm text-ok">Usuario creado. Pasale usuario y contraseña.</p> : null}
      <button className="btn-primary w-full" disabled={pending}>{pending ? "Creando…" : "Crear usuario"}</button>
    </form>
  );
}

export function ResetPasswordForm({ userId }: { userId: string }) {
  const [state, action, pending] = useActionState<State, FormData>(resetPasswordOk, {});
  return (
    <form action={action} className="flex gap-2">
      <input type="hidden" name="user_id" value={userId} />
      <input name="password" type="text" className="input py-2" placeholder="Nueva contraseña" minLength={8} autoComplete="new-password" required />
      <button className="btn-ghost shrink-0 py-2" disabled={pending}>
        {state.ok ? "Listo ✓" : "Cambiar"}
      </button>
      {state.error ? <p className="text-xs text-bad">{state.error}</p> : null}
    </form>
  );
}
