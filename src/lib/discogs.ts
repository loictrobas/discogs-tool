import { env } from "@/lib/env";

const API = "https://api.discogs.com";

export type DiscogsTrack = {
  position: string;
  title: string;
  artists: string;
  duration: string | null;
};

export type DiscogsVideo = { title: string; url: string; duration: number | null };

export type DiscogsRelease = {
  releaseId: number;
  url: string;
  title: string;
  artists: string;
  labels: string;
  catno: string | null;
  year: number | null;
  country: string | null;
  formats: string | null;
  genres: string | null;
  styles: string | null;
  coverUrl: string | null;
  tracks: DiscogsTrack[];
  videos: DiscogsVideo[];
  prices: { min: number | null; median: number | null; max: number | null; currency: string };
};

/** Accepts release/master URLs, with or without language prefix or slug, or a bare "r123". */
export function parseDiscogsUrl(input: string): { kind: "release" | "master"; id: number } {
  const trimmed = input.trim();
  const bare = trimmed.match(/^\[?([rm])(\d+)\]?$/i);
  if (bare) return { kind: bare[1].toLowerCase() === "m" ? "master" : "release", id: Number(bare[2]) };

  const m = trimmed.match(/discogs\.com\/(?:[a-z]{2}\/)?(?:[^/]+\/)?(release|master)\/(\d+)/i);
  if (!m) throw new Error("No reconozco el link. Tiene que ser de un release o master de Discogs.");
  return { kind: m[1].toLowerCase() as "release" | "master", id: Number(m[2]) };
}

async function discogs<T>(path: string): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    headers: {
      "User-Agent": env.discogsUserAgent(),
      Authorization: `Discogs token=${env.discogsToken()}`,
      Accept: "application/vnd.discogs.v2.discogs+json",
    },
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`Discogs ${res.status} en ${path}`);
  return res.json() as Promise<T>;
}

/** "Moodymann (2)" -> "Moodymann". Discogs disambiguates homonyms with a numeric suffix. */
export function cleanArtistName(name: string) {
  return name.replace(/\s\(\d+\)$/, "").replace(/\*$/, "").trim();
}

type RawArtist = { name: string; anv?: string; join?: string };

export function joinArtists(artists: RawArtist[] | undefined): string {
  if (!artists?.length) return "";
  return artists
    .map((a, i) => {
      const name = cleanArtistName(a.anv || a.name);
      const join = i < artists.length - 1 ? (a.join?.trim() ? ` ${a.join.trim()} ` : ", ") : "";
      return name + join;
    })
    .join("")
    .trim();
}

type RawTrack = {
  position?: string;
  type_?: string;
  title?: string;
  duration?: string;
  artists?: RawArtist[];
  sub_tracks?: RawTrack[];
};

const HEADING_TITLES = new Set([
  "that side", "this side", "logo side", "info side", "other side", "both sides", "side a", "side b",
]);

export function flattenTracklist(raw: RawTrack[] | undefined): DiscogsTrack[] {
  const out: DiscogsTrack[] = [];
  for (const t of raw ?? []) {
    if (t.type_ === "index" && t.sub_tracks?.length) {
      out.push(...flattenTracklist(t.sub_tracks));
      continue;
    }
    if (t.type_ && t.type_ !== "track") continue;
    const title = (t.title ?? "").trim();
    if (!title) continue;
    if (!t.duration && HEADING_TITLES.has(title.toLowerCase())) continue;
    out.push({
      position: (t.position ?? "").trim(),
      title,
      artists: joinArtists(t.artists),
      duration: t.duration?.trim() || null,
    });
  }
  return out;
}

type RawRelease = {
  id: number;
  uri: string;
  title: string;
  artists?: RawArtist[];
  labels?: { name: string; catno?: string }[];
  year?: number;
  country?: string;
  formats?: { name: string; qty?: string; descriptions?: string[] }[];
  genres?: string[];
  styles?: string[];
  images?: { type: string; uri: string }[];
  tracklist?: RawTrack[];
  videos?: { title: string; uri: string; duration?: number }[];
};

async function fetchPrices(releaseId: number) {
  const currency = "USD";
  const result = { min: null as number | null, median: null as number | null, max: null as number | null, currency };

  try {
    const stats = await discogs<{ lowest_price?: { value: number } | null }>(
      `/marketplace/stats/${releaseId}?curr_abbr=${currency}`,
    );
    result.min = stats.lowest_price?.value ?? null;
  } catch {
    // stats are optional
  }

  try {
    // Suggested price per condition. Needs seller settings on the account; best effort.
    const sugg = await discogs<Record<string, { value: number }>>(`/marketplace/price_suggestions/${releaseId}`);
    const values = Object.values(sugg).map((v) => v.value).filter((v) => typeof v === "number").sort((a, b) => a - b);
    if (values.length) {
      result.median = values[Math.floor(values.length / 2)];
      result.max = values[values.length - 1];
      result.min ??= values[0];
    }
  } catch {
    // optional
  }

  return result;
}

export async function fetchDiscogsRelease(input: string): Promise<DiscogsRelease> {
  const parsed = parseDiscogsUrl(input);
  let releaseId = parsed.id;
  if (parsed.kind === "master") {
    const master = await discogs<{ main_release: number }>(`/masters/${parsed.id}`);
    releaseId = master.main_release;
  }

  const [r, prices] = await Promise.all([
    discogs<RawRelease>(`/releases/${releaseId}`),
    fetchPrices(releaseId),
  ]);

  const labels = [...new Set((r.labels ?? []).map((l) => cleanArtistName(l.name)))];
  const catno = r.labels?.find((l) => l.catno && l.catno.toLowerCase() !== "none")?.catno ?? null;
  const cover = r.images?.find((i) => i.type === "primary") ?? r.images?.[0];
  const formats = (r.formats ?? [])
    .map((f) => [f.qty && f.qty !== "1" ? `${f.qty}×` : "", f.name, ...(f.descriptions ?? [])].filter(Boolean).join(" "))
    .join(" + ");

  return {
    releaseId,
    url: r.uri,
    title: r.title,
    artists: joinArtists(r.artists),
    labels: labels.join(", "),
    catno,
    year: r.year || null,
    country: r.country || null,
    formats: formats || null,
    genres: r.genres?.join(", ") || null,
    styles: r.styles?.join(", ") || null,
    coverUrl: cover?.uri ?? null,
    tracks: flattenTracklist(r.tracklist),
    videos: (r.videos ?? []).map((v) => ({ title: v.title, url: v.uri, duration: v.duration ?? null })),
    prices,
  };
}

export async function downloadDiscogsImage(url: string): Promise<ArrayBuffer> {
  const res = await fetch(url, {
    headers: { "User-Agent": env.discogsUserAgent(), Referer: "https://www.discogs.com/" },
  });
  if (!res.ok) throw new Error(`No pude bajar la portada (${res.status})`);
  return res.arrayBuffer();
}
