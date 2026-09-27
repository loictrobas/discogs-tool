"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { TrackRow } from "@/lib/records";
import type { AudioCandidate } from "@/lib/audio-search";
import { confirmUpload, pickAudio, pickYoutubeUrl, searchTrackAudio, setTrackSelected, setTrackStart } from "@/app/actions";
import { fmtTime, uploadToMedia } from "@/lib/upload-client";
import { autoStart, CLIP_SECONDS } from "@/lib/clip";

type Props = {
  track: TrackRow;
  recordId: string;
  audioUrl: string | null;
  videoUrl: string | null;
  renderError: string | null;
  onRetry: () => void;
};

const SOURCE_LABEL: Record<string, string> = {
  youtube: "YouTube",
  deezer: "Deezer",
  itunes: "iTunes",
  upload: "Archivo",
};

export function TrackCard({ track, recordId, audioUrl, videoUrl, renderError, onRetry }: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(track.audio_status === "none" || track.audio_status === "error");
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const toggle = () =>
    start(async () => {
      const res = await setTrackSelected(track.id, recordId, !track.selected);
      if (res.error) setError(res.error);
      router.refresh();
    });

  return (
    <article className={`card overflow-hidden ${track.selected ? "" : "opacity-60"}`}>
      <header className="flex items-center gap-3 p-3">
        <button
          type="button"
          onClick={toggle}
          disabled={pending}
          aria-pressed={track.selected}
          title={track.selected ? "Sacar del carrusel" : "Incluir en el carrusel"}
          className={`flex size-6 shrink-0 items-center justify-center rounded-md border text-xs font-bold ${
            track.selected ? "border-accent bg-accent text-accent-ink" : "border-line text-transparent"
          }`}
        >
          ✓
        </button>
        <div className="min-w-0 flex-1">
          <p className="truncate font-semibold">
            {track.position ? <span className="mr-2 font-mono text-sm text-accent">{track.position}</span> : null}
            {track.title}
          </p>
          <p className="truncate text-xs text-muted">
            {[track.artists, track.duration].filter(Boolean).join(" · ") || " "}
          </p>
        </div>
        <TrackStatus track={track} renderError={renderError} />
      </header>

      {track.selected ? (
        <div className="space-y-3 border-t border-line p-3">
          <AudioSummary track={track} onChange={() => setOpen((v) => !v)} open={open} />

          {track.audio_status === "error" ? <p className="text-xs text-bad">{track.audio_error}</p> : null}
          {error ? <p className="text-xs text-bad">{error}</p> : null}

          {open ? <AudioPicker track={track} recordId={recordId} onPicked={() => setOpen(false)} /> : null}

          {audioUrl && track.audio_status === "ready" ? (
            <ClipStart track={track} recordId={recordId} audioUrl={audioUrl} />
          ) : null}

          {track.video_status === "ready" && videoUrl ? (
            <video src={videoUrl} controls playsInline preload="metadata" className="aspect-[4/5] w-full rounded-xl bg-black sm:w-64" />
          ) : null}

          {renderError || track.video_status === "error" ? (
            <div className="flex items-center justify-between gap-2 rounded-xl bg-bad/10 p-3 text-xs text-bad">
              <span>{renderError ?? track.video_error}</span>
              <button className="btn-ghost px-3 py-1.5 text-xs" onClick={onRetry}>Reintentar</button>
            </div>
          ) : null}
        </div>
      ) : null}
    </article>
  );
}

function TrackStatus({ track, renderError }: { track: TrackRow; renderError: string | null }) {
  if (!track.selected) return <span className="chip bg-surface-2 text-faint">Fuera</span>;
  if (renderError || track.video_status === "error") return <span className="chip bg-bad/15 text-bad">Error</span>;
  if (track.video_status === "ready") return <span className="chip bg-ok/15 text-ok">Video listo</span>;
  if (track.video_status === "rendering") return <span className="chip animate-pulse bg-accent/15 text-accent">Armando video</span>;
  if (track.audio_status === "pending") return <span className="chip bg-warn/15 text-warn">En cola YouTube</span>;
  if (track.audio_status === "downloading") return <span className="chip animate-pulse bg-warn/15 text-warn">Bajando audio</span>;
  if (track.audio_status === "error") return <span className="chip bg-bad/15 text-bad">Sin audio</span>;
  if (track.audio_status === "none") return <span className="chip bg-surface-2 text-muted">Elegí audio</span>;
  return <span className="chip animate-pulse bg-accent/15 text-accent">Preparando</span>;
}

