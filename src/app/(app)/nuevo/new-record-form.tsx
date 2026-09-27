"use client";

import { useActionState, useRef } from "react";
import { createRecord, type ActionResult } from "@/app/actions";

export function NewRecordForm() {
  const [state, action, pending] = useActionState<ActionResult, FormData>(createRecord, {});
  const input = useRef<HTMLInputElement>(null);

  async function paste() {
    try {
      const text = await navigator.clipboard.readText();
      if (input.current) input.current.value = text.trim();
    } catch {
      input.current?.focus();
    }
  }

  return (
    <form action={action} className="space-y-3">
      <div className="flex gap-2">
        <input
          ref={input}
          name="url"
          type="url"
          inputMode="url"
          placeholder="https://www.discogs.com/release/…"
          className="input"
          autoFocus
          required
        />
        <button type="button" onClick={paste} className="btn-ghost shrink-0">Pegar</button>
      </div>
      {state.error ? <p className="text-sm text-bad">{state.error}</p> : null}
      <button className="btn-primary w-full py-3" disabled={pending}>
        {pending ? "Buscando disco y audios…" : "Cargar disco"}
      </button>
      {pending ? (
        <p className="text-center text-xs text-faint">Tarda unos segundos: busco cada track en YouTube, Deezer e iTunes.</p>
      ) : null}
    </form>
  );
}
