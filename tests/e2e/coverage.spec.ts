import { expect, test } from "@playwright/test";

test("coverage page renders creator sections with rails of YouTube links", async ({ page }) => {
  await page.goto("/coverage/");
  await expect(page.locator("h1")).toHaveText("Coverage");

  // At least one full creator section plus the mixed rail.
  const rails = page.locator("[data-rail]");
  expect(await rails.count()).toBeGreaterThan(1);

  // Every card is an off-site link straight to the video on YouTube, opening
  // in a new tab — this page archives nothing.
  const cards = page.locator("a.cov-card");
  expect(await cards.count()).toBeGreaterThan(0);
  const first = cards.first();
  await expect(first).toHaveAttribute("href", /^https:\/\/www\.youtube\.com\/watch\?v=[A-Za-z0-9_-]{11}$/);
  await expect(first).toHaveAttribute("target", "_blank");
  await expect(first).toHaveAttribute("rel", /noopener/);

  // Thumbnails come from i.ytimg.com (allowed by the CSP img-src).
  await expect(first.locator("img")).toHaveAttribute(
    "src",
    /^https:\/\/i\.ytimg\.com\/vi\/[A-Za-z0-9_-]{11}\/(hq720|hqdefault|oar2)\.jpg$/,
  );
});

test("coverage page is reachable from the app nav", async ({ page }) => {
  await page.goto("/about/");
  await page.getByLabel("Coverage").click();
  await expect(page).toHaveURL(/\/coverage\/?$/);
  await expect(page.locator("h1")).toHaveText("Coverage");
});

test("channel index chips anchor to their creator sections", async ({ page }) => {
  await page.goto("/coverage/");
  const chips = page.locator(".cov-index a[href^='#']");
  expect(await chips.count()).toBeGreaterThan(1);

  const target = await chips.first().getAttribute("href");
  await chips.first().click();
  await expect(page.locator(target!)).toBeInViewport();
});
