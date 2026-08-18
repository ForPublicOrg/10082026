# Red Soil — Execution Plan

Current status and forward roadmap. For the fixed, already-built architecture, see `design-spec.md`.

## Done

- Full fork from the 20072026.com archive: same Astro static site + narrow Cloudflare Worker architecture, rebranded to `10.08.2026` / `10082026.com` (worker `redsoil`, D1 `redsoil-*`, R2 `redsoil-*`).
- Timeline hand-researched and cited for the 2026 Jharkhand student protests (`src/data/timeline.json`): every event carries at least one source citation from fetched reporting; official statements are verbatim quotes as the cited source printed them.
- Independent-media coverage directory (`/coverage`, `src/data/creators.json`): verified YouTube videos covering the movement, grouped by channel — pointers only, nothing rehosted.
- Corrections/takedown flow inherited end-to-end (`/takedown` → `POST /api/takedown` → D1 `TAKEDOWNS`).
- Public "submit a video" flow inherited end-to-end (home page form → `POST /api/submit-video` + `PUT /api/upload/:id` → D1 `SUBMISSIONS` + R2 `UPLOADS`), with `scripts/admin-requests.mjs` for triage.
- Three-layer test suite (unit/integration/e2e) gating both deploy environments in CI; video-dependent specs skip themselves while the video archive is empty.

## Open

- **Cloudflare resources**: none created yet — D1 databases, R2 buckets, API tokens, GitHub Environments. `.claude/skills/deploy/SKILL.md` §2 is the checklist; every `database_id` in `wrangler.jsonc` is a placeholder until then.
- **Video collection**: `videos.json` is empty. Seed `10082026 - Sheet1.csv` with public post URLs from the movement and run `scripts/collect-batch.mjs` (needs yt-dlp + ffmpeg + the `redsoil-media` bucket). The feed shows an honest empty state until then.
- **Hero artwork**: the landing page uses a typographic poster generated for the fork; commissioning proper artwork (like the parent archive's poster) is open.
- Everything the parent archive still had open: client-side filtering, full-text search (Pagefind), collections, statistics block, WebM renditions, capture-location map, perceptual-hash duplicate detection, Turnstile on the public forms.

## Operating principles

- Static always; build-time over runtime; JSON over databases; minimal JS.
- One maintainer must be able to run everything.
- Never publish an entry without source attribution and a verification status.
