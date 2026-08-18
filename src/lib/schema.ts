// Data model + build-time validation for the 10.08.2026 archive's content.
// Pages must get video/timeline data ONLY through loadVideos() / loadTimeline().
// A malformed data file throws here, which fails `astro build` — the whole
// point being that bad data never reaches the live site.

import videosData from "../data/videos.json";
import timelineData from "../data/timeline.json";
import creatorsData from "../data/creators.json";

export type VerificationStatus =
  | "verified"
  | "likely-verified"
  | "partially-verified"
  | "unverified"
  | "context-unclear";

const VERIFICATION_STATUSES: readonly VerificationStatus[] = [
  "verified",
  "likely-verified",
  "partially-verified",
  "unverified",
  "context-unclear",
];

// Whether this is raw footage filmed and posted by someone who was there
// ("participant"), or content from a media outlet, political party, or
// influencer/channel account ("media") — commentary, edited compilations,
// news-broadcast rebroadcasts, branded/pitching content. Drives feed
// ordering (see src/pages/feed.astro, src/scripts/feed.ts): participant
// footage surfaces first. See docs/content-pipeline.md "Editorial rules".
export type FootageOrigin = "participant" | "media";

const FOOTAGE_ORIGINS: readonly FootageOrigin[] = ["participant", "media"];

export interface VideoSource {
  platform: string;
  url: string; // original public URL — always preserved
  uploader: string;
  publishedAt: string;
}

export interface VideoMedia {
  video: string; // path relative to MEDIA_BASE
  thumbnail: string; // path relative to MEDIA_BASE
  duration: number; // seconds, from ffprobe
  width: number;
  height: number;
}

export interface VideoEntry {
  id: string; // stable slug, never reused, e.g. "video-001"
  title: string;
  description: string; // factual, no editorializing
  date: string; // date of the event depicted (ISO)
  location?: string; // omitted when not yet verified — never a guessed placeholder
  tags: string[]; // defaults to [] when not yet tagged
  verificationStatus: VerificationStatus;
  footageOrigin: FootageOrigin;
  sample?: boolean; // present + true ONLY for placeholder entries
  source: VideoSource;
  media: VideoMedia;
  archivedAt: string;
}

/**
 * A citation for a timeline event. The timeline makes factual claims about
 * events this archive did not witness, so each entry carries the reporting it
 * is drawn from and links out to it — the reader checks the source, rather
 * than taking this site's word for it.
 */
export interface TimelineSource {
  title: string;
  url: string;
}

/**
 * What an official actually said, tied to a timeline event. Same contract as
 * everything else in the archive: the quote is the speaker's words AS QUOTED
 * by the cited source (never reconstructed from memory or paraphrase), and
 * the source link lets the reader check it. An event with no statements
 * simply omits the field — silence is recorded by absence, not invented copy.
 */
export type StatementKind =
  | "tweet"
  | "address"
  | "press"
  | "parliament"
  | "court"
  | "interview";

const STATEMENT_KINDS: readonly StatementKind[] = [
  "tweet",
  "address",
  "press",
  "parliament",
  "court",
  "interview",
];

export interface TimelineStatement {
  speaker: string; // e.g. "Narendra Modi"
  role: string; // e.g. "Prime Minister"
  kind: StatementKind;
  date: string; // date-only ISO string of when the statement was made
  quote: string; // verbatim excerpt as quoted by the cited source
  context?: string; // one factual line on where/how it was said
  source: TimelineSource;
}

/**
 * A photograph attached to a timeline event. Same rules as archived video:
 * a real capture by a real person, credited, with a link to where the
 * original lives (Commons file page, original post). Only freely licensed
 * images or participant-posted photos consistent with the archive's
 * attribution + takedown model are committed - agency photography is never
 * copied into this repo, only linked from an event's sources.
 */
