---
name: deploy
description: Use when deploying the 10082026.com site, onboarding a new contributor, running or debugging the test suite, verifying a staging or production deploy, or rolling back a bad production deploy.
---

# Deploy

Deploys are driven entirely by GitHub Actions (`.github/workflows/deploy.yml`), not by hand:
PR against `main` → auto-deploy to staging → merge to `main` → auto-deploy to production.

## 1. First-time contributor setup

- `npm i`
- `lefthook install` — one-time, activates the `gitleaks protect --staged` pre-commit hook
- Install `gitleaks` separately (`brew install gitleaks`; it's a Go binary, not an npm package)
- `gh auth login` — needed to open PRs
- `wrangler login` — only needed for local commands below (`d1 execute`, `tail`); CI does not use your local login

Never run `wrangler deploy` (no `--env`) as your normal workflow — that deploys straight to production, outside CI, and skips the D1 migration step CI runs for you.

## 2. One-time repo/infra setup (NOT DONE YET for this fork)

This site was forked from 20072026.com; none of its Cloudflare resources exist yet. Every `database_id` in `wrangler.jsonc` is a placeholder (`00000000-…`) until the matching `wrangler d1 create` below is run and the real id pasted in.

- [ ] Register/own the `10082026.com` zone on the Cloudflare account
- [ ] `wrangler d1 create redsoil-takedowns` → `database_id` into `wrangler.jsonc`'s top-level `d1_databases[0]`
- [ ] `wrangler d1 create redsoil-takedowns-staging` → `database_id` into `env.staging.d1_databases[0]`
- [ ] `wrangler d1 create redsoil-video-submissions` / `wrangler d1 create redsoil-video-submissions-staging` → ids into `wrangler.jsonc`
- [ ] `wrangler d1 create redsoil-likes` / `wrangler d1 create redsoil-likes-staging` → ids into `wrangler.jsonc`
- [ ] `wrangler d1 migrations apply <each of the six> --remote` (staging ones with `--env staging`) once by hand so manual testing has schema immediately; CI re-runs this on every deploy (no-op until a new migration file lands)
- [ ] `wrangler r2 bucket create redsoil-uploads` (production, private — no custom domain)
- [ ] `wrangler r2 bucket create redsoil-uploads-staging` (staging, private)
- [ ] `wrangler r2 bucket create redsoil-media` (public reference media, shared by staging + production) and bind it to the custom domain `media.10082026.com` in the dashboard (R2 → redsoil-media → Settings → Custom Domains)
- [ ] All six real `database_id`s added to `.gitleaks.toml`'s allowlist regexes (replace the placeholder regex)
- [ ] Two Cloudflare API tokens created (dashboard → My Profile → API Tokens): a staging token and a production token, **both** needing Account D1:Edit, Account Workers Scripts:Edit, Account Workers R2 Storage:Edit, Zone Workers Routes:Edit and Zone:Read on `10082026.com` — staging needs the zone permissions too because `staging.10082026.com` is a real custom-domain route on that zone (see note below on why it's not a workers.dev URL). R2 Storage:Edit is required or `wrangler deploy` fails to bind the `UPLOADS` bucket — the parent archive hit exactly this.
- [ ] GitHub Environments `staging` / `production` created; `CLOUDFLARE_API_TOKEN` set as a secret in each
- [ ] Repo-level Actions variable `CLOUDFLARE_ACCOUNT_ID` set
- [x] `.github/workflows/deploy.yml` present (inherited from the fork, names already updated)

**Why staging is `staging.10082026.com` and not a `*.workers.dev` URL:** this Cloudflare account has never registered a workers.dev subdomain — that was deliberately skipped when the parent site was first set up, since it's a one-time, permanent, account-wide registration. Staging deliberately doesn't trigger it either; it uses a second custom-domain route on the zone you already own instead.

If any unchecked item is still open, CI will fail on `deploy-staging`/`deploy-production` with an auth or missing-var error — finish those before relying on this flow.

## 3. Day-to-day flow

1. Branch off `main`, make changes, commit (pre-commit hook runs gitleaks automatically; pre-push runs `npm run test:unit`)
2. Run `npm test` locally before pushing if you touched `src/worker.ts`, `src/lib/schema.ts`, or any page — this is exactly what CI's `test` job runs
3. `git push`, `gh pr create` targeting `main`
4. CI runs `build` and `test` (unit + integration + e2e) in parallel; `deploy-staging` only starts once **both** succeed, and deploys to `redsoil-staging`; check the PR for a "Staging deploy ready" comment with the preview URL
5. Verify on staging (commands below) — including that a test takedown submission lands in `redsoil-takedowns-staging`, and a test video submission (link or upload) lands in `redsoil-video-submissions-staging` / `redsoil-uploads-staging` — **never** the production table/bucket
6. Merge the PR
7. CI re-runs `build` + `test`, then `deploy-production` deploys automatically; verify prod the same way

If `deploy-staging`/`deploy-production` didn't run at all, check the `test` job first — a failing test blocks both deploys by design (see §6 Testing below).

## 4. Verification commands

```sh
# OG tags
curl -s https://staging.10082026.com/ | grep -i 'og:'   # or https://10082026.com/ for prod

# D1 rows (staging)
npx wrangler d1 execute redsoil-takedowns-staging --env staging --remote \
  --command "select * from takedown_requests order by id desc limit 5"

# D1 rows (production)
npx wrangler d1 execute redsoil-takedowns --remote \
  --command "select * from takedown_requests order by id desc limit 5"

# Video submissions (staging / production) — or use the friendlier
# `node scripts/admin-requests.mjs list --type video [--env staging]`
npx wrangler d1 execute redsoil-video-submissions-staging --env staging --remote \
  --command "select * from video_submissions order by id desc limit 5"
npx wrangler d1 execute redsoil-video-submissions --remote \
  --command "select * from video_submissions order by id desc limit 5"

# Live logs
npx wrangler tail redsoil-staging   # or: npx wrangler tail redsoil
```

`scripts/admin-requests.mjs` wraps the `d1 execute`/`r2 object get` commands above for day-to-day triage of both inboxes (list/export, update status, download an approved raw upload) — see its header comment for full usage. It authenticates via the same local `wrangler login` session as everything else here; it never touches a token or password.

## 5. Rollback

- Fast path: `npx wrangler rollback --name redsoil` (or `--name redsoil-staging`) — reverts to the previously deployed version without a rebuild
- Otherwise: revert the bad commit on `main` and push — CI redeploys automatically
- D1 has no down-migrations here — fix a bad migration forward with a new migration file, don't try to undo one

## 6. Testing

Three layers — `npm test` runs all of them, same as CI's `test` job:

- `npm run test:unit` — Vitest, pure logic (`src/lib/schema.ts` content validation). Also the pre-push hook.
- `npm run test:integration` — Vitest + `@cloudflare/vitest-pool-workers`; runs `src/worker.ts` in a real local Workers runtime against local D1/R2. Covers `/api/takedown`, `/api/submit-video`, `/api/upload/:id`.
- `npm run test:e2e` — Playwright against `wrangler dev` (not `astro preview` — preview can't serve the API routes). Covers the feed, video pages, timeline, and the takedown form actually submitting, in a real browser. Video-dependent specs skip themselves while `videos.json` is empty.

First time only: `npx playwright install --with-deps chromium`.

A failing test on any layer blocks both `deploy-staging` and `deploy-production` (`needs: [build, test]` in the workflow) — this is the mechanism that keeps a regression from ever reaching either environment.

## 7. Gotchas (full detail in `docs/content-pipeline.md`)

- Build validation rejects any content entry still containing a literal `TODO` field
- `scripts/collect.mjs` pushes compressed media straight to the `redsoil-media` R2 bucket itself — if a video 404s / black-screens on staging or prod, check `media.10082026.com/videos/<id>.mp4` directly first (missing R2 object, not a player bug)
- The `redsoil-media` R2 bucket is intentionally shared between staging and production (read-only reference content) — don't duplicate it
- gitleaks blocks commits with secret-shaped strings; non-secret Cloudflare resource IDs (like D1 `database_id`s) go in `.gitleaks.toml`'s allowlist rather than disabling the hook
