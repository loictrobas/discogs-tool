import "server-only";
import { createAdminClient, MEDIA_BUCKET, publicMediaUrl } from "@/lib/supabase/admin";
import { downloadDiscogsImage, fetchDiscogsRelease, type DiscogsVideo } from "@/lib/discogs";
import { findAudioCandidates, resolvePreviewUrl, type AudioCandidate } from "@/lib/audio-search";
import { audioDuration, autoStart, extFromPath, renderClip } from "@/lib/media";
import { renderFrame } from "@/lib/frame";
import { buildCaption } from "@/lib/caption";

export type RecordStatus = "draft" | "published" | "sold";

export type RecordRow = {
  id: string;
  status: RecordStatus;
  owner_id: string | null;
  created_by: string | null;
  discogs_url: string;
  discogs_release_id: number | null;
  title: string;
  artists: string;
  labels: string;
  catno: string | null;
  year: number | null;
  country: string | null;
  formats: string | null;
  genres: string | null;
  styles: string | null;
  cover_path: string | null;
  discogs_videos: DiscogsVideo[];
  ref_price_min: number | null;
  ref_price_median: number | null;
  ref_price_max: number | null;
  ref_currency: string | null;
  price: number | null;
  currency: string;
  media_condition: string | null;
  sleeve_condition: string | null;
  caption: string | null;
  notes: string | null;
  sold_price: number | null;
  sold_at: string | null;
  ig_state: PublishState | null;
  ig_media_id: string | null;
  ig_permalink: string | null;
  published_at: string | null;
  created_at: string;
  updated_at: string;
};

export type TrackRow = {
  id: string;
  record_id: string;
  sort: number;
  position: string;
  title: string;
  artists: string;
  duration: string | null;
  selected: boolean;
  audio_source: "youtube" | "deezer" | "itunes" | "upload" | null;
  audio_ref: string | null;
  audio_label: string | null;
  audio_status: "none" | "pending" | "downloading" | "ready" | "error";
  audio_path: string | null;
  audio_duration: number | null;
  audio_error: string | null;
  start_sec: number | null;
  candidates: AudioCandidate[] | null;
  video_path: string | null;
  video_status: "none" | "rendering" | "ready" | "error";
  video_error: string | null;
};

export type PublishState = {
  step: "children" | "parent" | "done" | "error";
  children: { trackId: string; id: string }[];
  parentId?: string;
  error?: string;
  startedAt: string;
};

export const MAX_CAROUSEL = 10;

const db = () => createAdminClient();

async function upload(path: string, body: Uint8Array | ArrayBuffer, contentType: string) {
  const { error } = await db().storage.from(MEDIA_BUCKET).upload(path, body, { contentType, upsert: true });
  if (error) throw new Error(`Storage: ${error.message}`);
  return path;
}

async function download(path: string) {
  const { data, error } = await db().storage.from(MEDIA_BUCKET).download(path);
  if (error || !data) throw new Error(`No encuentro ${path} en storage`);
  return new Uint8Array(await data.arrayBuffer());
}

export async function getRecord(id: string) {
  const { data, error } = await db().from("records").select("*").eq("id", id).single();
  if (error) throw new Error(error.message);
  return data as RecordRow;
}

export async function getTracks(recordId: string) {
  const { data, error } = await db().from("tracks").select("*").eq("record_id", recordId).order("sort");
  if (error) throw new Error(error.message);
  return data as TrackRow[];
}

export async function updateTrack(id: string, patch: Partial<TrackRow>) {
  const { error } = await db().from("tracks").update(patch).eq("id", id);
  if (error) throw new Error(error.message);
}

export async function updateRecord(id: string, patch: Partial<RecordRow>) {
  const { error } = await db().from("records").update(patch).eq("id", id);
  if (error) throw new Error(error.message);
}

// ---------------------------------------------------------------------------
// Create from Discogs
// ---------------------------------------------------------------------------

/** Creates a draft with cover, tracks and an automatic audio pick per track. */
export async function createRecordFromDiscogs(discogsUrl: string, userId: string) {
  const release = await fetchDiscogsRelease(discogsUrl);

  const { data: record, error } = await db()
    .from("records")
    .insert({
      status: "draft",
      owner_id: userId,
      created_by: userId,
      discogs_url: release.url,
      discogs_release_id: release.releaseId,
      title: release.title,
      artists: release.artists,
      labels: release.labels,
      catno: release.catno,
      year: release.year,
      country: release.country,
      formats: release.formats,
      genres: release.genres,
      styles: release.styles,
      discogs_videos: release.videos,
      ref_price_min: release.prices.min,
      ref_price_median: release.prices.median,
      ref_price_max: release.prices.max,
      ref_currency: release.prices.currency,
      currency: "USD",
    })
    .select("*")
    .single();
  if (error) throw new Error(error.message);

  if (release.coverUrl) {
    try {
      const bytes = await downloadDiscogsImage(release.coverUrl);
      const path = await upload(`covers/${record.id}.jpg`, bytes, "image/jpeg");
      await updateRecord(record.id, { cover_path: path });
    } catch {
      // cover can be uploaded manually later
    }
  }

  const label = release.labels.split(",")[0] ?? "";
  const rows = await Promise.all(
    release.tracks.map(async (t, i) => {
      const candidates = await findAudioCandidates({
        trackTitle: t.title,
        trackArtists: t.artists,
        releaseArtists: release.artists,
        label,
        discogsVideos: release.videos,
      }).catch(() => [] as AudioCandidate[]);
      return {
        record_id: record.id,
        sort: i,
        position: t.position,
        title: t.title,
        artists: t.artists,
        duration: t.duration,
        selected: i < MAX_CAROUSEL,
        candidates,
      };
    }),
  );

  const { data: tracks, error: tErr } = await db().from("tracks").insert(rows).select("*");
  if (tErr) throw new Error(tErr.message);

  // Auto-pick the best candidate for every track.
  await Promise.all(
    (tracks as TrackRow[]).map((t) => {
      const best = pickBestCandidate(t.candidates ?? []);
      return best ? chooseAudio(t.id, best).catch(() => undefined) : undefined;
    }),
  );

  return record.id as string;
}