export interface TimelineImage {
  src: string; // site-relative path under /timeline/, committed to public/
  alt: string;
  caption: string; // factual, no editorializing
  credit: string; // photographer/account + license, e.g. "Photo: X, CC BY-SA 4.0"
  sourceUrl: string; // where the original lives - the reader can check it
  width: number; // intrinsic px, required so the layout never shifts
  height: number;
}

export interface TimelineEvent {
  time: string; // date-only ISO string; we have never had a clock time for these
  title: string;
  description: string;
  relatedVideoIds: string[];
  sources?: TimelineSource[];
  statements?: TimelineStatement[];
  image?: TimelineImage;
}

const VIDEO_ID_RE = /^video-\d{3}$/;

function fail(entryLabel: string, message: string): never {
  throw new Error(`Invalid entry ${entryLabel}: ${message}`);
}

function requireObject(
  value: unknown,
  entryLabel: string,
  field: string,
): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    fail(entryLabel, `field "${field}" must be an object (got ${typeof value})`);
  }
  return value as Record<string, unknown>;
}

function requireString(value: unknown, entryLabel: string, field: string): string {
  if (typeof value !== "string") {
    fail(entryLabel, `field "${field}" must be a string (got ${typeof value})`);
  }
  return value as string;
}

function requireNumber(value: unknown, entryLabel: string, field: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    fail(entryLabel, `field "${field}" must be a number (got ${typeof value})`);
  }
  return value as number;
}

function requireStringArray(value: unknown, entryLabel: string, field: string): string[] {
  if (!Array.isArray(value) || !value.every((item) => typeof item === "string")) {
    fail(entryLabel, `field "${field}" must be an array of strings`);
  }
  return value as string[];
}

// location: genuinely optional. Unlike the other string fields, this
// archive will not fabricate a location, so an entry that hasn't been
// geo-verified yet has no value here at all — not an empty string, not a
// placeholder. Presence is still type-checked when the field IS given.
function optionalString(value: unknown, entryLabel: string, field: string): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string") {
    fail(entryLabel, `field "${field}" must be a string when present (got ${typeof value})`);
  }
  return value;
}

// tags: genuinely optional, defaulting to an empty array rather than
// undefined so callers can always .map()/.filter() without a null check.
function optionalStringArray(value: unknown, entryLabel: string, field: string): string[] {
  if (value === undefined) return [];
  return requireStringArray(value, entryLabel, field);
}

// Recursively walk every string field in an already-built entry and reject
// literal "TODO" placeholders, unless the entry is explicitly marked as a
// sample/placeholder entry.
function checkNoTodoStrings(
  value: unknown,
  entryLabel: string,
  isSample: boolean,
  path = "",
): void {
  if (isSample) return;
  if (typeof value === "string") {
    if (value === "TODO") {
      fail(
        entryLabel,
        `field "${path || "(root)"}" is "TODO" but entry is not marked sample: true`,
      );
    }
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, i) => checkNoTodoStrings(item, entryLabel, isSample, `${path}[${i}]`));
    return;
  }
  if (value && typeof value === "object") {
    for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
      checkNoTodoStrings(val, entryLabel, isSample, path ? `${path}.${key}` : key);
    }
  }
}

