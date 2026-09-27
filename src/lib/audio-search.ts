import "server-only";
import { Innertube } from "youtubei.js";
import type { DiscogsVideo } from "@/lib/discogs";

export type AudioCandidate = {
  source: "youtube" | "deezer" | "itunes";
  ref: string; // youtube url | deezer id | itunes id
  title: string;
  subtitle: string; // channel / artist · album
  duration: number | null; // seconds
  thumbnail: string | null;
  previewUrl: string | null; // playable in <audio>, when available
  fromDiscogs?: boolean;
};

// ---------- matching helpers ----------

export function normalize(s: string) {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\((original|extended|album|radio)?\s*(mix|version|edit)\)/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** 0..1: share of the track title's words present in the candidate title. */
export function titleScore(trackTitle: string, candidate: string) {
  const want = normalize(trackTitle).split(" ").filter(Boolean);
  if (!want.length) return 0;
  const have = new Set(normalize(candidate).split(" "));
  return want.filter((w) => have.has(w)).length / want.length;
}

/** Discogs videos that look like this track, best first. */
export function matchDiscogsVideos(trackTitle: string, videos: DiscogsVideo[]): AudioCandidate[] {
  return videos
    .map((v) => ({ v, score: titleScore(trackTitle, v.title) }))
    .filter((x) => x.score >= 0.6)
    .sort((a, b) => b.score - a.score)
    .map(({ v }) => youtubeCandidate(v.url, v.title, "Video en Discogs", v.duration, true));
}

export function youtubeId(url: string) {
  const m = url.match(/(?:v=|youtu\.be\/|shorts\/|embed\/)([A-Za-z0-9_-]{11})/);
  return m?.[1] ?? null;
}

function youtubeCandidate(
  url: string,
  title: string,
  subtitle: string,
  duration: number | null,
  fromDiscogs = false,
): AudioCandidate {
  const id = youtubeId(url);
  return {
    source: "youtube",
    ref: id ? `https://www.youtube.com/watch?v=${id}` : url,
    title,
    subtitle,
    duration,
    thumbnail: id ? `https://i.ytimg.com/vi/${id}/mqdefault.jpg` : null,
    previewUrl: null,
    fromDiscogs,
  };
}

// ---------- YouTube ----------

let innertube: Promise<Innertube> | null = null;
function yt() {
  innertube ??= Innertube.create({ generate_session_locally: true, retrieve_player: false });
  return innertube;
}

export async function searchYoutube(query: string, limit = 5): Promise<AudioCandidate[]> {
  const client = await yt();
  const res = await client.search(query, { type: "video" });
  return res.videos
    .slice(0, limit)
    .flatMap((v) => {
      const video = v as unknown as {
        video_id?: string;
        id?: string;
        title?: { toString(): string };
        author?: { name?: string };
        duration?: { seconds?: number };
      };
      const id = video.video_id ?? video.id;
      if (!id) return [];
      return [
        youtubeCandidate(
          `https://www.youtube.com/watch?v=${id}`,
          video.title?.toString() ?? "(sin título)",
          video.author?.name ?? "",
          video.duration?.seconds ?? null,
        ),
      ];
    });
}

// ---------- Deezer / iTunes (official 30s previews) ----------

type DeezerTrack = {
  id: number;
  title: string;
  duration: number;
  preview: string;
  artist: { name: string };
  album: { title: string; cover_medium: string };
};

export async function searchDeezer(artist: string, title: string, limit = 3): Promise<AudioCandidate[]> {
  const q = artist ? `artist:"${artist}" track:"${title}"` : title;
  const res = await fetch(`https://api.deezer.com/search?q=${encodeURIComponent(q)}&limit=${limit}`);
  if (!res.ok) return [];
  const json = (await res.json()) as { data?: DeezerTrack[] };
  return (json.data ?? [])
    .filter((t) => t.preview)
    .map((t) => ({
      source: "deezer" as const,
      ref: String(t.id),
      title: t.title,
      subtitle: `${t.artist.name} · ${t.album.title}`,
      duration: 30,
      thumbnail: t.album.cover_medium,
      previewUrl: t.preview,
    }));
}

type ItunesTrack = {
  trackId: number;
  trackName: string;
  artistName: string;
  collectionName: string;
  previewUrl?: string;
  artworkUrl100?: string;
};

export async function searchItunes(artist: string, title: string, limit = 3): Promise<AudioCandidate[]> {
  const term = `${artist} ${title}`.trim();
  const res = await fetch(
    `https://itunes.apple.com/search?term=${encodeURIComponent(term)}&entity=song&limit=${limit}`,
  );
  if (!res.ok) return [];
  const json = (await res.json()) as { results?: ItunesTrack[] };
  return (json.results ?? [])
    .filter((t) => t.previewUrl)
    .map((t) => ({
      source: "itunes" as const,
      ref: String(t.trackId),
      title: t.trackName,
      subtitle: `${t.artistName} · ${t.collectionName}`,
      duration: 30,
      thumbnail: t.artworkUrl100 ?? null,
      previewUrl: t.previewUrl!,
    }));
}

/** Resolves a fresh, downloadable preview URL (Deezer's expire). */
export async function resolvePreviewUrl(source: "deezer" | "itunes", ref: string): Promise<string> {
  if (source === "deezer") {
    const res = await fetch(`https://api.deezer.com/track/${ref}`);
    const json = (await res.json()) as { preview?: string };
    if (!json.preview) throw new Error("Deezer ya no tiene preview para este track");
    return json.preview;
  }
  const res = await fetch(`https://itunes.apple.com/lookup?id=${ref}&entity=song`);
  const json = (await res.json()) as { results?: ItunesTrack[] };
  const url = json.results?.find((r) => r.previewUrl)?.previewUrl;
  if (!url) throw new Error("iTunes ya no tiene preview para este track");
  return url;
}

/** Everything we can find for one track, Discogs-linked videos first. */
export async function findAudioCandidates(opts: {
  trackTitle: string;
  trackArtists: string;
  releaseArtists: string;
  label: string;
  discogsVideos: DiscogsVideo[];
}): Promise<AudioCandidate[]> {
  const artist = opts.trackArtists || opts.releaseArtists;
  const fromDiscogs = matchDiscogsVideos(opts.trackTitle, opts.discogsVideos);
  const ytQuery = [artist, opts.trackTitle, opts.label].filter(Boolean).join(" ");

  const [youtube, deezer, itunes] = await Promise.all([
    searchYoutube(ytQuery, 5).catch(() => []),
    searchDeezer(artist, opts.trackTitle).catch(() => []),
    searchItunes(artist, opts.trackTitle).catch(() => []),
  ]);

  const seen = new Set(fromDiscogs.map((c) => c.ref));
  const extraYoutube = youtube.filter((c) => !seen.has(c.ref));
  const previews = [...deezer, ...itunes].filter((c) => titleScore(opts.trackTitle, c.title) >= 0.6);

  return [...fromDiscogs, ...extraYoutube, ...previews];
}