/** Discogs-linked video > official preview > first YouTube result. */
export function pickBestCandidate(candidates: AudioCandidate[]) {
  return (
    candidates.find((c) => c.fromDiscogs) ??
    candidates.find((c) => c.source === "deezer" || c.source === "itunes") ??
    candidates.find((c) => c.source === "youtube") ??
    null
  );
}

// ---------------------------------------------------------------------------
// Audio
// ---------------------------------------------------------------------------

/** Sets the audio for a track. Previews are fetched now; YouTube is queued for the worker. */
export async function chooseAudio(trackId: string, c: Pick<AudioCandidate, "source" | "ref" | "title" | "subtitle">) {
  const label = [c.title, c.subtitle].filter(Boolean).join(" · ");
  const base = {
    audio_source: c.source,
    audio_ref: c.ref,
    audio_label: label,
    audio_path: null,
    audio_duration: null,
    audio_error: null,
    start_sec: null,
    video_status: "none" as const,
    video_path: null,
  };

  if (c.source === "youtube") {
    await updateTrack(trackId, { ...base, audio_status: "pending" });
    return;
  }

  if (c.source === "deezer" || c.source === "itunes") {
    await updateTrack(trackId, { ...base, audio_status: "downloading" });
    try {
      const url = await resolvePreviewUrl(c.source, c.ref);
      const res = await fetch(url);
      if (!res.ok) throw new Error(`Preview ${res.status}`);
      const bytes = new Uint8Array(await res.arrayBuffer());
      const ext = c.source === "itunes" ? "m4a" : "mp3";
      const path = await upload(`audio/${trackId}.${ext}`, bytes, ext === "mp3" ? "audio/mpeg" : "audio/mp4");
      const duration = await audioDuration(bytes, ext);
      await updateTrack(trackId, { audio_status: "ready", audio_path: path, audio_duration: duration });
    } catch (e) {
      await updateTrack(trackId, { audio_status: "error", audio_error: (e as Error).message });
    }
  }
}

/** Called after the browser uploaded a file straight to storage. */
export async function registerUploadedAudio(trackId: string, path: string, filename: string) {
  const bytes = await download(path);
  const duration = await audioDuration(bytes, extFromPath(path, "mp3"));
  await updateTrack(trackId, {
    audio_source: "upload",
    audio_ref: filename,
    audio_label: filename,
    audio_status: "ready",
    audio_path: path,
    audio_duration: duration,
    audio_error: null,
    start_sec: null,
    video_status: "none",
    video_path: null,
  });
}

// ---------------------------------------------------------------------------
// Video
// ---------------------------------------------------------------------------

export async function renderTrackVideo(trackId: string) {
  const { data: t } = await db().from("tracks").select("*").eq("id", trackId).single();
  const track = t as TrackRow;
  const record = await getRecord(track.record_id);
  if (!record.cover_path) throw new Error("El disco no tiene portada");
  if (track.audio_status !== "ready" || !track.audio_path) throw new Error("El track no tiene audio listo");

  await updateTrack(trackId, { video_status: "rendering", video_error: null });
  try {
    const selected = (await getTracks(record.id)).filter((x) => x.selected);
    const index = selected.findIndex((x) => x.id === trackId) + 1;

    const [cover, audio] = await Promise.all([download(record.cover_path), download(track.audio_path)]);
    const frame = await renderFrame({
      cover,
      position: track.position,
      trackTitle: track.title,
      trackArtists: track.artists || record.artists,
      releaseTitle: record.title,
      index: index || track.sort + 1,
      total: selected.length || 1,
    });
    const startSec = track.start_sec ?? autoStart(track.audio_duration);
    const mp4 = await renderClip({ framePng: frame, audio, audioExt: extFromPath(track.audio_path), startSec });

    // New name per render so Instagram/CDNs never serve a stale file.
    const path = await upload(`videos/${record.id}/${trackId}-${Date.now()}.mp4`, mp4, "video/mp4");
    if (track.video_path) await db().storage.from(MEDIA_BUCKET).remove([track.video_path]);
    await updateTrack(trackId, { video_status: "ready", video_path: path });
  } catch (e) {
    await updateTrack(trackId, { video_status: "error", video_error: (e as Error).message });
    throw e;
  }
}

// ---------------------------------------------------------------------------
// Caption
// ---------------------------------------------------------------------------

export async function defaultCaption(recordId: string) {
  const record = await getRecord(recordId);
  const tracks = (await getTracks(recordId)).filter((t) => t.selected);
  return buildCaption(record, tracks);
}

export { publicMediaUrl };
