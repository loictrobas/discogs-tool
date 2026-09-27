"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { PublishState, RecordRow } from "@/lib/records";
import { publishStep, regenerateCaption, saveRecord } from "@/app/actions";

const CONDITIONS = ["", "M", "NM", "VG+", "VG", "G+", "G"];
const CURRENCIES = ["USD", "ARS", "EUR"] as const;

type Props = {
  record: RecordRow;
  profiles: { id: string; display_name: string }[];
  readyCount: number;
  selectedCount: number;
};

export function PublishPanel({ record, profiles, readyCount, selectedCount }: Props) {
  const router = useRouter();
  const [owner, setOwner] = useState(record.owner_id ?? "");
  const [price, setPrice] = useState(record.price?.toString() ?? "");
  const [currency, setCurrency] = useState(record.currency);
  const [media, setMedia] = useState(record.media_condition ?? "");
  const [sleeve, setSleeve] = useState(record.sleeve_condition ?? "");
  const [caption, setCaption] = useState(record.caption ?? "");
  const [notes, setNotes] = useState(record.notes ?? "");
  const [captionTouched, setCaptionTouched] = useState(false);
  const [saving, startSave] = useTransition();

  const fields = () => ({
    owner_id: owner || null,
    price: price ? Number(price.replace(",", ".")) : null,
    currency: currency as (typeof CURRENCIES)[number],
    media_condition: media || null,
    sleeve_condition: sleeve || null,
    notes: notes || null,
  });

  // Price/condition feed the caption: rebuild it unless it was edited by hand.
  const saveDetails = () =>
    startSave(async () => {
      await saveRecord(record.id, fields());
      if (!captionTouched) setCaption(await regenerateCaption(record.id));
    });

  const saveCaption = () => startSave(() => saveRecord(record.id, { caption }));

  const published = record.status !== "draft" && record.ig_permalink;
  const allReady = selectedCount > 0 && readyCount === selectedCount;

  return (
    <section className="card space-y-4 p-4">
      <h2 className="text-lg font-bold">Publicación</h2>

      <div className="grid grid-cols-2 gap-3">
        <div className="col-span-2 sm:col-span-1">
          <label className="label" htmlFor="owner">De quién es</label>
          <select id="owner" className="input" value={owner} onChange={(e) => setOwner(e.target.value)} onBlur={saveDetails}>
            <option value="">—</option>
            {profiles.map((p) => (
              <option key={p.id} value={p.id}>{p.display_name}</option>
            ))}
          </select>
          <p className="mt-1 text-[11px] text-faint">No aparece en Instagram.</p>
        </div>
        <div className="col-span-2 sm:col-span-1">
          <label className="label" htmlFor="price">Precio</label>
          <div className="flex gap-2">
            <input id="price" className="input" inputMode="decimal" placeholder="0" value={price} onChange={(e) => setPrice(e.target.value)} onBlur={saveDetails} />
            <select className="input w-24" value={currency} onChange={(e) => setCurrency(e.target.value)} onBlur={saveDetails}>
              {CURRENCIES.map((c) => <option key={c}>{c}</option>)}
            </select>
          </div>
        </div>
        <div>
          <label className="label" htmlFor="media">Estado disco</label>
          <select id="media" className="input" value={media} onChange={(e) => setMedia(e.target.value)} onBlur={saveDetails}>
            {CONDITIONS.map((c) => <option key={c} value={c}>{c || "—"}</option>)}
          </select>
        </div>
        <div>
          <label className="label" htmlFor="sleeve">Estado funda</label>
          <select id="sleeve" className="input" value={sleeve} onChange={(e) => setSleeve(e.target.value)} onBlur={saveDetails}>
            {CONDITIONS.map((c) => <option key={c} value={c}>{c || "—"}</option>)}
          </select>
        </div>
      </div>

      <div>
        <div className="mb-1.5 flex items-center justify-between">
          <label className="label mb-0" htmlFor="caption">Texto del post</label>
          <button
            type="button"
            className="text-xs text-muted underline underline-offset-2 hover:text-ink"
            onClick={() =>
              startSave(async () => {
                await saveRecord(record.id, fields());
                setCaption(await regenerateCaption(record.id));
                setCaptionTouched(false);
              })
            }
          >
            Regenerar
          </button>
        </div>
        <textarea
          id="caption"
          className="input min-h-56 font-mono text-[13px] leading-relaxed"
          value={caption}
          onChange={(e) => {
            setCaption(e.target.value);
            setCaptionTouched(true);
          }}
          onBlur={saveCaption}
        />
        <p className="mt-1 text-right text-[11px] text-faint">{caption.length}/2200</p>
      </div>

      <div>
        <label className="label" htmlFor="notes">Notas internas</label>
        <textarea id="notes" className="input min-h-16" value={notes} onChange={(e) => setNotes(e.target.value)} onBlur={saveDetails} placeholder="Solo las ven ustedes" />
      </div>

      {published ? (
        <a href={record.ig_permalink!} target="_blank" rel="noreferrer" className="btn-ghost w-full">
          Ver post en Instagram ↗
        </a>
      ) : (
        <PublishButton
          recordId={record.id}
          initial={record.ig_state}
          disabled={!allReady || saving}
          hint={
            !selectedCount
              ? "Elegí al menos un track."
              : !allReady
                ? `Faltan ${selectedCount - readyCount} videos.`
                : !price
                  ? "Ojo: no pusiste precio."
                  : null
          }
          beforePublish={async () => {
            await saveRecord(record.id, { ...fields(), caption });
          }}
          onDone={() => router.refresh()}
        />
      )}
    </section>
  );
}

