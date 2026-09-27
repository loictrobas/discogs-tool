/**
 * Audio worker: downloads queued YouTube audio (tracks.audio_status = 'pending')
 * with yt-dlp and uploads it to Supabase Storage.
 *
 * YouTube blocks most cloud/datacenter IPs, so this runs on a home machine.
 * Requirements: yt-dlp (+ deno for YouTube's JS challenges) on PATH.
 *
 *   pnpm worker            # loop forever
 *   pnpm worker --once     # process the queue once and exit
 */
import { execFile } from "node:child_process";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { createClient } from "@supabase/supabase-js";

const run = promisify(execFile);
const POLL_MS = 5000;
const once = process.argv.includes("--once");

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SECRET_KEY;
if (!url || !key) throw new Error("Faltan NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SECRET_KEY");
const db = createClient(url, key, { auth: { persistSession: false } });

type Job = { id: string; title: string; audio_ref: string };

function log(...args: unknown[]) {
  console.log(new Date().toISOString(), ...args);
}

async function download(job: Job) {
  const dir = await mkdtemp(path.join(tmpdir(), "yt-"));
  try {
    const { stdout } = await run(
      "yt-dlp",
      [
        "--no-playlist",
        "--no-warnings",
        "--quiet",
        "-f", "bestaudio[ext=m4a]/bestaudio",
        "-x", "--audio-format", "m4a",
        "--print", "after_move:%(duration)s",
        "-o", path.join(dir, "audio.%(ext)s"),
        job.audio_ref,
      ],
      { timeout: 5 * 60_000, maxBuffer: 10 * 1024 * 1024 },
    );

    const file = (await readdir(dir)).find((f) => f.startsWith("audio."));
    if (!file) throw new Error("yt-dlp no generó archivo");
    const bytes = await readFile(path.join(dir, file));
    const duration = Number(stdout.trim().split("\n").pop()) || null;
    return { bytes, duration };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

async function processOne(): Promise<boolean> {
  const { data, error } = await db.rpc("claim_audio_job");
  if (error) throw new Error(error.message);
  const job = (data as Job[] | null)?.[0];
  if (!job) return false;

  log("⬇︎", job.title, job.audio_ref);
  try {
    const { bytes, duration } = await download(job);
    const storagePath = `audio/${job.id}.m4a`;
    const up = await db.storage.from("media").upload(storagePath, bytes, { contentType: "audio/mp4", upsert: true });
    if (up.error) throw new Error(up.error.message);
    await db
      .from("tracks")
      .update({ audio_status: "ready", audio_path: storagePath, audio_duration: duration, video_status: "none" })
      .eq("id", job.id);
    log("✓", job.title, `${Math.round(bytes.length / 1024)} KB`, duration ? `${duration}s` : "");
  } catch (e) {
    const message = (e as { stderr?: string; message: string }).stderr?.trim().split("\n").pop() || (e as Error).message;
    log("✗", job.title, message);
    await db.from("tracks").update({ audio_status: "error", audio_error: `YouTube: ${message}` }).eq("id", job.id);
  }
  return true;
}

async function main() {
  const { stdout } = await run("yt-dlp", ["--version"]).catch(() => {
    throw new Error("No encuentro yt-dlp. Instalalo con: brew install yt-dlp deno");
  });
  log(`audio worker listo (yt-dlp ${stdout.trim()})`);

  for (;;) {
    let worked = false;
    try {
      while (await processOne()) worked = true;
    } catch (e) {
      log("error", (e as Error).message);
    }
    if (once) break;
    if (!worked) await new Promise((r) => setTimeout(r, POLL_MS));
  }
}

void main();