function validateVideoEntry(raw: unknown, index: number): VideoEntry {
  const indexLabel = `videos.json[${index}]`;
  const obj = requireObject(raw, indexLabel, "(root)");

  const id = requireString(obj.id, indexLabel, "id");
  const label = `${id} (${indexLabel})`;

  if (!VIDEO_ID_RE.test(id)) {
    fail(label, `field "id" ("${id}") must match /^video-\\d{3}$/`);
  }

  const title = requireString(obj.title, label, "title");
  const description = requireString(obj.description, label, "description");
  const date = requireString(obj.date, label, "date");
  const location = optionalString(obj.location, label, "location");
  const tags = optionalStringArray(obj.tags, label, "tags");

  const verificationStatus = requireString(obj.verificationStatus, label, "verificationStatus");
  if (!VERIFICATION_STATUSES.includes(verificationStatus as VerificationStatus)) {
    fail(
      label,
      `field "verificationStatus" ("${verificationStatus}") must be one of ${VERIFICATION_STATUSES.join(", ")}`,
    );
  }

  const footageOrigin = requireString(obj.footageOrigin, label, "footageOrigin");
  if (!FOOTAGE_ORIGINS.includes(footageOrigin as FootageOrigin)) {
    fail(
      label,
      `field "footageOrigin" ("${footageOrigin}") must be one of ${FOOTAGE_ORIGINS.join(", ")}`,
    );
  }

  let sample: boolean | undefined;
  if (obj.sample !== undefined) {
    if (typeof obj.sample !== "boolean") {
      fail(label, `field "sample" must be a boolean when present (got ${typeof obj.sample})`);
    }
    sample = obj.sample;
  }

  const sourceObj = requireObject(obj.source, label, "source");
  const source: VideoSource = {
    platform: requireString(sourceObj.platform, label, "source.platform"),
    url: requireString(sourceObj.url, label, "source.url"),
    uploader: requireString(sourceObj.uploader, label, "source.uploader"),
    publishedAt: requireString(sourceObj.publishedAt, label, "source.publishedAt"),
  };

  const mediaObj = requireObject(obj.media, label, "media");
  const media: VideoMedia = {
    video: requireString(mediaObj.video, label, "media.video"),
    thumbnail: requireString(mediaObj.thumbnail, label, "media.thumbnail"),
    duration: requireNumber(mediaObj.duration, label, "media.duration"),
    width: requireNumber(mediaObj.width, label, "media.width"),
    height: requireNumber(mediaObj.height, label, "media.height"),
  };

  const archivedAt = requireString(obj.archivedAt, label, "archivedAt");

  const entry: VideoEntry = {
    id,
    title,
    description,
    date,
    ...(location !== undefined ? { location } : {}),
    tags,
    verificationStatus: verificationStatus as VerificationStatus,
    footageOrigin: footageOrigin as FootageOrigin,
    ...(sample !== undefined ? { sample } : {}),
    source,
    media,
    archivedAt,
  };

  checkNoTodoStrings(entry, label, sample === true);

  return entry;
}

