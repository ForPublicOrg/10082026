// Pure display helpers for the /coverage page (independent-media directory).
// Kept out of the .astro files so both the creator sections and the mixed
// "more from the ground" rail format things identically, and so they can be
// unit-tested without a Cloudflare or Astro runtime.

import type { CreatorVideo } from "./schema";

// The day of the march — cards published on this date get a small marker on
// the /coverage rails.
export const MARCH_DAY = "2026-08-10";

export function watchUrl(video: CreatorVideo): string {
  return `https://www.youtube.com/watch?v=${video.youtubeId}`;
}

// The thumb variant is confirmed per-video at collection time (see
// CreatorVideoThumb in schema.ts) — never guessed here, because a 404ing
// variant on a static page has no graceful fallback.
export function thumbUrl(video: CreatorVideo): string {
  return `https://i.ytimg.com/vi/${video.youtubeId}/${video.thumb}.jpg`;
}

// 75 → "1:15", 3256 → "54:16", 10915 → "3:01:55" (YouTube's own format).
export function formatDuration(totalSeconds: number): string {
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = Math.floor(totalSeconds % 60);
  const pad = (n: number) => String(n).padStart(2, "0");
  return hours > 0
    ? `${hours}:${pad(minutes)}:${pad(seconds)}`
    : `${minutes}:${pad(seconds)}`;
}

// Compact card date: "Jul 20". Every entry is from 2026, so the year lives in
// the page intro and the <time datetime> attribute, not on every card.
export function formatCardDate(isoDate: string): string {
  return new Date(`${isoDate}T00:00:00Z`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}
