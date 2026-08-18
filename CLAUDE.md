# redsoil (10082026.com)

A protest-documentation archive for the 2026 Jharkhand student protests (the 10 August 2026 march on the Jharkhand Legislative Assembly in Ranchi), forked from the 20072026.com archive: Astro static site + a narrow Cloudflare Worker (`src/worker.ts`) on Cloudflare Workers with static assets. `assets.run_worker_first: true` in `wrangler.jsonc` means every request hits the Worker first (needed so the www redirect below applies regardless of hostname — see the comment there for why). The Worker handles exactly five API routes — `POST /api/takedown`, `POST /api/submit-video`, `PUT /api/upload/:id`, `POST /api/likes/:id` + `DELETE /api/likes/:id` (like/unlike, same path), and `GET /api/likes/batch` (batch like-count hydration for the feed, no params/body, edge-cached 20s) — plus one host-level redirect (`www.10082026.com` → the apex, 301, path/query preserved); everything else is explicitly forwarded to `env.ASSETS.fetch()`. Three D1 databases back these: `TAKEDOWNS` (corrections/takedown requests), `SUBMISSIONS` (public "submit a video" requests, link or raw upload), and `LIKES` (public per-video like counts, keyed by an anonymous client id); one R2 bucket, `UPLOADS`, holds raw uploaded footage pending review. The takedown and submission inboxes are never rendered on the public site; likes are the exception — counts are shown back to visitors on the feed. Reference media (video/thumbnails) is served separately from R2 at `media.10082026.com` (not a Worker binding — its own custom domain). **`10082026.com` is the permanent domain; `www.10082026.com` is a custom_domain route in `wrangler.jsonc` that exists only to be redirected — it has no DNS record otherwise.**

**Fork status:** the D1 `database_id`s in `wrangler.jsonc` are placeholders — the six databases, the two `UPLOADS` buckets, and the public `redsoil-media` bucket do not exist yet. `.claude/skills/deploy/SKILL.md` §2 is the checklist for creating them. `videos.json` is empty until `scripts/collect.mjs` runs against real public posts (the feed shows an honest empty state); `timeline.json` and `creators.json` carry the researched, cited content.

## Reading order

`README.md` → `docs/design-spec.md` → `docs/execution-plan.md` → `docs/content-pipeline.md` → `docs/verification-policy.md`.

## Deploy model

Deploys are CI-driven, not manual:
- Open a PR against `main` → GitHub Actions builds and deploys to an isolated **staging** Worker (`redsoil-staging`) + staging D1 database (`redsoil-takedowns-staging`) at `staging.10082026.com`, and comments the preview URL on the PR.
- Merge to `main` → GitHub Actions deploys **production** (`redsoil`, `redsoil-takedowns`) at `10082026.com`.

Staging is a real custom-domain route (`staging.10082026.com`) on the zone we already own, not a `*.workers.dev` URL — this account has deliberately never registered a workers.dev subdomain (permanent, account-wide once created), and staging isn't meant to be what triggers that.

Do not run `npm run deploy` / `wrangler deploy` against production as the normal path — it bypasses CI, and D1 migrations are applied by the CI pipeline, not by hand. Use `npm run deploy:staging` only for a local one-off smoke test against the staging Worker. Full runbook (first-time setup, day-to-day flow, verification, rollback): **`.claude/skills/deploy/SKILL.md`** — read it before deploying, rolling back, or onboarding a new contributor.

Secrets/config for CI live as GitHub Environment secrets (`CLOUDFLARE_API_TOKEN`, scoped separately per `staging`/`production` environment) and a repo-level Actions variable (`CLOUDFLARE_ACCOUNT_ID`) — never in `.env` files or committed anywhere.

## Local setup

- `npm i`
- `lefthook install` (once) — activates the `gitleaks protect --staged` pre-commit hook and the `npm run test:unit` pre-push hook (`lefthook.yml`, `.gitleaks.toml`)
- `gitleaks` itself isn't an npm package — install separately (e.g. `brew install gitleaks`)
- `npx playwright install --with-deps chromium` (once) — needed for `npm run test:e2e`

## Testing

Three layers, all required to pass in CI before either deploy job runs (see the `test` job in `.github/workflows/deploy.yml`):

- `npm run test:unit` — Vitest, pure logic only (`src/lib/schema.ts`'s content validation). No Cloudflare runtime involved.
- `npm run test:integration` — Vitest + `@cloudflare/vitest-pool-workers`, runs `src/worker.ts` in a real local Workers runtime against real (local, not remote) D1/R2 bindings. Covers the `/api/takedown`, `/api/submit-video`, and `/api/upload/:id` request handling.
- `npm run test:e2e` — Playwright, against `wrangler dev` (not `astro preview` — preview can't serve the API routes or Range requests). Covers real user flows: feed, video pages, timeline, the takedown form actually submitting. Video-dependent specs skip themselves while `videos.json` is empty.
- `npm test` runs all three, in that order — same thing CI does.

Test files live under `tests/unit/`, `tests/integration/`, `tests/e2e/`. Only `test:unit` runs in the pre-push hook; the other two need a build and a browser, so they stay CI-only.

## Content-authoring gotchas (detail in `docs/content-pipeline.md`)

- Build validation rejects any `videos.json`/`timeline.json` entry still containing a literal `TODO` field — fill every field before merging.
- `scripts/collect.mjs` pushes compressed video/thumbnail straight to the `redsoil-media` R2 bucket itself (no manual `wrangler r2 object put` step — the parent archive learned this the hard way when a manually-pushed batch silently 404'd). If you ever see a video show a black screen / 404 on staging or prod, check `media.10082026.com/videos/<id>.mp4` directly first — that's almost always a missing R2 object, not a player bug.
- Every timeline event carries the reporting it is drawn from; every quote is verbatim as the cited source printed it. Never add an event or quote without a checkable source — publishing less beats publishing something unverifiable.