function AudioSummary({ track, onChange, open }: { track: TrackRow; onChange: () => void; open: boolean }) {
  return (
    <div className="flex items-center gap-2 text-sm">
      <div className="min-w-0 flex-1">
        {track.audio_source ? (
          <p className="truncate text-muted">
            <span className="mr-1.5 chip bg-surface-2 text-ink">{SOURCE_LABEL[track.audio_source]}</span>
            {track.audio_source === "youtube" && track.audio_ref ? (
              <a href={track.audio_ref} target="_blank" rel="noreferrer" className="hover:text-ink">{track.audio_label}</a>
            ) : (
              track.audio_label
            )}
          </p>
        ) : (
          <p className="text-muted">No encontré audio automáticamente.</p>
        )}
      </div>
      <button type="button" onClick={onChange} className="btn-ghost shrink-0 px-3 py-1.5 text-xs">
        {open ? "Cerrar" : "Cambiar"}
      </button>
    </div>
  );
}

function AudioPicker({ track, recordId, onPicked }: { track: TrackRow; recordId: string; onPicked: () => void }) {
  const router = useRouter();
  const [candidates, setCandidates] = useState<AudioCandidate[]>(track.candidates ?? []);
  const [query, setQuery] = useState("");
  const [link, setLink] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const fileInput = useRef<HTMLInputElement>(null);

  const choose = (c: AudioCandidate) =>
    start(async () => {
      await pickAudio(track.id, recordId, c);
      onPicked();
      router.refresh();
    });

  const search = () =>
    start(async () => {
      setMsg(null);
      const res = await searchTrackAudio(track.id, recordId, query);
      setCandidates(res);
      if (!res.length) setMsg("Sin resultados. Probá otra búsqueda o pegá un link.");
    });

  const useLink = () =>
    start(async () => {
      const res = await pickYoutubeUrl(track.id, recordId, link);
      if (res.error) return setMsg(res.error);
      onPicked();
      router.refresh();
    });

  const upload = (file: File) =>
    start(async () => {
      setMsg("Subiendo…");
      try {
        const path = await uploadToMedia("audio/uploads", file);
        await confirmUpload(track.id, recordId, path, file.name);
        setMsg(null);
        onPicked();
        router.refresh();
      } catch (e) {
        setMsg((e as Error).message);
      }
    });

  return (
    <div className="space-y-3 rounded-xl bg-surface-2 p-3">
      <ul className="space-y-1.5">
        {candidates.map((c) => (
          <li key={`${c.source}-${c.ref}`}>
            <CandidateRow candidate={c} active={track.audio_source === c.source && track.audio_ref === c.ref} onChoose={() => choose(c)} disabled={pending} />
          </li>
        ))}
        {!candidates.length ? <li className="text-sm text-muted">Todavía no hay resultados.</li> : null}
      </ul>

      <div className="flex gap-2">
        <input
          className="input"
          placeholder="Buscar en YouTube…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), search())}
        />
        <button className="btn-ghost shrink-0" disabled={pending} onClick={search}>Buscar</button>
      </div>
      <div className="flex gap-2">
        <input className="input" placeholder="…o pegá un link de YouTube" value={link} onChange={(e) => setLink(e.target.value)} inputMode="url" />
        <button className="btn-ghost shrink-0" disabled={pending || !link} onClick={useLink}>Usar</button>
      </div>
      <button className="btn-ghost w-full" disabled={pending} onClick={() => fileInput.current?.click()}>
        Subir un archivo de audio
      </button>
      <input
        ref={fileInput}
        type="file"
        accept="audio/*,.mp3,.m4a,.wav,.flac,.aiff"
        className="hidden"
        onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])}
      />
      {msg ? <p className="text-xs text-muted">{msg}</p> : null}
    </div>
  );
}

