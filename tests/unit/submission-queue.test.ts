import { describe, expect, it } from "vitest";
// The Vercel function exports its pure CSV helpers precisely so the row
// shape, dedupe, and pending-cap logic are testable without the network.
import { appendSubmissionRow, csvField } from "../../api/submit-video.js";

const HEADER = "Link,Status,VideoId,Notes\n";

describe("csvField", () => {
  it("passes plain values through untouched", () => {
    expect(csvField("https://example.com/post/1")).toBe("https://example.com/post/1");
  });

  it("quotes fields containing commas and escapes embedded quotes", () => {
    expect(csvField('water cannon, "dancing" crowd')).toBe('"water cannon, ""dancing"" crowd"');
  });

  it("flattens newlines so a description can never break the row structure", () => {
    expect(csvField("line one\nline two")).toBe("line one line two");
  });
});

describe("appendSubmissionRow", () => {
  it("appends a pipeline-ready row: Status and VideoId blank, note carries date and description", () => {
    const { csv, duplicate } = appendSubmissionRow(HEADER, {
      url: "https://www.instagram.com/reel/abc123/",
      eventDate: "2026-08-10",
      description: "march footage",
      submittedOn: "2026-08-18",
    });
    expect(duplicate).toBe(false);
    expect(csv).toBe(
      HEADER +
        "https://www.instagram.com/reel/abc123/,,,web submission 2026-08-18; event date: 2026-08-10; march footage\n",
    );
  });

  it("quotes the note when the description contains commas", () => {
    const { csv } = appendSubmissionRow(HEADER, {
      url: "https://x.com/a/status/1",
      eventDate: "",
      description: "barricades, water cannon",
      submittedOn: "2026-08-18",
    });
    expect(csv).toContain('"web submission 2026-08-18; barricades, water cannon"');
  });

  it("reports a duplicate instead of appending the same link twice", () => {
    const first = appendSubmissionRow(HEADER, {
      url: "https://x.com/a/status/1",
      eventDate: "",
      description: "",
      submittedOn: "2026-08-18",
    });
    const second = appendSubmissionRow(first.csv, {
      url: "https://x.com/a/status/1",
      eventDate: "",
      description: "different note",
      submittedOn: "2026-08-18",
    });
    expect(second.duplicate).toBe(true);
    expect(second.csv).toBe(first.csv);
  });

  it("counts only blank-Status rows as pending (published/ignored rows don't clog the cap)", () => {
    const csvText =
      HEADER +
      "https://x.com/a/status/1,published,video-001,\n" +
      "https://x.com/a/status/2,ignored,,\n" +
      "https://x.com/a/status/3,,,queued\n";
    const { pending } = appendSubmissionRow(csvText, {
      url: "https://x.com/a/status/4",
      eventDate: "",
      description: "",
      submittedOn: "2026-08-18",
    });
    expect(pending).toBe(1);
  });

  it("caps the note length", () => {
    const { csv } = appendSubmissionRow(HEADER, {
      url: "https://x.com/a/status/9",
      eventDate: "",
      description: "x".repeat(2000),
      submittedOn: "2026-08-18",
    });
    const note = csv.trim().split("\n").pop() ?? "";
    expect(note.length).toBeLessThanOrEqual("https://x.com/a/status/9,,,".length + 402);
  });
});
