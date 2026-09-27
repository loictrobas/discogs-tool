import "server-only";
import { env } from "@/lib/env";

const GRAPH = "https://graph.facebook.com/v25.0";

type GraphError = { error?: { message?: string; error_user_msg?: string } };

async function graph<T>(path: string, init?: { method?: "GET" | "POST"; params?: Record<string, string> }) {
  const params = new URLSearchParams({ ...init?.params, access_token: env.igAccessToken() });
  const method = init?.method ?? "GET";
  const url = method === "GET" ? `${GRAPH}${path}?${params}` : `${GRAPH}${path}`;
  const res = await fetch(url, {
    method,
    body: method === "POST" ? params : undefined,
    cache: "no-store",
  });
  const json = (await res.json()) as T & GraphError;
  if (!res.ok || json.error) {
    throw new Error(`Instagram: ${json.error?.error_user_msg || json.error?.message || res.status}`);
  }
  return json as T;
}

export async function createCarouselItem(videoUrl: string) {
  const r = await graph<{ id: string }>(`/${env.igUserId()}/media`, {
    method: "POST",
    params: { media_type: "VIDEO", video_url: videoUrl, is_carousel_item: "true" },
  });
  return r.id;
}

export async function createCarousel(childrenIds: string[], caption: string) {
  const r = await graph<{ id: string }>(`/${env.igUserId()}/media`, {
    method: "POST",
    params: { media_type: "CAROUSEL", children: childrenIds.join(","), caption },
  });
  return r.id;
}

export async function createReel(videoUrl: string, caption: string) {
  const r = await graph<{ id: string }>(`/${env.igUserId()}/media`, {
    method: "POST",
    params: { media_type: "REELS", video_url: videoUrl, caption, share_to_feed: "true" },
  });
  return r.id;
}

export type ContainerStatus = "IN_PROGRESS" | "FINISHED" | "ERROR" | "EXPIRED" | "PUBLISHED";

export async function containerStatus(id: string) {
  const r = await graph<{ status_code: ContainerStatus; status?: string }>(`/${id}`, {
    params: { fields: "status_code,status" },
  });
  return r;
}

export async function publishContainer(creationId: string) {
  const r = await graph<{ id: string }>(`/${env.igUserId()}/media_publish`, {
    method: "POST",
    params: { creation_id: creationId },
  });
  return r.id;
}

export async function mediaPermalink(mediaId: string) {
  const r = await graph<{ permalink?: string }>(`/${mediaId}`, { params: { fields: "permalink" } });
  return r.permalink ?? null;
}
