import { describe, expect, it, vi } from "vitest";
import { loadCreators } from "../../src/lib/schema";

// The real committed data file must always pass validation — regression test
// against bad hand-edits landing in src/data/creators.json, using the static
// top-level import so it exercises exactly what astro build calls.
describe("real content (src/data/creators.json)", () => {
  it("loadCreators() does not throw and returns unique creator ids and youtube ids", () => {
    const { capturedAt, creators } = loadCreators();
    expect(capturedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(creators.length).toBeGreaterThan(0);

    const creatorIds = creators.map((c) => c.id);
    expect(new Set(creatorIds).size).toBe(creatorIds.length);

    const youtubeIds = creators.flatMap((c) => c.videos.map((v) => v.youtubeId));
    expect(youtubeIds.length).toBeGreaterThan(0);
    expect(new Set(youtubeIds).size).toBe(youtubeIds.length);
  });

  it("every video is well-formed enough to render a card from", () => {
    for (const creator of loadCreators().creators) {
      expect(creator.handle.startsWith("@")).toBe(true);
      expect(creator.channelUrl).toMatch(/^https:\/\/(www\.)?youtube\.com\//);
      for (const video of creator.videos) {
        expect(video.youtubeId).toMatch(/^[A-Za-z0-9_-]{11}$/);
        expect(video.publishedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);
        expect(video.duration).toBeGreaterThan(0);
      }
    }
  });
});

// Validation edge cases against fixture data. loadCreators() caches in
// module-level state, so each case mocks the JSON import and re-imports a
// fresh copy of the module via resetModules() — same pattern as schema.test.ts.
function minimalCreator(overrides: Record<string, unknown> = {}) {
  return {
    id: "some-channel",
    name: "Some Channel",
    handle: "@SomeChannel",
    channelUrl: "https://www.youtube.com/@SomeChannel",
    subscribers: "1.2M",
    blurb: "A channel.",
    videos: [minimalCreatorVideo()],
    ...overrides,
  };
}

function minimalCreatorVideo(overrides: Record<string, unknown> = {}) {
  return {
    youtubeId: "dQw4w9WgXcQ",
    title: "A video",
    publishedAt: "2026-07-20",
    duration: 60,
    orientation: "landscape",
    thumb: "hq720",
    ...overrides,
  };
}

async function loadWithFixture(root: unknown) {
  vi.resetModules();
  vi.doMock("../../src/data/creators.json", () => ({ default: root }));
  return import("../../src/lib/schema");
}

describe("loadCreators() validation", () => {
  it("accepts a minimal well-formed file", async () => {
    const schema = await loadWithFixture({ capturedAt: "2026-08-09", creators: [minimalCreator()] });
    expect(schema.loadCreators().creators).toHaveLength(1);
  });

  it("rejects a root that is not an object with a creators array", async () => {
    const schema = await loadWithFixture([minimalCreator()]);
    expect(() => schema.loadCreators()).toThrow(/must be an object/);
  });

  it("rejects a missing or malformed capturedAt", async () => {
    const schema = await loadWithFixture({ capturedAt: "August 2026", creators: [] });
    expect(() => schema.loadCreators()).toThrow(/capturedAt/);
  });

  it("rejects a creator id that is not a kebab-case slug", async () => {
    const schema = await loadWithFixture({
      capturedAt: "2026-08-09",
      creators: [minimalCreator({ id: "Some Channel" })],
    });
    expect(() => schema.loadCreators()).toThrow(/kebab-case/);
  });

  it("rejects a handle without the leading @", async () => {
    const schema = await loadWithFixture({
      capturedAt: "2026-08-09",
      creators: [minimalCreator({ handle: "SomeChannel" })],
    });
    expect(() => schema.loadCreators()).toThrow(/must start with "@"/);
  });

  it("rejects a channelUrl that is not an absolute youtube.com URL", async () => {
    const schema = await loadWithFixture({
      capturedAt: "2026-08-09",
      creators: [minimalCreator({ channelUrl: "https://example.com/@SomeChannel" })],
    });
    expect(() => schema.loadCreators()).toThrow(/youtube\.com/);
  });

  it("rejects a creator with an empty videos array", async () => {
    const schema = await loadWithFixture({
      capturedAt: "2026-08-09",
      creators: [minimalCreator({ videos: [] })],
    });
    expect(() => schema.loadCreators()).toThrow(/non-empty/);
  });

  it("rejects a malformed youtubeId", async () => {
    const schema = await loadWithFixture({
      capturedAt: "2026-08-09",
      creators: [minimalCreator({ videos: [minimalCreatorVideo({ youtubeId: "not-a-yt-id!" })] })],
    });
    expect(() => schema.loadCreators()).toThrow(/youtubeId/);
  });

  it("rejects a publishedAt that is not a date-only ISO string", async () => {
    const schema = await loadWithFixture({
      capturedAt: "2026-08-09",
      creators: [
        minimalCreator({ videos: [minimalCreatorVideo({ publishedAt: "20 July 2026" })] }),
      ],
    });
    expect(() => schema.loadCreators()).toThrow(/publishedAt/);
  });

  it("rejects a non-positive duration", async () => {
    const schema = await loadWithFixture({
      capturedAt: "2026-08-09",
      creators: [minimalCreator({ videos: [minimalCreatorVideo({ duration: 0 })] })],
    });
    expect(() => schema.loadCreators()).toThrow(/duration/);
  });

  it("rejects an unknown orientation or thumb variant", async () => {
    const badOrientation = await loadWithFixture({
      capturedAt: "2026-08-09",
      creators: [minimalCreator({ videos: [minimalCreatorVideo({ orientation: "square" })] })],
    });
    expect(() => badOrientation.loadCreators()).toThrow(/orientation/);

    const badThumb = await loadWithFixture({
      capturedAt: "2026-08-09",
      creators: [minimalCreator({ videos: [minimalCreatorVideo({ thumb: "maxres" })] })],
    });
    expect(() => badThumb.loadCreators()).toThrow(/thumb/);
  });

  it("rejects duplicate creator ids and duplicate youtubeIds across creators", async () => {
    const dupCreator = await loadWithFixture({
      capturedAt: "2026-08-09",
      creators: [minimalCreator(), minimalCreator()],
    });
    expect(() => dupCreator.loadCreators()).toThrow(/duplicate creator id/);

    const dupVideo = await loadWithFixture({
      capturedAt: "2026-08-09",
      creators: [
        minimalCreator(),
        minimalCreator({ id: "other-channel" }),
      ],
    });
    expect(() => dupVideo.loadCreators()).toThrow(/duplicate youtubeId/);
  });

  it("rejects an avatar outside the committed /coverage/ tree, accepts none at all", async () => {
    const hotlinked = await loadWithFixture({
      capturedAt: "2026-08-09",
      creators: [
        minimalCreator({ avatar: "https://yt3.googleusercontent.com/abc=s176" }),
      ],
    });
    expect(() => hotlinked.loadCreators()).toThrow(/\/coverage\//);

    const absent = await loadWithFixture({
      capturedAt: "2026-08-09",
      creators: [minimalCreator()],
    });
    expect(absent.loadCreators().creators[0].avatar).toBeUndefined();
  });

  it("rejects literal TODO placeholder strings", async () => {
    const schema = await loadWithFixture({
      capturedAt: "2026-08-09",
      creators: [minimalCreator({ blurb: "TODO" })],
    });
    expect(() => schema.loadCreators()).toThrow(/TODO/);
  });
});
