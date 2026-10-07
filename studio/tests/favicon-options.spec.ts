import { expect, test } from "@playwright/test";

test("Live Console and Scene Studio share one favicon shape in different colors", async ({ page }) => {
  await page.goto("/poc/");
  const liveHref = await page.locator('link[rel="icon"]').getAttribute("href");
  await page.goto("/studio/");
  const studioHref = await page.locator('link[rel="icon"]').getAttribute("href");
  expect(liveHref).toBeTruthy();
  expect(studioHref).toBeTruthy();
  const liveSvg = decodeURIComponent(liveHref!.split(",")[1]);
  const studioSvg = decodeURIComponent(studioHref!.split(",")[1]);
  expect(liveSvg).toContain("#f4b66a");
  expect(studioSvg).toContain("#9bd9e8");
  expect(liveSvg).toContain("M14 20h2M14 29h2M14 38h2");
  expect(liveSvg.replaceAll("#f4b66a", "#accent")).toBe(studioSvg.replaceAll("#9bd9e8", "#accent"));
});

test("favicon gallery shows ten concepts in both app colors and at tab size", async ({ page }) => {
  await page.goto("/docs/favicon-options.html");
  await expect(page.locator("#options article")).toHaveCount(10);
  await expect(page.locator("#options .variant.live")).toHaveCount(10);
  await expect(page.locator("#options .variant.studio")).toHaveCount(10);
  await expect(page.locator("#options .mini")).toHaveCount(20);
  await expect(page.locator("#options .current")).toHaveCount(0);
  const iconBounds = await page.locator("#options .icon use").evaluateAll((elements) => elements.map((element) => (element as SVGGraphicsElement).getBBox().width));
  expect(iconBounds.every((width) => width > 0)).toBe(true);
});

test("second favicon gallery marks Film window as the current paired icon", async ({ page }) => {
  await page.goto("/docs/favicon-options.html?round=2");
  await expect(page.locator("#options article")).toHaveCount(10);
  await expect(page.locator("#options .number").first()).toHaveText("11");
  await expect(page.locator("#options .number").last()).toHaveText("20");
  await expect(page.locator("#options .variant.live")).toHaveCount(10);
  await expect(page.locator("#options .variant.studio")).toHaveCount(10);
  await expect(page.locator("#options .current")).toHaveCount(1);
  await expect(page.locator("#options article").nth(5).locator(".current")).toHaveText("In use");
  const iconBounds = await page.locator("#options .icon use").evaluateAll((elements) => elements.map((element) => (element as SVGGraphicsElement).getBBox().width));
  expect(iconBounds.every((width) => width > 0)).toBe(true);
});