function validateTimelineEvent(
  raw: unknown,
  index: number,
  validVideoIds: ReadonlySet<string>,
): TimelineEvent {
  const indexLabel = `timeline.json[${index}]`;
  const obj = requireObject(raw, indexLabel, "(root)");

  const time = requireString(obj.time, indexLabel, "time");
  const label = `${indexLabel} (time: ${time})`;

  const title = requireString(obj.title, label, "title");
  const description = requireString(obj.description, label, "description");
  const relatedVideoIds = requireStringArray(obj.relatedVideoIds, label, "relatedVideoIds");

  for (const videoId of relatedVideoIds) {
    if (!validVideoIds.has(videoId)) {
      fail(
        label,
        `field "relatedVideoIds" references unknown video id "${videoId}"`,
      );
    }
  }

  // Citations are optional, but a malformed one must fail the build rather
  // than silently vanish from the page — an event whose sourcing quietly
  // disappeared is worse than one that never claimed any.
  let sources: TimelineSource[] | undefined;
  if (obj.sources !== undefined) {
    if (!Array.isArray(obj.sources)) {
      fail(label, `field "sources" must be an array`);
    }
    sources = obj.sources.map((raw, sourceIndex) => {
      const sourceLabel = `${label} sources[${sourceIndex}]`;
      const source = requireObject(raw, sourceLabel, "(root)");
      const sourceTitle = requireString(source.title, sourceLabel, "title");
      const url = requireString(source.url, sourceLabel, "url");
      if (!/^https?:\/\//.test(url)) {
        fail(sourceLabel, `field "url" must be an absolute http(s) URL (got "${url}")`);
      }
      return { title: sourceTitle, url };
    });
  }

  // Statements are held to the same bar as citations: optional, but a
  // malformed one fails the build. A quote attributed to a real person with
  // no checkable source is exactly what this archive exists to not do.
  let statements: TimelineStatement[] | undefined;
  if (obj.statements !== undefined) {
    if (!Array.isArray(obj.statements)) {
      fail(label, `field "statements" must be an array`);
    }
    statements = obj.statements.map((rawStatement, statementIndex) => {
      const statementLabel = `${label} statements[${statementIndex}]`;
      const statement = requireObject(rawStatement, statementLabel, "(root)");

      const kind = requireString(statement.kind, statementLabel, "kind");
      if (!STATEMENT_KINDS.includes(kind as StatementKind)) {
        fail(
          statementLabel,
          `field "kind" ("${kind}") must be one of ${STATEMENT_KINDS.join(", ")}`,
        );
      }

      const sourceObj = requireObject(statement.source, statementLabel, "source");
      const sourceUrl = requireString(sourceObj.url, statementLabel, "source.url");
      if (!/^https?:\/\//.test(sourceUrl)) {
        fail(statementLabel, `field "source.url" must be an absolute http(s) URL (got "${sourceUrl}")`);
      }

      const context = optionalString(statement.context, statementLabel, "context");

      return {
        speaker: requireString(statement.speaker, statementLabel, "speaker"),
        role: requireString(statement.role, statementLabel, "role"),
        kind: kind as StatementKind,
        date: requireString(statement.date, statementLabel, "date"),
        quote: requireString(statement.quote, statementLabel, "quote"),
        ...(context !== undefined ? { context } : {}),
        source: {
          title: requireString(sourceObj.title, statementLabel, "source.title"),
          url: sourceUrl,
        },
      };
    });
  }

  // Event photo: optional, but held to the citation bar - a credited image
  // with no checkable source page, or a file path outside the committed
  // /timeline/ tree, fails the build.
  let image: TimelineImage | undefined;
  if (obj.image !== undefined) {
    const imageObj = requireObject(obj.image, label, "image");
    const src = requireString(imageObj.src, label, "image.src");
    if (!src.startsWith("/timeline/")) {
      fail(label, `field "image.src" must be a committed /timeline/ path (got "${src}")`);
    }
    const imageSourceUrl = requireString(imageObj.sourceUrl, label, "image.sourceUrl");
    if (!/^https?:\/\//.test(imageSourceUrl)) {
      fail(label, `field "image.sourceUrl" must be an absolute http(s) URL (got "${imageSourceUrl}")`);
    }
    image = {
      src,
      alt: requireString(imageObj.alt, label, "image.alt"),
      caption: requireString(imageObj.caption, label, "image.caption"),
      credit: requireString(imageObj.credit, label, "image.credit"),
      sourceUrl: imageSourceUrl,
      width: requireNumber(imageObj.width, label, "image.width"),
      height: requireNumber(imageObj.height, label, "image.height"),
    };
  }

  const entry: TimelineEvent = {
    time,
    title,
    description,
    relatedVideoIds,
    sources,
    ...(statements !== undefined ? { statements } : {}),
    ...(image !== undefined ? { image } : {}),
  };

  checkNoTodoStrings(entry, label, false);

  return entry;
}

// Sample/placeholder entries exist only to demo the pipeline locally against
// an otherwise-empty archive — they must never reach a visitor. Every public
// page (feed, video/[id]) must filter through this before rendering.
export function publicVideos(videos: VideoEntry[]): VideoEntry[] {
  return videos.filter((video) => !video.sample);
}

let cachedVideos: VideoEntry[] | null = null;

export function loadVideos(): VideoEntry[] {
  if (cachedVideos) return cachedVideos;

  if (!Array.isArray(videosData)) {
    throw new Error("Invalid videos.json: root must be an array");
  }

  const entries = videosData.map((raw, index) => validateVideoEntry(raw, index));

  const seenIds = new Set<string>();
  for (const entry of entries) {
    if (seenIds.has(entry.id)) {
      throw new Error(`Invalid entry ${entry.id}: duplicate id in videos.json`);
    }
    seenIds.add(entry.id);
  }

  cachedVideos = entries;
  return entries;
}

