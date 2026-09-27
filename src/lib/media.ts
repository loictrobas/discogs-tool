import "server-only";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import ffmpegPath from "ffmpeg-static";
import { CLIP_SECONDS, autoStart } from "@/lib/clip";

export { CLIP_SECONDS, autoStart };

export const FRAME = { width: 1080, height: 1350 } as const; // 4:5, Instagram feed

function ffmpeg(args: string[]): Promise<{ stderr: string }> {
  if (!ffmpegPath) throw new Error("ffmpeg no disponible");
  return new Promise((resolve, reject) => {
    const proc = spawn(ffmpegPath as string, args);
    let stderr = "";
    proc.stderr.on("data", (d) => (stderr += d.toString()));
    proc.on("error", reject);
    proc.on("close", (code) => {
      if (code === 0) resolve({ stderr });
      else reject(new Error(`ffmpeg salió con ${code}: ${stderr.split("\n").slice(-6).join(" ")}`));
    });
  });
}

/** Duration in seconds, parsed from ffmpeg's banner (no ffprobe in ffmpeg-static). */
export async function probeDuration(file: string): Promise<number | null> {
  const { stderr } = await ffmpeg(["-hide_banner", "-i", file, "-f", "null", "-t", "0", "-"]).catch(
    (e: Error) => ({ stderr: e.message }),
  );
  const m = stderr.match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/);
  if (!m) return null;
  return Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]);
}

export async function withTempDir<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(path.join(tmpdir(), "discos-"));
  try {
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/** Still frame + audio clip -> H.264/AAC mp4 that Instagram accepts. */
export async function renderClip(opts: {
  framePng: Uint8Array;
  audio: Uint8Array;
  audioExt: string;
  startSec: number;
}): Promise<Uint8Array> {
  return withTempDir(async (dir) => {
    const frame = path.join(dir, "frame.png");
    const audio = path.join(dir, `audio.${opts.audioExt}`);
    const out = path.join(dir, "out.mp4");
    await writeFile(frame, opts.framePng);
    await writeFile(audio, opts.audio);

    const duration = await probeDuration(audio);
    const start = duration && opts.startSec >= duration - 3 ? autoStart(duration) : opts.startSec;
    const fade = 1.5;
    const clipLen = Math.min(CLIP_SECONDS, duration ? Math.max(3, duration - start) : CLIP_SECONDS);

    await ffmpeg([
      "-y",
      "-loop", "1", "-framerate", "24", "-i", frame,
      "-ss", String(start), "-t", String(clipLen), "-i", audio,
      "-map", "0:v", "-map", "1:a",
      "-af", `afade=t=in:d=0.5,afade=t=out:st=${Math.max(0, clipLen - fade)}:d=${fade}`,
      "-c:v", "libx264", "-tune", "stillimage", "-preset", "veryfast", "-crf", "20",
      "-pix_fmt", "yuv420p", "-r", "24",
      "-c:a", "aac", "-b:a", "192k", "-ar", "44100", "-ac", "2",
      "-t", String(clipLen), "-shortest",
      "-movflags", "+faststart",
      out,
    ]);
    return new Uint8Array(await readFile(out));
  });
}

/** Duration of an in-memory audio file. */
export async function audioDuration(audio: Uint8Array, ext: string) {
  return withTempDir(async (dir) => {
    const file = path.join(dir, `a.${ext}`);
    await writeFile(file, audio);
    return probeDuration(file);
  });
}

export function extFromPath(p: string, fallback = "m4a") {
  const m = p.match(/\.([a-z0-9]{2,4})(?:\?|$)/i);
  return m ? m[1].toLowerCase() : fallback;
}
