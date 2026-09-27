import "server-only";
import {
  containerStatus,
  createCarousel,
  createCarouselItem,
  createReel,
  mediaPermalink,
  publishContainer,
} from "@/lib/instagram";
import {
  getRecord,
  getTracks,
  MAX_CAROUSEL,
  publicMediaUrl,
  updateRecord,
  type PublishState,
} from "@/lib/records";

/**
 * Instagram publishing is asynchronous (it downloads and transcodes every video),
 * so it runs as a small state machine persisted in records.ig_state. The browser
 * calls advancePublish() every few seconds until it reports "done" or "error".
 * Each call does a bounded amount of work, so it fits in a short serverless run.
 */
export async function advancePublish(recordId: string): Promise<PublishState> {
  const record = await getRecord(recordId);
  let state = record.ig_state;

  if (!state || state.step === "error") {
    const tracks = (await getTracks(recordId)).filter((t) => t.selected).slice(0, MAX_CAROUSEL);
    if (!tracks.length) throw new Error("No hay tracks seleccionados");
    const notReady = tracks.filter((t) => t.video_status !== "ready" || !t.video_path);
    if (notReady.length) throw new Error(`Faltan videos: ${notReady.map((t) => t.position || t.title).join(", ")}`);
    if (!record.caption?.trim()) throw new Error("Falta el texto de la publicación");

    state = { step: "children", children: [], startedAt: new Date().toISOString() };

    try {
      if (tracks.length === 1) {
        // A single video can't be a carousel: publish it as a Reel.
        state.parentId = await createReel(publicMediaUrl(tracks[0].video_path!), record.caption);
        state.step = "parent";
      } else {
        for (const t of tracks) {
          state.children.push({ trackId: t.id, id: await createCarouselItem(publicMediaUrl(t.video_path!)) });
        }
      }
    } catch (e) {
      state = { ...state, step: "error", error: (e as Error).message };
    }
    await updateRecord(recordId, { ig_state: state });
    return state;
  }

  try {
    if (state.step === "children") {
      const statuses = await Promise.all(state.children.map((c) => containerStatus(c.id)));
      const failed = statuses.find((s) => s.status_code === "ERROR" || s.status_code === "EXPIRED");
      if (failed) throw new Error(`Instagram rechazó un video: ${failed.status ?? failed.status_code}`);
      if (statuses.every((s) => s.status_code === "FINISHED")) {
        state = { ...state, step: "parent", parentId: await createCarousel(state.children.map((c) => c.id), record.caption ?? "") };
      }
    } else if (state.step === "parent" && state.parentId) {
      const s = await containerStatus(state.parentId);
      if (s.status_code === "ERROR" || s.status_code === "EXPIRED") {
        throw new Error(`Instagram rechazó la publicación: ${s.status ?? s.status_code}`);
      }
      if (s.status_code === "FINISHED") {
        const mediaId = await publishContainer(state.parentId);
        const permalink = await mediaPermalink(mediaId).catch(() => null);
        state = { ...state, step: "done" };
        await updateRecord(recordId, {
          ig_state: state,
          ig_media_id: mediaId,
          ig_permalink: permalink,
          status: record.status === "sold" ? "sold" : "published",
          published_at: new Date().toISOString(),
        });
        return state;
      }
    }
  } catch (e) {
    state = { ...state, step: "error", error: (e as Error).message };
  }

  await updateRecord(recordId, { ig_state: state });
  return state;
}