function CandidateRow({
  candidate: c,
  active,
  onChoose,
  disabled,
}: {
  candidate: AudioCandidate;
  active: boolean;
  onChoose: () => void;
  disabled: boolean;
}) {
  return (
    <div className={`flex items-center gap-2.5 rounded-lg border p-1.5 ${active ? "border-accent" : "border-transparent"}`}>
      {c.thumbnail ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={c.thumbnail} alt="" className="h-10 w-14 shrink-0 rounded object-cover" />
      ) : (
        <div className="h-10 w-14 shrink-0 rounded bg-surface" />
      )}
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm">{c.title}</p>
        <p className="truncate text-xs text-muted">
          <span className={c.fromDiscogs ? "text-accent" : ""}>{c.fromDiscogs ? "Discogs · " : ""}{SOURCE_LABEL[c.source]}</span>
          {c.subtitle && !c.fromDiscogs ? ` · ${c.subtitle}` : ""}
          {c.duration ? ` · ${fmtTime(c.duration)}` : ""}
        </p>
      </div>
      {c.source === "youtube" ? (
        <a href={c.ref} target="_blank" rel="noreferrer" className="btn-ghost shrink-0 px-2.5 py-1.5 text-xs" title="Escuchar en YouTube">▶</a>
      ) : c.previewUrl ? (
        <PreviewButton url={c.previewUrl} />
      ) : null}
      <button className="btn-primary shrink-0 px-3 py-1.5 text-xs" disabled={disabled || active} onClick={onChoose}>
        {active ? "Elegido" : "Usar"}
      </button>
    </div>
  );
}

function PreviewButton({ url }: { url: string }) {
  const audio = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState(false);
  const toggle = () => {
    audio.current ??= new Audio(url);
    audio.current.onended = () => setPlaying(false);
    if (playing) {
      audio.current.pause();
      setPlaying(false);
    } else {
      void audio.current.play();
      setPlaying(true);
    }
  };
  return (
    <button type="button" onClick={toggle} className="btn-ghost shrink-0 px-2.5 py-1.5 text-xs">
      {playing ? "■" : "▶"}
    </button>
  );
}

/** Lets you listen to the downloaded audio and pick where the 30s clip starts. */
function ClipStart({ track, recordId, audioUrl }: { track: TrackRow; recordId: string; audioUrl: string }) {
  const router = useRouter();
  const player = useRef<HTMLAudioElement>(null);
  const [pending, start] = useTransition();
  const current = track.start_sec ?? autoStart(track.audio_duration);
  const duration = track.audio_duration ?? 0;
  const canMove = duration > CLIP_SECONDS + 1;

  const save = (sec: number) =>
    start(async () => {
      await setTrackStart(track.id, recordId, sec);
      router.refresh();
    });

  return (
    <div className="space-y-2">
      <audio
        ref={player}
        src={audioUrl}
        controls
        preload="metadata"
        className="h-10 w-full"
        onLoadedMetadata={(e) => {
          e.currentTarget.currentTime = current;
        }}
      />
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted">
        <span>
          Clip: <span className="font-mono text-ink">{fmtTime(current)}–{fmtTime(Math.min(duration || current + CLIP_SECONDS, current + CLIP_SECONDS))}</span>
          {track.start_sec == null ? " (automático)" : ""}
        </span>
        {canMove ? (
          <button
            className="btn-ghost px-3 py-1.5 text-xs"
            disabled={pending}
            onClick={() => save(Math.min(player.current?.currentTime ?? 0, duration - CLIP_SECONDS))}
          >
            {pending ? "Guardando…" : "Empezar el clip donde está el player"}
          </button>
        ) : null}
      </div>
    </div>
  );
}
