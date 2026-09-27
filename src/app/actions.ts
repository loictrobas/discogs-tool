"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireProfile, usernameToEmail, normalizeUsername } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient, MEDIA_BUCKET } from "@/lib/supabase/admin";
import {
  chooseAudio,
  createRecordFromDiscogs,
  defaultCaption,
  getRecord,
  getTracks,
  registerUploadedAudio,
  renderTrackVideo,
  updateRecord,
  updateTrack,
  MAX_CAROUSEL,
} from "@/lib/records";
import { findAudioCandidates, searchYoutube, youtubeId, type AudioCandidate } from "@/lib/audio-search";
import { advancePublish } from "@/lib/publish";

export type ActionResult = { error?: string };

// ---------- auth ----------

export async function login(_: ActionResult, formData: FormData): Promise<ActionResult> {
  const username = String(formData.get("username") ?? "");
  const password = String(formData.get("password") ?? "");
  if (!username || !password) return { error: "Completá usuario y contraseña" };

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email: usernameToEmail(username), password });
  if (error) return { error: "Usuario o contraseña incorrectos" };
  redirect("/");
}

export async function logout() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}

// ---------- records ----------

export async function createRecord(_: ActionResult, formData: FormData): Promise<ActionResult> {
  const profile = await requireProfile();
  const url = String(formData.get("url") ?? "").trim();
  if (!url) return { error: "Pegá un link de Discogs" };

  let id: string;
  try {
    id = await createRecordFromDiscogs(url, profile.id);
  } catch (e) {
    return { error: (e as Error).message };
  }
  redirect(`/discos/${id}`);
}

const recordFields = z.object({
  owner_id: z.string().uuid().nullable().optional(),
  price: z.number().nonnegative().nullable().optional(),
  currency: z.enum(["USD", "ARS", "EUR"]).optional(),
  media_condition: z.string().max(20).nullable().optional(),
  sleeve_condition: z.string().max(20).nullable().optional(),
  caption: z.string().max(2200).nullable().optional(),
  notes: z.string().max(2000).nullable().optional(),
});

export async function saveRecord(id: string, fields: z.infer<typeof recordFields>) {
  await requireProfile();
  await updateRecord(id, recordFields.parse(fields));
  revalidatePath(`/discos/${id}`);
  revalidatePath("/");
}

export async function markSold(id: string, soldPrice: number | null) {
  await requireProfile();
  await updateRecord(id, { status: "sold", sold_at: new Date().toISOString(), sold_price: soldPrice });
  revalidatePath("/");
  revalidatePath(`/discos/${id}`);
}

export async function markAvailable(id: string) {
  await requireProfile();
  const record = await getRecord(id);
  await updateRecord(id, {
    status: record.published_at ? "published" : "draft",
    sold_at: null,
    sold_price: null,
  });
  revalidatePath("/");
  revalidatePath(`/discos/${id}`);
}

export async function deleteRecord(id: string) {
  await requireProfile();
  const admin = createAdminClient();
  const tracks = await getTracks(id);
  const record = await getRecord(id);
  const files = [
    record.cover_path,
    ...tracks.flatMap((t) => [t.audio_path, t.video_path]),
  ].filter((p): p is string => Boolean(p));
  if (files.length) await admin.storage.from(MEDIA_BUCKET).remove(files);
  await admin.from("records").delete().eq("id", id);
  revalidatePath("/");
  redirect("/");
}

export async function regenerateCaption(id: string) {
  await requireProfile();
  const caption = await defaultCaption(id);
  await updateRecord(id, { caption });
  revalidatePath(`/discos/${id}`);
  return caption;
}

// ---------- tracks ----------

export async function setTrackSelected(trackId: string, recordId: string, selected: boolean) {
  await requireProfile();
  if (selected) {
    const count = (await getTracks(recordId)).filter((t) => t.selected && t.id !== trackId).length;
    if (count >= MAX_CAROUSEL) return { error: `Instagram permite hasta ${MAX_CAROUSEL} videos por carrusel` };
  }
  await updateTrack(trackId, { selected });
  revalidatePath(`/discos/${recordId}`);
  return {};
}

export async function pickAudio(trackId: string, recordId: string, candidate: AudioCandidate) {
  await requireProfile();
  await chooseAudio(trackId, candidate);
  revalidatePath(`/discos/${recordId}`);
}

