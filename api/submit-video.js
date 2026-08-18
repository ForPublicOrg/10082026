// Vercel serverless function backing the landing page's "Submit a video"
// form on Vercel deployments (same /api/submit-video path the Cloudflare
// Worker owns on Cloudflare deployments — the client needs no routing
// changes; whichever platform serves the site also serves its form).
//
// Link-mode submissions are appended as a commit to a single rolling
// "incoming-submissions" branch and surfaced through ONE open pull request
// (created on first use, reset from main after each merge) — never one PR
// per submission, which would hand an unauthenticated endpoint the power to
// spam the repo. The row lands in the same master collection CSV that
// scripts/collect-batch.mjs consumes, so merging the PR feeds the normal
// pipeline.
//
// PRIVACY CONTRACT (do not weaken): pull requests are public. The optional
// `contact` field is deliberately DROPPED here — this deployment has no
// private inbox to store it in (that is the Cloudflare Worker + D1 path),
// and a submitter's email/handle must never appear in a public PR. Raw
// uploads are likewise unavailable here (they need the Worker's R2 flow).
//
// Setup: create a fine-grained GitHub PAT scoped to ONLY this repository
// with Contents:Read+Write and Pull requests:Read+Write, and set it as the
// GITHUB_TOKEN environment variable in the Vercel project. Without it, this
// endpoint declines submissions rather than half-working.

const REPO = process.env.GITHUB_REPO || "ForPublicOrg/10082026";
const QUEUE_BRANCH = process.env.SUBMISSIONS_BRANCH || "incoming-submissions";
const CSV_PATH = "10082026 - Sheet1.csv";

// Mirror the Worker's field caps (src/worker.ts) — same public form, same
// hostile-input assumptions.
const MAX_URL = 2000;
const MAX_DESCRIPTION = 2000;
const MAX_SHORT_FIELD = 300;
// Backstop against queue flooding between maintainer merges: once the
// rolling branch holds this many un-merged rows, stop accepting more.
const MAX_PENDING_ROWS = 200;

const GITHUB_API = "https://api.github.com";

function ghHeaders(token) {
  return {
    authorization: `Bearer ${token}`,
    accept: "application/vnd.github+json",
    "x-github-api-version": "2022-11-28",
    "user-agent": "redsoil-submission-queue",
    "content-type": "application/json",
  };
}