const STEP_TEXT: Record<PublishState["step"], string> = {
  children: "Instagram está procesando los videos…",
  parent: "Armando el carrusel…",
  done: "¡Publicado!",
  error: "Error",
};

function PublishButton({
  recordId,
  initial,
  disabled,
  hint,
  beforePublish,
  onDone,
}: {
  recordId: string;
  initial: PublishState | null;
  disabled: boolean;
  hint: string | null;
  beforePublish: () => Promise<void>;
  onDone: () => void;
}) {
  const inProgress = initial && (initial.step === "children" || initial.step === "parent");
  const [state, setState] = useState<PublishState | null>(inProgress ? initial : null);
  const [running, setRunning] = useState(Boolean(inProgress));
  const cancelled = useRef(false);
  const onDoneRef = useRef(onDone);
  useEffect(() => {
    onDoneRef.current = onDone;
  });

  useEffect(() => {
    cancelled.current = false;
    if (!running) return;
    let timer: ReturnType<typeof setTimeout>;
    const tick = async () => {
      const next = await publishStep(recordId);
      if (cancelled.current) return;
      setState(next);
      if (next.step === "done") {
        setRunning(false);
        onDoneRef.current();
      } else if (next.step === "error") {
        setRunning(false);
      } else {
        timer = setTimeout(tick, 4000);
      }
    };
    void tick();
    return () => {
      cancelled.current = true;
      clearTimeout(timer);
    };
  }, [running, recordId]);

  const start = async () => {
    if (!confirm("¿Publicar en Instagram ahora?")) return;
    setState(null);
    await beforePublish();
    setRunning(true);
  };

  return (
    <div className="space-y-2">
      <button className="btn-primary w-full py-3 text-base" disabled={disabled || running} onClick={start}>
        {running ? STEP_TEXT[state?.step ?? "children"] : "Publicar en Instagram"}
      </button>
      {running ? <p className="text-center text-xs text-muted">Suele tardar 1–2 minutos. Podés dejar esta pantalla abierta.</p> : null}
      {state?.step === "error" ? <p className="text-sm text-bad">{state.error}</p> : null}
      {!running && hint ? <p className="text-center text-xs text-muted">{hint}</p> : null}
    </div>
  );
}