/**
 * Independent media / creator coverage (the /coverage page). Unlike videos.json
 * this holds NO archived copies — every entry is a pointer to a video that
 * lives on the creator's own YouTube channel, grouped by channel. Same
 * validation bar as the archive itself: a malformed entry fails the build.
 */
export type CreatorVideoOrientation = "landscape" | "vertical";

const CREATOR_VIDEO_ORIENTATIONS: readonly CreatorVideoOrientation[] = [
  "landscape",
  "vertical",
];

// Which i.ytimg.com thumbnail variant was confirmed to exist for the video at
// collection time (hq720 → 1280×720; hqdefault → 480×360 fallback that exists
// for every video; oar2 → the 405×720 portrait thumb Shorts get). Recorded in
// data rather than probed at runtime because a static site can't fall back
// gracefully when a variant 404s.
export type CreatorVideoThumb = "hq720" | "hqdefault" | "oar2";

const CREATOR_VIDEO_THUMBS: readonly CreatorVideoThumb[] = [
  "hq720",
  "hqdefault",
  "oar2",
];

export interface CreatorVideo {
  youtubeId: string; // 11-char YouTube video id
  title: string; // verbatim as posted by the channel
  publishedAt: string; // date-only ISO, as YouTube reports it
  duration: number; // seconds
  orientation: CreatorVideoOrientation;
  thumb: CreatorVideoThumb;
}

export interface Creator {
  id: string; // stable kebab-case slug, used as the section anchor
  name: string;
  handle: string; // YouTube handle, with the leading @
  channelUrl: string;
  subscribers: string; // display string as captured (see capturedAt) — goes stale by design
  blurb: string; // one factual line on what this channel's coverage is
  /**
   * Channel profile picture, captured once (see capturedAt) and committed
   * under public/coverage/ — same committed-path rule as TimelineImage, and
   * self-hosted rather than hotlinked from yt3.googleusercontent.com because
   * those URLs rot when a channel changes its picture and would widen the
   * CSP. Optional: a creator without one renders a monogram instead.
   */
  avatar?: string;
  videos: CreatorVideo[];
}

export interface CreatorsFile {
  capturedAt: string; // date the channel details (subscriber counts) were captured
  creators: Creator[];
}

const CREATOR_ID_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const YOUTUBE_ID_RE = /^[A-Za-z0-9_-]{11}$/;
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function validateCreatorVideo(raw: unknown, creatorLabel: string, index: number): CreatorVideo {
  const label = `${creatorLabel} videos[${index}]`;
  const obj = requireObject(raw, label, "(root)");

  const youtubeId = requireString(obj.youtubeId, label, "youtubeId");
  if (!YOUTUBE_ID_RE.test(youtubeId)) {
    fail(label, `field "youtubeId" ("${youtubeId}") must be an 11-character YouTube id`);
  }

  const publishedAt = requireString(obj.publishedAt, label, "publishedAt");
  if (!ISO_DATE_RE.test(publishedAt)) {
    fail(label, `field "publishedAt" ("${publishedAt}") must be a date-only ISO string`);
  }

  const duration = requireNumber(obj.duration, label, "duration");
  if (duration <= 0) {
    fail(label, `field "duration" (${duration}) must be a positive number of seconds`);
  }

  const orientation = requireString(obj.orientation, label, "orientation");
  if (!CREATOR_VIDEO_ORIENTATIONS.includes(orientation as CreatorVideoOrientation)) {
    fail(
      label,
      `field "orientation" ("${orientation}") must be one of ${CREATOR_VIDEO_ORIENTATIONS.join(", ")}`,
    );
  }

  const thumb = requireString(obj.thumb, label, "thumb");
  if (!CREATOR_VIDEO_THUMBS.includes(thumb as CreatorVideoThumb)) {
    fail(label, `field "thumb" ("${thumb}") must be one of ${CREATOR_VIDEO_THUMBS.join(", ")}`);
  }

  return {
    youtubeId,
    title: requireString(obj.title, label, "title"),
    publishedAt,
    duration,
    orientation: orientation as CreatorVideoOrientation,
    thumb: thumb as CreatorVideoThumb,
  };
}

