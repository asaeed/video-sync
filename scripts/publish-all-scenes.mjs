// Publish the playable catalog plus saved custom projects through Scene Studio.
// Run without --publish to review the plan. Browser-only unsaved drafts are not
// included; the Studio UI loads the server-saved version when one exists.
import { chromium, expect } from "@playwright/test";
import { SCENE_CATALOG } from "../poc/scene-catalog.mjs";

const baseUrl = process.env.VIDEO_SYNC_URL ?? "http://127.0.0.1:4316";
const response = await fetch(`${baseUrl}/api/studio/projects`);
if (!response.ok) throw new Error(`Could not list saved projects: ${response.status}`);
const savedProjects = await response.json();
const savedById = new Map(savedProjects.map((project) => [project.id, project]));
const catalogIds = new Set(SCENE_CATALOG.map((scene) => scene.id));
const targets = [
  ...SCENE_CATALOG.filter((scene) => scene.availability === "ready")
    .map((scene) => ({ id: scene.id, name: savedById.get(scene.id)?.name ?? scene.name, source: savedById.has(scene.id) ? "saved" : "catalog" })),
  ...savedProjects.filter((project) => !catalogIds.has(project.id))
    .map((project) => ({ id: project.id, name: project.name, source: "saved custom" })),
];
console.log(`${targets.length} publishable scenes (${SCENE_CATALOG.filter((scene) => scene.availability === "ready").length} playable catalog, ${targets.length - SCENE_CATALOG.filter((scene) => scene.availability === "ready").length} saved custom):`);
for (const target of targets) console.log(`  ${target.id} — ${target.name} [${target.source}]`);
if (!process.argv.includes("--publish")) {
  console.log("Dry run only. Pass --publish to save and publish these scenes.");
  process.exit(0);
}

const browser = await chromium.launch({ channel: "chrome", headless: true });
const context = await browser.newContext();
const page = await context.newPage();
const published = [];
try {
  for (const target of targets) {
    await page.goto(`${baseUrl}/studio/?scene=${encodeURIComponent(target.id)}`);
    await expect(page.getByRole("textbox", { name: "Scene title" })).toHaveValue(target.name, { timeout: 15_000 });
    const metadata = await page.locator(".status-metadata").textContent();
    if (/\b0 clips\b/.test(metadata ?? "")) throw new Error(`${target.id} has no clips; refusing to publish`);
    await page.getByRole("button", { name: "Publish" }).click();
    await expect(page.locator(".status-bar")).toContainText("Published for Live Console", { timeout: 180_000 });
    published.push(target.id);
    console.log(`Published ${target.id} (${metadata?.trim() ?? "unknown media"})`);
  }
} finally {
  await browser.close();
}

const publishedResponse = await fetch(`${baseUrl}/api/studio/published`, { cache: "no-store" });
if (!publishedResponse.ok) throw new Error(`Could not verify publications: ${publishedResponse.status}`);
const liveIds = new Set((await publishedResponse.json()).map((scene) => scene.id));
const missing = published.filter((id) => !liveIds.has(id));
if (missing.length) throw new Error(`Player publication list is missing: ${missing.join(", ")}`);
console.log(`Verified ${published.length} scenes in the player publication list.`);
