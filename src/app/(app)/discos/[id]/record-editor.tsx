"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { RecordRow, TrackRow } from "@/lib/records";
import { deleteRecord, markAvailable, markSold, renderVideo, uploadCover } from "@/app/actions";
import { uploadToMedia } from "@/lib/upload-client";
import { formatPrice } from "@/lib/caption";
import { StatusChip } from "@/components/status";
import { TrackCard } from "./track-card";
import { PublishPanel } from "./publish-panel";

type Props = {
  record: RecordRow;
  tracks: TrackRow[];
  profiles: { id: string; display_name: string }[];
  mediaBase: string;
};

export function RecordEditor({ record, tracks, profiles, mediaBase }: Props) {
  const router = useRouter();
  const media = (path: string | null) => (path ? mediaBase + path : null);

  // Keep the page fresh while background work (downloads, renders) is running.
  const busy = tracks.some(
    (t) => t.audio_status === "pending" || t.audio_status === "downloading" || t.video_status === "rendering",
  );
  useEffect(() => {
    if (!busy) return;
    const id = setInterval(() => router.refresh(), 3000);
    return () => clearInterval(id);
  }, [busy, router]);

  // Render videos automatically, one at a time, as soon as their audio is ready.
  const inFlight = useRef(new Set<string>());
  const [renderErrors, setRenderErrors] = useState<Record<string, string>>({});
  useEffect(() => {
    if (inFlight.current.size > 0 || !record.cover_path) return;
    const next = tracks.find(
      (t) => t.selected && t.audio_status === "ready" && t.video_status === "none" && !renderErrors[t.id],
    );
    if (!next) return;
    inFlight.current.add(next.id);
    renderVideo(next.id, record.id).then((res) => {
      inFlight.current.delete(next.id);
      if (res.error) setRenderErrors((e) => ({ ...e, [next.id]: res.error! }));
      router.refresh();
    });
  }, [tracks, record.id, record.cover_path, renderErrors, router]);

  const selected = tracks.filter((t) => t.selected);
  const ready = selected.filter((t) => t.video_status === "ready").length;

  return (
    <div className="space-y-6">
      <RecordHeader record={record} coverUrl={media(record.cover_path)} />

      <section className="space-y-3">
        <div className="flex items-baseline justify-between">
          <h2 className="text-lg font-bold">Tracks</h2>
          <span className="text-sm text-muted">
            {ready}/{selected.length} videos listos
          </span>
        </div>
        {tracks.length === 0 ? (
          <p className="card p-4 text-sm text-muted">Discogs no tiene tracklist para este disco.</p>
        ) : null}
        {tracks.map((t) => (
          <TrackCard
            key={t.id}
            track={t}
            recordId={record.id}
            audioUrl={media(t.audio_path)}
            videoUrl={media(t.video_path)}
            renderError={renderErrors[t.id] ?? null}
            onRetry={() =>
              setRenderErrors((errors) => {
                const rest = { ...errors };
                delete rest[t.id];
                return rest;
              })
            }
          />
        ))}
      </section>

      <PublishPanel record={record} profiles={profiles} readyCount={ready} selectedCount={selected.length} />

      <DangerZone record={record} />
    </div>
  );
}

function RecordHeader({ record, coverUrl }: { record: RecordRow; coverUrl: string | null }) {
  const router = useRouter();
  const [uploading, setUploading] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  async function onCover(file: File) {
    setUploading(true);
    try {
      const path = await uploadToMedia("covers", file);
      await uploadCover(record.id, path);
      router.refresh();
    } finally {
      setUploading(false);
    }
  }

  const ref = [record.ref_price_min, record.ref_price_median, record.ref_price_max];
  return (
    <section className="flex gap-4">
      <button
        type="button"
        onClick={() => fileInput.current?.click()}
        className="group relative size-28 shrink-0 overflow-hidden rounded-xl bg-surface-2 sm:size-36"
        title="Cambiar portada"
      >
        {coverUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={coverUrl} alt="" className="size-full object-cover" />
        ) : (
          <span className="text-xs text-muted">Subir portada</span>
        )}
        <span className="absolute inset-x-0 bottom-0 bg-black/60 py-1 text-center text-[11px] text-ink opacity-0 transition group-hover:opacity-100">
          {uploading ? "Subiendo…" : "Cambiar"}
        </span>
        <input
          ref={fileInput}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => e.target.files?.[0] && onCover(e.target.files[0])}
        />
      </button>
      <div className="min-w-0 flex-1 space-y-1">
        <StatusChip status={record.status} />
        <h1 className="text-xl font-bold leading-tight tracking-tight sm:text-2xl">{record.title}</h1>
        <p className="text-muted">{record.artists}</p>
        <p className="text-sm text-faint">
          {[record.labels, record.catno, record.year, record.country].filter(Boolean).join(" · ")}
        </p>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 pt-1 text-xs text-muted">
          <a href={record.discogs_url} target="_blank" rel="noreferrer" className="underline decoration-line underline-offset-2 hover:text-ink">
            Ver en Discogs
          </a>
          {ref.some((v) => v != null) ? (
            <span>
              Discogs: {ref.map((v) => (v == null ? "–" : formatPrice(v, record.ref_currency ?? "USD"))).join(" / ")}
              <span className="text-faint"> (mín/med/máx)</span>
            </span>
          ) : null}
        </div>
      </div>
    </section>
  );
}

function DangerZone({ record }: { record: RecordRow }) {
  const [pending, start] = useTransition();
  const [soldPrice, setSoldPrice] = useState(record.price?.toString() ?? "");

  return (
    <section className="card space-y-4 p-4">
      {record.status === "sold" ? (
        <div className="flex items-center justify-between gap-3">
          <p className="text-sm text-muted">
            Vendido {record.sold_price != null ? `en ${formatPrice(record.sold_price, record.currency)}` : ""}
          </p>
          <button className="btn-ghost" disabled={pending} onClick={() => start(() => markAvailable(record.id))}>
            Volver a disponible
          </button>
        </div>
      ) : (
        <div className="flex items-end gap-2">
          <div className="flex-1">
            <label className="label" htmlFor="sold">Precio de venta</label>
            <input id="sold" className="input" inputMode="decimal" value={soldPrice} onChange={(e) => setSoldPrice(e.target.value)} />
          </div>
          <button
            className="btn-ghost"
            disabled={pending}
            onClick={() => start(() => markSold(record.id, soldPrice ? Number(soldPrice.replace(",", ".")) : null))}
          >
            Marcar vendido
          </button>
        </div>
      )}
      <button
        className="btn-danger w-full"
        disabled={pending}
        onClick={() => {
          if (confirm("¿Borrar este disco del inventario? No borra el post de Instagram.")) start(() => deleteRecord(record.id));
        }}
      >
        Borrar disco
      </button>
    </section>
  );
}
