export const CLIP_SECONDS = 30;

/** Default clip start: 1:30 on long tracks, centered on short ones, 0 for previews. */
export function autoStart(duration: number | null) {
  if (!duration || duration <= CLIP_SECONDS + 5) return 0;
  if (duration < 150) return Math.max(0, Math.floor((duration - CLIP_SECONDS) / 2));
  return 90;
}