function validateCreator(raw: unknown, index: number): Creator {
  const indexLabel = `creators.json[${index}]`;
  const obj = requireObject(raw, indexLabel, "(root)");

  const id = requireString(obj.id, indexLabel, "id");
  const label = `${id} (${indexLabel})`;

  if (!CREATOR_ID_RE.test(id)) {
    fail(label, `field "id" ("${id}") must be a kebab-case slug`);
  }

  const handle = requireString(obj.handle, label, "handle");
  if (!handle.startsWith("@")) {
    fail(label, `field "handle" ("${handle}") must start with "@"`);
  }

  const channelUrl = requireString(obj.channelUrl, label, "channelUrl");
  if (!/^https:\/\/(www\.)?youtube\.com\//.test(channelUrl)) {
    fail(label, `field "channelUrl" ("${channelUrl}") must be an absolute youtube.com URL`);
  }

  const avatar = optionalString(obj.avatar, label, "avatar");
  if (avatar !== undefined && !avatar.startsWith("/coverage/")) {
    fail(label, `field "avatar" must be a committed /coverage/ path (got "${avatar}")`);
  }

  if (!Array.isArray(obj.videos) || obj.videos.length === 0) {
    fail(label, `field "videos" must be a non-empty array`);
  }

  const entry: Creator = {
    id,
    name: requireString(obj.name, label, "name"),
    handle,
    channelUrl,
    subscribers: requireString(obj.subscribers, label, "subscribers"),
    blurb: requireString(obj.blurb, label, "blurb"),
    ...(avatar !== undefined ? { avatar } : {}),
    videos: (obj.videos as unknown[]).map((video, videoIndex) =>
      validateCreatorVideo(video, label, videoIndex),
    ),
  };

  checkNoTodoStrings(entry, label, false);

  return entry;
}

let cachedCreators: CreatorsFile | null = null;

export function loadCreators(): CreatorsFile {
  if (cachedCreators) return cachedCreators;

  const root = requireObject(creatorsData, "creators.json", "(root)");

  const capturedAt = requireString(root.capturedAt, "creators.json", "capturedAt");
  if (!ISO_DATE_RE.test(capturedAt)) {
    throw new Error(
      `Invalid entry creators.json: field "capturedAt" ("${capturedAt}") must be a date-only ISO string`,
    );
  }

  if (!Array.isArray(root.creators)) {
    throw new Error('Invalid entry creators.json: field "creators" must be an array');
  }

  const creators = root.creators.map((raw, index) => validateCreator(raw, index));

  const seenCreatorIds = new Set<string>();
  const seenYoutubeIds = new Set<string>();
  for (const creator of creators) {
    if (seenCreatorIds.has(creator.id)) {
      throw new Error(`Invalid entry ${creator.id}: duplicate creator id in creators.json`);
    }
    seenCreatorIds.add(creator.id);
    for (const video of creator.videos) {
      if (seenYoutubeIds.has(video.youtubeId)) {
        throw new Error(
          `Invalid entry ${creator.id}: duplicate youtubeId "${video.youtubeId}" in creators.json`,
        );
      }
      seenYoutubeIds.add(video.youtubeId);
    }
  }

  cachedCreators = { capturedAt, creators };
  return cachedCreators;
}

let cachedTimeline: TimelineEvent[] | null = null;

export function loadTimeline(): TimelineEvent[] {
  if (cachedTimeline) return cachedTimeline;

  if (!Array.isArray(timelineData)) {
    throw new Error("Invalid timeline.json: root must be an array");
  }

  const validVideoIds = new Set(loadVideos().map((video) => video.id));
  const entries = timelineData.map((raw, index) =>
    validateTimelineEvent(raw, index, validVideoIds),
  );

  cachedTimeline = entries;
  return entries;
}
