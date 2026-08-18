import { defineConfig, devices } from "@playwright/test";

const PORT = 8788;
const BASE_URL = `http://localhost:${PORT}`;

// E2E tests run against `wrangler dev`, not `astro preview` — preview only
// serves the static build and can't handle the /api/takedown and
// /api/submit-video routes (src/worker.ts), or Range requests the way a real
// deploy does. `wrangler dev` runs the actual Worker + static assets
// together, locally, which is the closest thing to production available
// without deploying.
export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: true,
  // One worker, deliberately: both browser projects share a single local D1
  // through one `wrangler dev`, and the like-feature tests assert exact
  // counts. The parent archive got away with parallel projects because with
  // 187 videos two workers almost never landed on the same shuffled "first
  // card"; this archive is small (9 videos at fork time), so cross-project
  // like collisions were reproducible. Serializing workers removes the race
  // without weakening the assertions.
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["github"], ["list"]] : "list",
  use: {
    baseURL: BASE_URL,
    trace: "on-first-retry",
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    // Chromium-based mobile emulation rather than WebKit/iOS — this site is
    // heavily used on phones (vertical video feed), so viewport/layout
    // coverage matters more here than a second rendering engine. Keeping
    // everything on one engine also means CI only ever downloads Chromium.
    { name: "mobile-chrome", use: { ...devices["Pixel 7"] } },
  ],
  webServer: {
    command:
      "npm run build && " +
      "npx wrangler d1 migrations apply redsoil-takedowns --local && " +
      "npx wrangler d1 migrations apply redsoil-video-submissions --local && " +
      "npx wrangler d1 migrations apply redsoil-likes --local && " +
      `npx wrangler dev --port ${PORT}`,
    url: BASE_URL,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