async function gh(token, method, path, body) {
  const res = await fetch(`${GITHUB_API}${path}`, {
    method,
    headers: ghHeaders(token),
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  const json = text ? JSON.parse(text) : null;
  return { status: res.status, json };
}

function clean(value, max) {
  if (typeof value !== "string") return "";
  // Strip control characters (except newline/tab), same as the Worker.
  return value
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "")
    .trim()
    .slice(0, max);
}

// Quote a CSV field only when it needs it (commas, quotes, newlines), same
// dialect scripts/collect-batch.mjs's parser reads back.
export function csvField(value) {
  const flat = value.replace(/\r?\n/g, " ");
  if (/[",]/.test(flat)) return `"${flat.replace(/"/g, '""')}"`;
  return flat;
}

/**
 * Appends one submission row (Link,Status,VideoId,Notes — Status/VideoId
 * blank so collect-batch treats it as never-attempted) to the CSV text.
 * Pure so tests can cover the row shape, dedupe, and the pending cap
 * without touching the network. NOTE: `contact` is not a parameter on
 * purpose — see the privacy contract at the top of this file.
 */
export function appendSubmissionRow(csvText, { url, eventDate, description, submittedOn }) {
  const lines = csvText.split(/\r?\n/).filter((line) => line.trim() !== "");
  if (lines.some((line) => line.split(",")[0].trim() === url)) {
    return { duplicate: true, csv: csvText, pending: 0 };
  }
  // Rows beyond the header whose Status column is blank = still pending.
  const pending = lines.slice(1).filter((line) => {
    const cols = line.split(",");
    return (cols[1] ?? "").trim() === "";
  }).length;

  const noteParts = [`web submission ${submittedOn}`];
  if (eventDate) noteParts.push(`event date: ${eventDate}`);
  if (description) noteParts.push(description);
  const note = noteParts.join("; ").slice(0, 400);

  const row = `${csvField(url)},,,${csvField(note)}`;
  const csv = `${lines.join("\n")}\n${row}\n`;
  return { duplicate: false, csv, pending };
}

function send(res, status, body) {
  res.status(status).setHeader("cache-control", "no-store").json(body);
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return send(res, 405, { ok: false, error: "Method not allowed." });
  }

  // Same-origin guard, same caveat as the Worker's: not a security boundary
  // (Origin is forgeable outside a browser), but it stops the endpoint being
  // trivially posted to from another site's page using a visitor's browser.
  const origin = req.headers.origin;
  if (origin && req.headers.host) {
    try {
      if (new URL(origin).host !== req.headers.host) {
        return send(res, 403, { ok: false, error: "Cross-origin requests are not accepted." });
      }
    } catch {
      return send(res, 403, { ok: false, error: "Cross-origin requests are not accepted." });
    }
  }

  let payload = req.body;
  if (typeof payload === "string") {
    try {
      payload = JSON.parse(payload);
    } catch {
      return send(res, 400, { ok: false, error: "Could not read the submitted form." });
    }
  }
  if (!payload || typeof payload !== "object") {
    return send(res, 400, { ok: false, error: "Could not read the submitted form." });
  }

  // Honeypot: return a normal-looking success so a bot doesn't learn to adapt.
  if (clean(payload.website, 50) !== "") {
    return send(res, 200, { ok: true });
  }

  const mode = clean(payload.mode, 10).toLowerCase();
  if (mode === "upload") {
    return send(res, 400, {
      ok: false,
      error:
        "Raw uploads aren't available on this deployment. Please post the footage anywhere public and share the link instead.",
    });
  }
  if (mode !== "url") {
    return send(res, 400, { ok: false, error: "Unrecognized submission mode." });
  }

  const url = clean(payload.url, MAX_URL);
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return send(res, 400, { ok: false, error: "Please enter a valid URL." });
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return send(res, 400, { ok: false, error: "Please enter a valid URL." });
  }

  const eventDate = clean(payload.eventDate, 40);
  const description = clean(payload.description, MAX_DESCRIPTION);
  // payload.contact is intentionally never read — see the privacy contract.

  const token = process.env.GITHUB_TOKEN;
  if (!token) {
    console.error("submit-video: GITHUB_TOKEN is not configured");
    return send(res, 503, {
      ok: false,
      error: "Submissions are temporarily unavailable. Please try again later.",
    });
  }

  try {
    // Default branch head — the queue branch is created from (or reset to)
    // this whenever no open queue PR exists, so a merged/closed PR never
    // leaves the next submission appending to a stale branch.
    const repoInfo = await gh(token, "GET", `/repos/${REPO}`);
    if (repoInfo.status !== 200) throw new Error(`repo lookup failed: ${repoInfo.status}`);
    const baseBranch = repoInfo.json.default_branch;
    const baseRef = await gh(token, "GET", `/repos/${REPO}/git/ref/${encodeURIComponent(`heads/${baseBranch}`)}`);
    if (baseRef.status !== 200) throw new Error(`base ref lookup failed: ${baseRef.status}`);
    const baseSha = baseRef.json.object.sha;

    const openPr = await gh(
      token,
      "GET",
      `/repos/${REPO}/pulls?state=open&head=${encodeURIComponent(`${REPO.split("/")[0]}:${QUEUE_BRANCH}`)}`,
    );
    const existingPr = openPr.status === 200 && openPr.json.length > 0 ? openPr.json[0] : null;

    const queueRef = await gh(token, "GET", `/repos/${REPO}/git/ref/${encodeURIComponent(`heads/${QUEUE_BRANCH}`)}`);
    if (queueRef.status === 404) {
      const created = await gh(token, "POST", `/repos/${REPO}/git/refs`, {
        ref: `refs/heads/${QUEUE_BRANCH}`,
        sha: baseSha,
      });
      if (created.status !== 201) throw new Error(`branch create failed: ${created.status}`);
    } else if (!existingPr) {
      // Branch exists but its PR was merged/closed — start the next queue
      // from the current default-branch head.
      const reset = await gh(token, "PATCH", `/repos/${REPO}/git/refs/${encodeURIComponent(`heads/${QUEUE_BRANCH}`)}`, {
        sha: baseSha,
        force: true,
      });
      if (reset.status !== 200) throw new Error(`branch reset failed: ${reset.status}`);
    }

    // Append the row, retrying on concurrent-submission sha conflicts.
    const csvApiPath = `/repos/${REPO}/contents/${encodeURIComponent(CSV_PATH)}`;
    const submittedOn = new Date().toISOString().slice(0, 10);
    let prUrl = existingPr ? existingPr.html_url : null;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const file = await gh(token, "GET", `${csvApiPath}?ref=${encodeURIComponent(QUEUE_BRANCH)}`);
      if (file.status !== 200) throw new Error(`csv fetch failed: ${file.status}`);
      const currentCsv = Buffer.from(file.json.content, "base64").toString("utf8");

      const { duplicate, csv, pending } = appendSubmissionRow(currentCsv, {
        url,
        eventDate,
        description,
        submittedOn,
      });
      if (duplicate) {
        // Already queued (or already archived): the submitter's goal is met.
        return send(res, 200, { ok: true, prUrl: prUrl ?? undefined });
      }
      if (pending >= MAX_PENDING_ROWS) {
        return send(res, 429, {
          ok: false,
          error: "The submission queue is at capacity right now. Please try again later.",
        });
      }

      const put = await gh(token, "PUT", csvApiPath, {
        message: `Queue video submission: ${parsed.hostname}`,
        content: Buffer.from(csv, "utf8").toString("base64"),
        sha: file.json.sha,
        branch: QUEUE_BRANCH,
      });
      if (put.status === 200 || put.status === 201) break;
      if (put.status === 409 && attempt < 2) continue; // concurrent append — refetch and retry
      throw new Error(`csv update failed: ${put.status}`);
    }

    if (!existingPr) {
      const pr = await gh(token, "POST", `/repos/${REPO}/pulls`, {
        title: "Incoming video submissions",
        head: QUEUE_BRANCH,
        base: baseBranch,
        body: [
          "Public submission queue, appended automatically by the landing page's",
          "\"Submit a video\" form (api/submit-video.js). Each row lands in",
          "`10082026 - Sheet1.csv` with Status left blank for the next",
          "`scripts/collect-batch.mjs` run after this merges.",
          "",
          "Contact details are never included in these rows by design —",
          "pull requests are public.",
        ].join("\n"),
      });
      if (pr.status !== 201) throw new Error(`pr create failed: ${pr.status}`);
      prUrl = pr.json.html_url;
    }

    return send(res, 200, { ok: true, prUrl: prUrl ?? undefined });
  } catch (error) {
    console.error("submit-video: queue update failed", error);
    return send(res, 500, {
      ok: false,
      error: "Something went wrong saving that. Please try again.",
    });
  }
}