export async function pickYoutubeUrl(trackId: string, recordId: string, url: string): Promise<ActionResult> {
  await requireProfile();
  const id = youtubeId(url);
  if (!id) return { error: "Ese link no parece de YouTube" };
  await chooseAudio(trackId, { source: "youtube", ref: `https://www.youtube.com/watch?v=${id}`, title: "Link manual", subtitle: url });
  revalidatePath(`/discos/${recordId}`);
  return {};
}

export async function searchTrackAudio(trackId: string, recordId: string, query?: string) {
  await requireProfile();
  const record = await getRecord(recordId);
  const track = (await getTracks(recordId)).find((t) => t.id === trackId);
  if (!track) return [];

  const candidates = query?.trim()
    ? await searchYoutube(query.trim(), 8)
    : await findAudioCandidates({
        trackTitle: track.title,
        trackArtists: track.artists,
        releaseArtists: record.artists,
        label: record.labels.split(",")[0] ?? "",
        discogsVideos: record.discogs_videos,
      });
  await updateTrack(trackId, { candidates });
  revalidatePath(`/discos/${recordId}`);
  return candidates;
}

export async function setTrackStart(trackId: string, recordId: string, startSec: number) {
  await requireProfile();
  await updateTrack(trackId, { start_sec: Math.max(0, Math.round(startSec)), video_status: "none" });
  revalidatePath(`/discos/${recordId}`);
}

export async function confirmUpload(trackId: string, recordId: string, path: string, filename: string) {
  await requireProfile();
  await registerUploadedAudio(trackId, path, filename);
  revalidatePath(`/discos/${recordId}`);
}

export async function renderVideo(trackId: string, recordId: string): Promise<ActionResult> {
  await requireProfile();
  try {
    await renderTrackVideo(trackId);
  } catch (e) {
    return { error: (e as Error).message };
  }
  revalidatePath(`/discos/${recordId}`);
  return {};
}

export async function uploadCover(recordId: string, path: string) {
  await requireProfile();
  await updateRecord(recordId, { cover_path: path });
  const tracks = await getTracks(recordId);
  await Promise.all(tracks.map((t) => updateTrack(t.id, { video_status: "none" })));
  revalidatePath(`/discos/${recordId}`);
}

// ---------- publish ----------

export async function publishStep(recordId: string) {
  await requireProfile();
  try {
    const state = await advancePublish(recordId);
    if (state.step === "done") revalidatePath("/");
    return state;
  } catch (e) {
    return { step: "error" as const, error: (e as Error).message, children: [], startedAt: "" };
  }
}

// ---------- users (admin) ----------

const newUser = z.object({
  username: z.string().min(2).max(30).regex(/^[a-z0-9._-]+$/i, "Solo letras, números, punto, guión"),
  display_name: z.string().min(1).max(40),
  password: z.string().min(8, "La contraseña necesita al menos 8 caracteres"),
});

export async function createUser(_: ActionResult, formData: FormData): Promise<ActionResult> {
  const me = await requireProfile();
  if (!me.is_admin) return { error: "Solo el admin puede crear usuarios" };

  const parsed = newUser.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Datos inválidos" };
  const { username, display_name, password } = parsed.data;

  const admin = createAdminClient();
  const { data, error } = await admin.auth.admin.createUser({
    email: usernameToEmail(username),
    password,
    email_confirm: true,
  });
  if (error || !data.user) return { error: error?.message ?? "No se pudo crear" };

  const { error: pErr } = await admin
    .from("profiles")
    .insert({ id: data.user.id, username: normalizeUsername(username), display_name });
  if (pErr) {
    await admin.auth.admin.deleteUser(data.user.id);
    return { error: pErr.message };
  }
  revalidatePath("/usuarios");
  return {};
}

export async function resetPassword(_: ActionResult, formData: FormData): Promise<ActionResult> {
  const me = await requireProfile();
  const userId = String(formData.get("user_id") ?? "");
  const password = String(formData.get("password") ?? "");
  if (!me.is_admin && me.id !== userId) return { error: "No autorizado" };
  if (password.length < 8) return { error: "La contraseña necesita al menos 8 caracteres" };

  const { error } = await createAdminClient().auth.admin.updateUserById(userId, { password });
  if (error) return { error: error.message };
  return {};
}
