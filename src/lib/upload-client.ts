"use client";

import { createClient } from "@/lib/supabase/client";

/** Uploads a file from the browser straight to the public media bucket. */
export async function uploadToMedia(folder: string, file: File) {
  const ext = (file.name.split(".").pop() || "bin").toLowerCase().replace(/[^a-z0-9]/g, "");
  const path = `${folder}/${crypto.randomUUID()}.${ext}`;
  const { error } = await createClient()
    .storage.from("media")
    .upload(path, file, { contentType: file.type || undefined, upsert: false });
  if (error) throw new Error(error.message);
  return path;
}

export function fmtTime(sec: number | null | undefined) {
  if (sec == null || Number.isNaN(sec)) return "–:––";
  const s = Math.max(0, Math.round(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}
