import { readFile } from "node:fs/promises";
import { gunzipSync } from "node:zlib";
import { expect, test } from "@playwright/test";

test("records visual decisions and replays projector visuals without the bridge", async ({ page, context }) => {
  await page.goto("/poc/");
  const output = await context.newPage();
  await output.goto("/poc/output.html");
  await page.locator("#session-record").click();
  await expect(page.locator("#session-record")).toHaveText("● Recording");
  await page.getByRole("button", { name: "Load deck 1" }).click();
  await page.getByRole("button", { name: "Play deck 1" }).click();
  await page.locator("[data-cue-deck='1'][data-cue='0']").click();
  await page.waitForTimeout(150);
  const downloadPromise = page.waitForEvent("download");
  await page.locator("#session-stop").click();
  const download = await downloadPromise;
  const path = await download.path();
  expect(path).not.toBeNull();
  const bytes = await readFile(path!);
  const session = JSON.parse((download.suggestedFilename().endsWith(".gz") ? gunzipSync(bytes) : bytes).toString());
  expect(session.format).toBe("video-sync-session");
  expect(session.scenes.map((scene: { id: string }) => scene.id)).toContain("metropolis-machine");
  expect(session.events.filter((event: { type: string }) => event.type === "snapshot").length).toBeGreaterThan(1);
  expect(session.events.some((event: { type: string; value?: { decks?: Array<{ activeCueInput?: string }> } }) => event.type === "snapshot" && event.value?.decks?.[0]?.activeCueInput === "hotCueA")).toBe(true);

  await page.locator("#session-file").setInputFiles({ name: download.suggestedFilename(), mimeType: "application/gzip", buffer: bytes });
  await expect(page.locator("body")).toHaveClass(/is-session-replaying/);
  await expect(output.locator(".deck-visual-1 video.is-visible")).toHaveCount(1);
  await page.locator("#session-stop").click();
  await expect(page.locator("body")).not.toHaveClass(/is-session-replaying/);
});

test("Studio exposes one-file scene import and export beside Save and Publish", async ({ page }) => {
  await page.goto("/studio/");
  await page.locator(".scene-file-menu summary").click();
  await expect(page.getByText("Import scene", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Export scene" })).toBeVisible();
  await page.getByRole("button", { name: /Loop Builder/ }).click();
  await expect(page.locator(".loop-preview video[data-node-key]").first()).toBeAttached();
});
