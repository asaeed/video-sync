import { expect, test, type Page } from "@playwright/test";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { SCENE_CATALOG } from "../../poc/scene-catalog.mjs";
import { catalogProject, migrateLegacyDefaultClipRanges, STUDIO_SCENES } from "../client/src/catalog";
import { compileRuntimeScene, makeEvent } from "../client/src/model";

test("new loop instances and random loops keep the whole video frame in projector output", () => {
  const project = catalogProject("metropolis-machine");
  const loop = project.visualLoops[0];
  const event = makeEvent(project, loop, project.clips[0].id);
  expect(event.appearance.fit).toBe("contain");
  loop.events.push(event);
  const runtime = compileRuntimeScene(project);
  expect(runtime.visualLoops[0].events.at(-1)?.appearance.fit).toBe("contain");
  expect(runtime.randomLoop.fit).toBe("contain");
});

async function useCatalogDefaults(page: Page) {
  await page.route("**/api/studio/projects", (route) => route.fulfill({ json: [] }));
  await page.route(/\/api\/studio\/projects\/[^/]+$/, (route) => route.fulfill({ status: 404, body: "Not saved" }));
}

test("every catalog scene opens as an editable project without missing video references", () => {
  expect(STUDIO_SCENES).toHaveLength(36);
  expect(STUDIO_SCENES.map((scene) => scene.id)).toEqual(SCENE_CATALOG.map((scene) => scene.id));
  for (const definition of SCENE_CATALOG) {
    const project = catalogProject(definition.id);
    expect(project.id).toBe(definition.id);
    expect(project.visualLoops.some((loop) => loop.id === project.defaultLoopId)).toBe(true);
    if (definition.availability === "source-needed") {
      expect(project.sources).toHaveLength(0);
      expect(project.clips).toHaveLength(0);
      expect(project.visualLoops).toHaveLength(1);
      expect(project.visualLoops[0].events).toHaveLength(0);
      continue;
    }
    expect(project.sources).toHaveLength(12);
    expect(project.clips).toHaveLength(12);
    expect(project.visualLoops).toHaveLength(8);
    for (const source of project.sources) {
      expect(source.file).toMatch(/^\/assets\/scenes\/.*\.mp4$/);
      expect(existsSync(join(process.cwd(), `.${source.file}`)), `${definition.id}: ${source.file}`).toBe(true);
    }
    for (const loop of project.visualLoops) {
      expect(loop.events.length).toBeGreaterThan(0);
      for (const event of loop.events) expect(project.clips.some((clip) => clip.id === event.clipId)).toBe(true);
    }
  }
});

async function selectScene(page: Page, id: string) {
  await page.getByRole("button", { name: "Change scene" }).click();
  const dialog = page.getByRole("dialog", { name: "Select scene" });
  await expect(dialog).toBeVisible();
  await dialog.locator(`[data-scene-id="${id}"]`).click();
  await expect(dialog).toHaveCount(0);
}

async function dragDivider(page: Page, name: string, dx: number, dy: number) {
  const divider = page.getByRole("separator", { name });
  const bounds = await divider.boundingBox();
  expect(bounds).not.toBeNull();
  const x = bounds!.x + bounds!.width / 2;
  const y = bounds!.y + bounds!.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await expect.poll(() => page.evaluate(() => document.body.style.cursor)).toBe(dx ? "col-resize" : "row-resize");
  await page.mouse.move(x + dx, y + dy, { steps: 6 });
  await page.mouse.up();
  await expect.poll(() => page.evaluate(() => document.body.style.cursor)).toBe("");
}

test("catalog and legacy default clips span their full source without changing loop media timing", () => {
  for (const id of ["metropolis-machine", "trip-to-the-moon", "nosferatu"]) {
    const project = catalogProject(id);
    for (const clip of project.clips) {
      const source = project.sources.find((item) => item.id === clip.sourceId)!;
      expect(clip.inSeconds).toBe(0);
      expect(clip.outSeconds).toBe(source.durationSeconds);
    }
    if (id !== "nosferatu") continue;
    const legacy = structuredClone(project);
    legacy.clips.forEach((clip, index) => {
      const oldStart = [0, 0.5, 1, 1.5][index % 4];
      clip.inSeconds = oldStart;
      for (const loop of legacy.visualLoops) {
        for (const event of loop.events) {
          if (event.clipId === clip.id) event.source.offsetSeconds -= oldStart;
        }
      }
    });
    const { project: migrated, migrated: changed } = migrateLegacyDefaultClipRanges(legacy);
    expect(changed).toBe(true);
    expect(migrated.clips.map((clip) => clip.inSeconds)).toEqual(project.clips.map((clip) => clip.inSeconds));
    expect(compileRuntimeScene(migrated).visualLoops).toEqual(compileRuntimeScene(project).visualLoops);
    expect(migrateLegacyDefaultClipRanges(migrated).migrated).toBe(false);
  }
});

test("loop order alone assigns A–H; the default is independent and remaining cues fall back to it", () => {
  const project = catalogProject("metropolis-machine");
  const first = project.visualLoops[0];
  const third = project.visualLoops[2];
  project.visualLoops.splice(0, 1);
  project.visualLoops.splice(2, 0, first);
  project.defaultLoopId = third.id;
  project.cueBindings = [{ input: "hotCueA", loopId: first.id, cueType: "jump" }]; // ignored legacy field
  const scene = compileRuntimeScene(project);
  expect(scene.defaultLoopId).toBe(third.id);
  expect(scene.cueBindings.map((binding) => binding.input)).toEqual("ABCDEFGH".split("").map((letter) => `hotCue${letter}`));
  expect(scene.cueBindings.map((binding) => binding.visual.loopId)).toEqual(project.visualLoops.map((loop) => loop.id));
  expect(scene.cueBindings.every((binding) => binding.cue.type === "auto" && binding.visual.retrigger === "cue-trigger")).toBe(true);
  project.visualLoops = project.visualLoops.slice(0, 2);
  expect(compileRuntimeScene(project).cueBindings.slice(2).every((binding) => binding.visual.loopId === third.id)).toBe(true);
});

test("dragging loops remaps hot cues and the default survives refresh", async ({ page }) => {
  await useCatalogDefaults(page);
  await page.route("**/api/studio/projects/metropolis-machine/prepare", (route) => route.fulfill({ json: { media: {}, created: 0, reused: 12, removed: 0, warnings: [] } }));
  await page.goto("/studio/");
  await page.getByRole("button", { name: /Loop Builder/ }).click();
  const cards = page.locator(".loop-list-card");
  await expect(cards).toHaveCount(8);
  const originalFirst = await cards.first().getAttribute("data-loop-id");
  const newDefault = await cards.nth(2).getAttribute("data-loop-id");
  await cards.nth(2).locator(".loop-default-button").click();
  await expect(cards.nth(2).locator(".loop-default-button")).toHaveAttribute("aria-pressed", "true");
  await cards.first().locator(".loop-order-handle").dragTo(cards.nth(2));
  await expect(cards.nth(2)).toHaveAttribute("data-loop-id", originalFirst!);
  await expect(cards.nth(2).locator(".loop-cue-badge")).toHaveText("C");
  await page.reload();
  await expect(page.getByRole("button", { name: /Loop Builder/ })).toHaveClass(/active/);
  await expect(cards.nth(2)).toHaveAttribute("data-loop-id", originalFirst!);
  await expect(cards.locator(".loop-default-button.active")).toHaveCount(1);
  await expect(cards.locator(".loop-default-button.active").locator(".." )).toHaveAttribute("data-loop-id", newDefault!);
});

test("Loop Builder BPM and Bars controls share one compact row", async ({ page }) => {
  await useCatalogDefaults(page);
  await page.route("**/api/studio/projects/metropolis-machine/prepare", (route) => route.fulfill({ json: { media: {}, created: 0, reused: 12, removed: 0, warnings: [] } }));
  await page.goto("/studio/");
  await page.getByRole("button", { name: /Loop Builder/ }).click();
  const header = page.locator(".loop-editor > .panel-heading");
  for (const width of [1600, 1180]) {
    await page.setViewportSize({ width, height: 900 });
    const labels = await header.locator(".inline-fields .field span").all();
    const inputs = await header.locator(".inline-fields input").all();
    expect(labels).toHaveLength(2);
    expect(inputs).toHaveLength(2);
    const labelBoxes = await Promise.all(labels.map((label) => label.boundingBox()));
    const inputBoxes = await Promise.all(inputs.map((input) => input.boundingBox()));
    expect(Math.abs(labelBoxes[0]!.y - labelBoxes[1]!.y)).toBeLessThan(2);
    expect(Math.abs(inputBoxes[0]!.y - inputBoxes[1]!.y)).toBeLessThan(2);
    expect(inputBoxes[0]!.width).toBe(inputBoxes[1]!.width);
    const stepperBoxes = await Promise.all((await header.locator(".number-stepper-controls button").all()).map((button) => button.boundingBox()));
    expect(stepperBoxes).toHaveLength(4);
    for (let index = 0; index < stepperBoxes.length; index++) {
      const inputBox = inputBoxes[Math.floor(index / 2)]!;
      const buttonBox = stepperBoxes[index]!;
      expect(buttonBox.x).toBeGreaterThan(inputBox.x + inputBox.width / 2);
      expect(buttonBox.x + buttonBox.width).toBeLessThanOrEqual(inputBox.x + inputBox.width + 1);
      expect(buttonBox.y).toBeGreaterThanOrEqual(inputBox.y);
      expect(buttonBox.y + buttonBox.height).toBeLessThanOrEqual(inputBox.y + inputBox.height + 1);
    }
    expect((await header.boundingBox())!.height).toBeLessThanOrEqual(60);
  }
  const bpm = header.getByRole("spinbutton", { name: "Preview BPM" });
  const bars = header.getByRole("spinbutton", { name: "Bars" });
  await bpm.fill("100.25");
  await header.getByRole("button", { name: "Increase Preview BPM by 1" }).click();
  await expect(bpm).toHaveValue("101.25");
  await header.getByRole("button", { name: "Decrease Preview BPM by 1" }).click();
  await expect(bpm).toHaveValue("100.25");
  await bars.fill("2.5");
  await header.getByRole("button", { name: "Increase Bars by 1" }).click();
  await expect(bars).toHaveValue("3.5");
  await header.getByRole("button", { name: "Decrease Bars by 1" }).click();
  await expect(bars).toHaveValue("2.5");
  await bars.fill("0.25");
  await expect(header.getByRole("button", { name: "Decrease Bars by 1" })).toBeDisabled();
  await page.screenshot({ path: "studio/test-results/loop-header.png" });
});

test("Loop Builder framing control matches the 16:9 projector output", async ({ page }) => {
  const project = catalogProject("metropolis-machine");
  project.id = "cover-fit-fixture";
  project.name = "Cover fit fixture";
  project.visualLoops[0].events[0].appearance.fit = "cover";
  await page.route("**/api/studio/projects/cover-fit-fixture", (route) => route.fulfill({ json: project }));
  await page.route("**/api/studio/projects/cover-fit-fixture/prepare", (route) => route.fulfill({ json: { media: {}, created: 0, reused: 12, removed: 0, warnings: [] } }));
  await page.goto("/studio/dist/?scene=cover-fit-fixture");
  await expect(page.getByRole("textbox", { name: "Scene title" })).toHaveValue("Cover fit fixture");
  await expect(page.locator(".source-preview video")).toHaveCSS("object-fit", "contain");
  await page.getByRole("button", { name: /Loop Builder/ }).click();
  const video = page.locator(".loop-preview .visual-video").first();
  await expect.poll(() => video.evaluate((element: HTMLVideoElement) => element.style.objectFit)).toBe("cover");
  await expect(video).toHaveCSS("object-fit", "cover");
  const frame = await page.locator(".loop-preview").boundingBox();
  expect(frame).not.toBeNull();
  expect(frame!.width / frame!.height).toBeCloseTo(16 / 9, 1);
  await page.locator(".loop-event").first().click();
  await page.getByRole("combobox", { name: "Framing" }).selectOption("contain");
  await expect(video).toHaveCSS("object-fit", "contain");
  await page.screenshot({ path: "studio/test-results/loop-preview-framing.png" });
});

test("projector keeps the authored 16:9 frame when its window has another aspect ratio", async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 768 });
  await page.goto("/poc/output.html");
  const frame = await page.locator(".output-stage").boundingBox();
  expect(frame).not.toBeNull();
  expect(frame!.width / frame!.height).toBeCloseTo(16 / 9, 1);
  expect(frame!.width).toBeCloseTo(1024, 0);
  expect(frame!.y).toBeGreaterThan(0);
});

test("live bridge drawer provides a non-mutating input and media preflight", async ({ page }) => {
  await page.route("**/api/bridge/events*", (route) => route.fulfill({ status: 200, contentType: "text/event-stream", body: "" }));
  await page.goto("/poc/");
  await expect(page.locator("#scene-catalog-count")).toContainText("playable now");
  await page.locator("#bridge-drawer-toggle").click();
  await expect(page.locator("#preflight-mode")).toHaveText("Manual / emulator");
  await expect(page.locator("#preflight-media-status")).toHaveText("Ready offline");
  await expect(page.locator("#preflight-media-list li")).toHaveCount(1);
  await page.getByRole("button", { name: "Load deck 1" }).evaluate((button: HTMLButtonElement) => button.click());
  await expect(page.locator("#preflight-media-list li")).toHaveCount(2);
  await page.locator("#preflight-refresh").click();
  await expect(page.locator("#preflight-media-status")).toHaveText("Ready offline");
});

test("preflight flags a queued scene with remote media as connection-dependent", async ({ page }) => {
  const scene = compileRuntimeScene(catalogProject("metropolis-machine"));
  scene.id = "remote-preflight-fixture";
  scene.name = "Remote preflight fixture";
  scene.clips[0].src = "https://example.com/remote-film.mp4";
  await page.addInitScript((value) => {
    localStorage.setItem("video-sync-published-scene", JSON.stringify(value));
    localStorage.setItem("video-sync-scene-queue-v1", JSON.stringify({ items: [{ id: "remote-queue-item", sceneId: value.id, repetitions: 1 }], cursorIndex: 0, used: 0 }));
  }, scene);
  await page.route("**/api/bridge/events*", (route) => route.fulfill({ status: 200, contentType: "text/event-stream", body: "" }));
  await page.goto("/poc/");
  await expect(page.locator("#scene-catalog-count")).toContainText("playable now");
  await page.locator("#bridge-drawer-toggle").click();
  await expect(page.locator("#preflight-media-status")).toHaveText("Connection needed");
  await expect(page.locator("#preflight-media-list")).toContainText("Remote preflight fixture");
  await expect(page.locator("#preflight-media-list")).toContainText("1 online");
});

test("prepared clip media rebases loop source offsets onto the short video", () => {
  const project = catalogProject("metropolis-machine");
  const clip = project.clips[0];
  clip.inSeconds = 1;
  clip.outSeconds = 4;
  const scene = compileRuntimeScene(project, { [clip.id]: { file: "/api/studio/projects/metropolis-machine/prepared/cut.mp4", durationSeconds: 3 } });
  const runtimeClip = scene.clips.find((item) => item.id === clip.id)!;
  expect(runtimeClip.src).toContain("/prepared/cut.mp4");
  expect(runtimeClip.startSeconds).toBe(0);
  expect(runtimeClip.durationSeconds).toBe(3);
  const event = project.visualLoops.flatMap((loop) => loop.events).find((item) => item.clipId === clip.id)!;
  const compiled = scene.visualLoops.flatMap((loop) => loop.events).find((item) => item.id === event.id)!;
  expect(compiled.source.startSeconds).toBe(event.source.offsetSeconds);
  expect(compiled.source.endSeconds).toBe(3);
});

test("used clip cuts and deletion warn, and entering Loop Builder reconciles the current clip list", async ({ page }) => {
  await useCatalogDefaults(page);
  const snapshots: any[] = [];
  await page.route("**/api/studio/projects/metropolis-machine/prepare", async (route) => {
    snapshots.push(JSON.parse(route.request().postData() ?? "null"));
    await route.fulfill({ json: { media: {}, created: 0, reused: 0, removed: 0, warnings: [] } });
  });
  await page.goto("/studio/");
  const inTime = page.locator(".inspector-fields .field-row input").first();
  expect(await inTime.inputValue()).toBe("0.000");
  await inTime.fill("1.000");
  await inTime.press("Tab");
  const rangeWarning = page.getByRole("dialog", { name: "Change clip cut?" });
  await expect(rangeWarning).toContainText("re-cut this clip");
  await rangeWarning.getByRole("button", { name: "Cancel" }).click();
  await expect(inTime).toHaveValue("0.000");
  await inTime.fill("1.000");
  await inTime.press("Tab");
  await rangeWarning.getByRole("button", { name: "Change cut" }).click();
  await expect(inTime).toHaveValue("1.000");
  await page.getByRole("button", { name: /Loop Builder/ }).click();
  await expect.poll(() => snapshots.length).toBe(1);
  expect(snapshots[0].clips[0].inSeconds).toBe(1);
  await page.getByRole("button", { name: /Sources & Clips/ }).click();
  await page.getByRole("button", { name: "Delete clip" }).click();
  const deleteWarning = page.getByRole("dialog", { name: "Delete clip and loop instances?" });
  await expect(deleteWarning).toContainText("timeline instance");
  await deleteWarning.getByRole("button", { name: "Cancel" }).click();
  await expect(page.locator(".clip-card")).toHaveCount(1);
  await page.getByRole("button", { name: "Delete clip" }).click();
  await deleteWarning.getByRole("button", { name: "Delete clip" }).click();
  await expect(page.locator(".clip-card")).toHaveCount(0);
  await page.getByRole("button", { name: /Loop Builder/ }).click();
  await expect.poll(() => snapshots.length).toBe(2);
  expect(snapshots[1].clips.some((clip: { id: string }) => clip.id === snapshots[0].clips[0].id)).toBe(false);
  expect(snapshots[1].visualLoops.every((loop: { events: Array<{ clipId: string }> }) => loop.events.every((event) => event.clipId !== snapshots[0].clips[0].id))).toBe(true);
});

test("renaming a used clip neither warns nor prepares a new cut", async ({ page }) => {
  await useCatalogDefaults(page);
  let preparations = 0;
  await page.route("**/api/studio/projects/metropolis-machine/prepare", (route) => {
    preparations += 1;
    return route.fulfill({ json: { media: {}, created: 0, reused: 0, removed: 0, warnings: [] } });
  });
  await page.goto("/studio/");
  await page.getByRole("button", { name: /Loop Builder/ }).click();
  await expect.poll(() => preparations).toBe(1);
  await page.getByRole("button", { name: /Sources & Clips/ }).click();
  await page.getByRole("textbox", { name: "Name", exact: true }).fill("Robot reveal remix");
  await expect(page.getByRole("dialog", { name: "Change clip cut?" })).toHaveCount(0);
  await page.getByRole("button", { name: /Loop Builder/ }).click();
  await expect(page.locator(".loop-preview")).toBeVisible();
  expect(preparations).toBe(1);
});

test("a used long-source In accepts timecode, warns, and explains invalid values", async ({ page }) => {
  const project = catalogProject("metropolis-machine");
  project.id = "long-source-timecode";
  project.name = "Long source timecode";
  project.sources[0].durationSeconds = 5794.9;
  project.clips[0].inSeconds = 3946.728;
  project.clips[0].outSeconds = 3960.113;
  await page.route("**/api/studio/projects/long-source-timecode", (route) => route.fulfill({ json: project }));
  await page.goto("/studio/dist/?scene=long-source-timecode");
  const input = page.getByRole("textbox", { name: "In", exact: true });
  await expect(input).toHaveValue("3946.728");
  await input.fill("1:05:47");
  await expect(input).toHaveValue("1:05:47");
  await input.press("Enter");
  const warning = page.getByRole("dialog", { name: "Change clip cut?" });
  await expect(warning).toBeVisible();
  await warning.getByRole("button", { name: "Change cut" }).click();
  await expect(input).toHaveValue("3947.000");
  await input.fill("1:99");
  await input.press("Tab");
  await expect(page.getByRole("alert")).toContainText("Enter seconds or a timecode");
  await expect(input).toHaveValue("1:99");
  await expect(warning).toHaveCount(0);
});

test("refresh restores source, loop, and cue positions without replaying clip preparation", async ({ page }) => {
  await useCatalogDefaults(page);
  let preparations = 0;
  await page.route("**/api/studio/projects/metropolis-machine/prepare", (route) => {
    preparations += 1;
    return route.fulfill({ json: { media: {}, created: 0, reused: 12, removed: 0, warnings: [] } });
  });
  await page.goto("/studio/");
  const sourceOverview = page.getByTestId("source-overview");
  const sourceBounds = await sourceOverview.boundingBox();
  expect(sourceBounds).not.toBeNull();
  await page.mouse.click(sourceBounds!.x + sourceBounds!.width * 0.6, sourceBounds!.y + sourceBounds!.height / 2);
  await expect.poll(async () => Number(await sourceOverview.getAttribute("aria-valuenow"))).toBeGreaterThan(4);
  await page.reload();
  await expect.poll(async () => Number(await page.getByTestId("source-overview").getAttribute("aria-valuenow"))).toBeGreaterThan(4);

  await page.getByRole("button", { name: /Loop Builder/ }).click();
  await expect.poll(() => preparations).toBe(1);
  const loopScrub = page.getByTestId("preview-scrub");
  await loopScrub.click({ position: { x: (await loopScrub.boundingBox())!.width * 0.65, y: 7 } });
  await expect.poll(async () => Number(await loopScrub.getAttribute("aria-valuenow"))).toBeGreaterThan(2.5);
  await page.reload();
  await expect(page.getByRole("dialog", { name: "Preparing clips" })).toHaveCount(0);
  await expect.poll(async () => Number(await page.getByTestId("preview-scrub").getAttribute("aria-valuenow"))).toBeGreaterThan(2.5);
  expect(preparations).toBe(1);

  await expect(page.locator(".workspace-tabs button")).toHaveCount(2);
});

test("a scene URL refresh keeps the selected workspace and playhead", async ({ page }) => {
  await useCatalogDefaults(page);
  await page.route("**/api/studio/projects/metropolis-machine/prepare", (route) => route.fulfill({ json: { media: {}, created: 0, reused: 12, removed: 0, warnings: [] } }));
  await page.goto("/studio/?scene=metropolis-machine");
  await page.getByRole("button", { name: /Loop Builder/ }).click();
  const scrub = page.getByTestId("preview-scrub");
  await scrub.click({ position: { x: (await scrub.boundingBox())!.width * 0.48, y: 7 } });
  await expect.poll(async () => Number(await scrub.getAttribute("aria-valuenow"))).toBeGreaterThan(1.8);
  await page.reload();
  await expect(page.getByRole("button", { name: /Loop Builder/ })).toHaveClass(/active/);
  await expect.poll(async () => Number(await page.getByTestId("preview-scrub").getAttribute("aria-valuenow"))).toBeGreaterThan(1.8);
  await expect(page.getByRole("dialog", { name: "Preparing clips" })).toHaveCount(0);
});

test("an older Loop Builder session prepares silently on refresh when it has no media cache", async ({ page }) => {
  await useCatalogDefaults(page);
  let preparations = 0;
  let release!: () => void;
  const waiting = new Promise<void>((resolve) => { release = resolve; });
  await page.route("**/api/studio/projects/metropolis-machine/prepare", async (route) => {
    preparations += 1;
    if (preparations === 2) await waiting;
    await route.fulfill({ json: { media: {}, created: 0, reused: 12, removed: 0, warnings: [] } });
  });
  await page.goto("/studio/");
  await page.getByRole("button", { name: /Loop Builder/ }).click();
  await expect(page.locator(".loop-preview")).toBeVisible();
  await expect.poll(() => preparations).toBe(1);
  await page.addInitScript(() => {
    const key = "video-sync-studio-session-v1";
    const saved = localStorage.getItem(key);
    if (!saved) return;
    const session = JSON.parse(saved);
    delete session.prepared;
    localStorage.setItem(key, JSON.stringify(session));
  });
  await page.reload();
  await expect.poll(() => preparations).toBe(2);
  await expect(page.getByRole("dialog", { name: "Preparing clips" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Show progress" })).toBeVisible();
  release();
  await expect(page.getByRole("button", { name: "Show progress" })).toHaveCount(0);
});

test("Loop Builder opens a preparation modal with a progress bar and can continue in the background", async ({ page }) => {
  await useCatalogDefaults(page);
  let release!: () => void;
  const waiting = new Promise<void>((resolve) => { release = resolve; });
  await page.route("**/api/studio/projects/metropolis-machine/prepare", async (route) => {
    await waiting;
    await route.fulfill({
      contentType: "application/x-ndjson",
      body: [
        { type: "progress", completed: 0, total: 0, current: null },
        { type: "progress", completed: 0, total: 0, current: null, reused: 12 },
        { type: "done", result: { media: {}, created: 0, reused: 12, removed: 0, warnings: [] } },
      ].map((item) => JSON.stringify(item)).join("\n") + "\n",
    });
  });
  await page.goto("/studio/");
  await page.getByRole("button", { name: /Loop Builder/ }).click();
  const modal = page.getByRole("dialog", { name: "Preparing clips" });
  await expect(modal).toBeVisible();
  await expect(modal.getByRole("progressbar", { name: "Clip preparation" })).toHaveAttribute("aria-valuenow", "0");
  await expect(modal).toContainText("Checking existing clips…");
  await modal.getByRole("button", { name: "Continue in background" }).click();
  await expect(modal).toHaveCount(0);
  await expect(page.locator(".status-bar").getByRole("status", { name: "Preparing clips" })).toBeVisible();
  await page.getByRole("button", { name: "Show progress" }).click();
  await expect(modal).toBeVisible();
  await modal.getByRole("button", { name: "Continue in background" }).click();
  await page.getByRole("button", { name: /Sources & Clips/ }).click();
  await expect(page.locator(".status-bar").getByRole("status", { name: "Preparing clips" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Show progress" })).toBeVisible();
  release();
  await expect(page.locator(".status-bar").getByRole("status", { name: "Preparing clips" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Show progress" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "View preparation" })).toHaveCount(0);
  await page.getByRole("button", { name: /Loop Builder/ }).click();
  await expect(page.locator(".loop-preview")).toBeVisible();
  await expect(page.locator(".status-bar")).toContainText("12 reused");
});

test("clip preparation progress counts only new cuts and names reused clips separately", async ({ page }) => {
  await useCatalogDefaults(page);
  await page.addInitScript(() => {
    const originalFetch = window.fetch.bind(window);
    window.fetch = (input, init) => {
      if (!String(input).endsWith("/api/studio/projects/metropolis-machine/prepare")) return originalFetch(input, init);
      const encoder = new TextEncoder();
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(encoder.encode(`${JSON.stringify({ type: "progress", completed: 0, total: 3, current: "Clip 6", reused: 5 })}\n`));
          Object.assign(window, { finishTestPreparation: () => {
            controller.enqueue(encoder.encode(`${JSON.stringify({ type: "progress", completed: 3, total: 3, current: null, reused: 5 })}\n`));
            controller.enqueue(encoder.encode(`${JSON.stringify({ type: "done", result: { media: {}, created: 3, reused: 5, removed: 0, warnings: [] } })}\n`));
            controller.close();
          } });
        },
      });
      return Promise.resolve(new Response(stream, { headers: { "content-type": "application/x-ndjson" } }));
    };
  });
  await page.goto("/studio/");
  await page.getByRole("button", { name: /Loop Builder/ }).click();
  const modal = page.getByRole("dialog", { name: "Preparing clips" });
  await expect(modal).toContainText("0 of 3 new or changed cuts");
  await expect(modal).toContainText("5 already prepared");
  await expect(page.locator(".status-bar")).toContainText("0/3 cuts · 5 reused");
  await page.evaluate(() => (window as typeof window & { finishTestPreparation: () => void }).finishTestPreparation());
  await expect(modal).toHaveCount(0);
  await expect(page.locator(".status-bar")).toContainText("3 cut, 5 reused");
});

test("an imported source gets a selected full-length default clip", async ({ page }) => {
  await useCatalogDefaults(page);
  await page.route("**/api/studio/projects/metropolis-machine/sources/**", (route) => route.fulfill({ json: { file: "/assets/scenes/metropolis/robot-reveal.mp4", fileName: "robot-reveal.mp4" } }));
  await page.goto("/studio/");
  await page.locator('.source-list input[type="file"]').setInputFiles("assets/scenes/metropolis/robot-reveal.mp4");
  await expect(page.locator(".source-list .list-card")).toHaveCount(13);
  await expect(page.locator(".source-list .list-card").last()).toContainText("1 clip");
  await expect(page.locator(".clip-card")).toHaveCount(1);
  await expect(page.locator(".inspector-fields .field-row input").nth(0)).toHaveValue("0.000");
  const out = Number(await page.locator(".inspector-fields .field-row input").nth(1).inputValue());
  const duration = await page.locator(".source-preview video").evaluate((video: HTMLVideoElement) => video.duration);
  expect(Math.abs(out - duration)).toBeLessThan(0.001);
});

test("Studio restores unsaved scene drafts and editor position after refresh, then clears dirty on Save", async ({ page }) => {
  await useCatalogDefaults(page);
  let saves = 0;
  await page.route("**/api/studio/projects/metropolis-machine", (route) => {
    if (route.request().method() === "PUT") { saves += 1; return route.fulfill({ json: { id: "metropolis-machine", saved: true } }); }
    return route.fulfill({ status: 404, body: "Not saved" });
  });
  await page.goto("/studio/");
  await page.getByRole("textbox", { name: "Scene title" }).fill("Metropolis Draft");
  await page.getByRole("button", { name: /Loop Builder/ }).click();
  await page.locator(".loop-list .list-card").nth(1).click();
  await page.reload();
  await expect(page.getByRole("textbox", { name: "Scene title" })).toHaveValue("Metropolis Draft");
  await expect(page.getByRole("button", { name: /Loop Builder/ })).toHaveClass(/active/);
  await expect(page.locator(".loop-list .list-card").nth(1)).toHaveClass(/selected/);
  await expect(page.locator(".status-bar")).toContainText("Unsaved edits");
  expect(saves).toBe(0);
  expect(await page.evaluate(() => localStorage.getItem("video-sync-studio-project:metropolis-machine"))).toBeNull();

  await selectScene(page, "trip-to-the-moon");
  await expect(page.getByRole("textbox", { name: "Scene title" })).toHaveValue("A Trip to the Moon");
  await expect(page.locator(".status-bar")).toContainText("Clips ready for A Trip to the Moon");
  await page.getByRole("textbox", { name: "Scene title" }).fill("Moon Draft");
  await page.reload();
  await expect(page.getByRole("textbox", { name: "Scene title" })).toHaveValue("Moon Draft");
  await selectScene(page, "metropolis-machine");
  await expect(page.getByRole("textbox", { name: "Scene title" })).toHaveValue("Metropolis Draft");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.locator(".status-bar")).not.toContainText("Unsaved edits");
  expect(saves).toBe(1);
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem("video-sync-studio-session-v1") ?? "null")?.drafts?.["metropolis-machine"]?.dirty)).toBe(false);
  await page.reload();
  await expect(page.getByRole("textbox", { name: "Scene title" })).toHaveValue("Metropolis Draft");
  await expect(page.locator(".status-bar")).not.toContainText("Unsaved edits");
  await page.getByRole("textbox", { name: "Scene title" }).fill("Unsaved again");
  page.once("dialog", (dialog) => void dialog.accept());
  await page.getByRole("button", { name: "Reload saved" }).click();
  await expect(page.getByRole("textbox", { name: "Scene title" })).toHaveValue("Metropolis Draft");
  await expect(page.locator(".status-bar")).not.toContainText("Unsaved edits");
});

test("source mute and loop audition settings survive tab changes, scene changes, and refresh", async ({ page }) => {
  await useCatalogDefaults(page);
  await page.goto("/studio/");
  const video = page.locator(".source-preview video");
  await page.getByRole("button", { name: "Mute source" }).click();
  await expect(video).toHaveJSProperty("muted", true);
  await page.locator(".clip-card").first().click();
  await expect(page.getByRole("button", { name: "Stop audition" })).toHaveAttribute("aria-pressed", "true");

  await page.getByRole("button", { name: /Loop Builder/ }).click();
  await page.getByRole("button", { name: /Sources & Clips/ }).click();
  await expect(page.getByRole("button", { name: "Unmute source" })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("button", { name: "Stop audition" })).toHaveAttribute("aria-pressed", "true");

  await selectScene(page, "trip-to-the-moon");
  await expect(page.getByRole("button", { name: "Unmute source" })).toHaveAttribute("aria-pressed", "true");
  await page.reload();
  await expect(page.getByRole("button", { name: "Unmute source" })).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator(".source-preview video")).toHaveJSProperty("muted", true);
  await expect(page.getByRole("button", { name: "Stop audition" })).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "Unmute source" }).click();
  await page.getByRole("button", { name: "Stop audition" }).click();
  await page.reload();
  await expect(page.getByRole("button", { name: "Mute source" })).toHaveAttribute("aria-pressed", "false");
  await expect(page.getByRole("button", { name: "Loop audition" })).toHaveAttribute("aria-pressed", "false");
});

test("Live Console restores deck, queue, mixer, tempo, and FX state from local storage", async ({ page }) => {
  await page.route("**/api/bridge/events*", (route) => route.fulfill({ status: 200, contentType: "text/event-stream", body: "" }));
  await page.goto("/poc/");
  await expect(page.locator("#scene-catalog-count")).toContainText("playable now");
  await page.locator("#bpm").fill("123.45");
  await page.locator("#bpm").press("Tab");
  await page.locator("#crossfader").evaluate((input: HTMLInputElement) => { input.value = "73"; input.dispatchEvent(new Event("input", { bubbles: true })); });
  await page.locator("[data-level-deck='1']").evaluate((input: HTMLInputElement) => { input.value = "42"; input.dispatchEvent(new Event("input", { bubbles: true })); });
  await page.locator("#beatfx-select").selectOption({ index: 2 });
  const selectedFx = await page.locator("#beatfx-select").inputValue();
  await page.locator("#beatfx-target").selectOption("deck1");
  await page.locator("#beatfx-toggle").click();
  await page.locator("#beatfx-depth").evaluate((input: HTMLInputElement) => { input.value = "65"; input.dispatchEvent(new Event("input", { bubbles: true })); });
  const queueCount = await page.locator(".scene-queue-item").count();
  await page.locator("#scene-queue-add").click();
  await page.getByRole("button", { name: "Load deck 1" }).click();
  await page.getByRole("button", { name: "Play deck 1" }).click();
  await page.locator("[data-cue-deck='1'][data-cue='1']").click();
  await page.locator("#bridge-drawer-toggle").click();
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem("video-sync-player-state-v1") ?? "null")?.decks?.[0]?.activeCueInput)).toBe("hotCueB");
  await page.reload();
  await expect(page.locator("#scene-catalog-count")).toContainText("playable now");
  await expect(page.locator("#bpm")).toHaveValue("123.45");
  await expect(page.locator("#crossfader")).toHaveValue("73");
  await expect(page.locator("[data-level-deck='1']")).toHaveValue("42");
  await expect(page.locator("#beatfx-select")).toHaveValue(selectedFx);
  await expect(page.locator("#beatfx-target")).toHaveValue("deck1");
  await expect(page.locator("#beatfx-toggle")).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("#beatfx-depth")).toHaveValue("65");
  await expect(page.locator(".scene-queue-item")).toHaveCount(queueCount + 1);
  await expect(page.getByRole("button", { name: "Pause deck 1" })).toBeVisible();
  await expect(page.locator("[data-cue-deck='1'][data-cue='1']")).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("#bridge-drawer-toggle")).toHaveAttribute("aria-expanded", "true");
});

test("header puts the scene selector above full-width tabs on small screens", async ({ page }) => {
  await useCatalogDefaults(page);
  await page.goto("/studio/");
  for (const width of [1600, 1220, 900, 761, 760, 520]) {
    await page.setViewportSize({ width, height: 900 });
    const tabs = (await page.locator(".workspace-tabs").boundingBox())!;
    const scene = (await page.locator(".scene-current").boundingBox())!;
    const title = (await page.getByRole("textbox", { name: "Scene title" }).boundingBox())!;
    const change = (await page.getByRole("button", { name: "Change scene" }).boundingBox())!;
    const actions = (await page.locator(".header-actions").boundingBox())!;
    expect(title.x).toBeGreaterThanOrEqual(scene.x);
    expect(change.x + change.width).toBeLessThanOrEqual(scene.x + scene.width + 1);
    if (width > 1220) {
      expect(tabs.x + tabs.width).toBeLessThanOrEqual(scene.x);
    } else {
      expect(scene.y + scene.height).toBeLessThanOrEqual(tabs.y);
      if (width > 760) {
        expect(actions.x).toBeGreaterThanOrEqual(scene.x + scene.width);
        expect(actions.x - (scene.x + scene.width)).toBeLessThanOrEqual(16);
      } else {
        expect(scene.y).toBeGreaterThanOrEqual(actions.y + actions.height);
        expect(tabs.x).toBe(10);
        expect(tabs.width).toBe(width - 20);
      }
    }
  }
  await expect(page.locator(".scene-open")).toHaveText("");
  await expect(page.locator(".scene-open svg path")).toHaveCount(1);
});

test("header controls stay contained and separate at narrow browser widths", async ({ page }) => {
  await useCatalogDefaults(page);
  await page.goto("/studio/");
  for (const width of [1365, 1221, 1220, 1180, 900, 761, 760, 700, 520, 400]) {
    await page.setViewportSize({ width, height: 900 });
    const header = (await page.locator(".app-header").boundingBox())!;
    const controls = await Promise.all([".brand", ".workspace-tabs", ".scene-current", ".header-actions"].map(async (selector) => (await page.locator(selector).boundingBox())!));
    for (const box of controls) {
      expect(box.x).toBeGreaterThanOrEqual(header.x);
      expect(box.y).toBeGreaterThanOrEqual(header.y);
      expect(box.x + box.width).toBeLessThanOrEqual(header.x + header.width + 1);
      expect(box.y + box.height).toBeLessThanOrEqual(header.y + header.height + 1);
    }
    for (let left = 0; left < controls.length; left++) {
      for (let right = left + 1; right < controls.length; right++) {
        const a = controls[left];
        const b = controls[right];
        const overlap = Math.min(a.x + a.width, b.x + b.width) > Math.max(a.x, b.x)
          && Math.min(a.y + a.height, b.y + b.height) > Math.max(a.y, b.y);
        expect(overlap, `${width}px: ${left} overlaps ${right}`).toBe(false);
      }
    }
    const brandTitle = await page.locator(".brand strong").boundingBox();
    if (brandTitle) expect(brandTitle.x + brandTitle.width).toBeLessThanOrEqual(controls[0].x + controls[0].width + 1);
  }
});

test("panel dividers resize across tabs and persist without changing the scene", async ({ page }) => {
  await useCatalogDefaults(page);
  await page.setViewportSize({ width: 1180, height: 900 });
  await page.goto("/studio/");
  const sourceList = page.locator(".source-list");
  const sourcePreview = page.locator(".source-preview");
  const sourceBottom = page.locator(".source-bottom");
  const inspector = page.locator(".sources-workspace .inspector");
  const originalLeft = (await sourceList.boundingBox())!.width;
  const originalRight = (await inspector.boundingBox())!.width;
  const originalBottom = (await sourceBottom.boundingBox())!.height;

  await dragDivider(page, "Resize Sources panel", 70, 0);
  await expect.poll(async () => (await sourceList.boundingBox())!.width).toBeGreaterThan(originalLeft + 60);
  const draggedLeft = (await sourceList.boundingBox())!.width;
  await page.getByRole("separator", { name: "Resize Sources panel" }).focus();
  await page.keyboard.press("ArrowRight");
  await expect.poll(async () => (await sourceList.boundingBox())!.width).toBeGreaterThan(draggedLeft + 15);
  await dragDivider(page, "Resize Clip bin and inspector", -50, 0);
  await expect.poll(async () => (await inspector.boundingBox())!.width).toBeGreaterThan(originalRight + 40);
  await dragDivider(page, "Resize source preview and timelines", 0, -65);
  await expect.poll(async () => (await sourceBottom.boundingBox())!.height).toBeGreaterThan(originalBottom + 55);
  const savedLeft = (await sourceList.boundingBox())!.width;
  const savedRight = (await inspector.boundingBox())!.width;
  const savedBottom = (await sourceBottom.boundingBox())!.height;
  expect((await sourcePreview.boundingBox())!.height).toBeGreaterThan(180);
  await expect(page.locator(".status-bar")).not.toContainText("Unsaved edits");

  await page.getByRole("button", { name: /Loop Builder/ }).click();
  expect((await page.locator(".loop-list").boundingBox())!.width).toBeCloseTo(savedLeft, 0);
  expect((await page.locator(".loops-workspace .inspector").boundingBox())!.width).toBeCloseTo(savedRight, 0);
  const loopTimeline = page.locator(".loop-timeline-shell");
  const originalTimeline = (await loopTimeline.boundingBox())!.height;
  await dragDivider(page, "Resize loop preview and timeline", 0, -55);
  await expect.poll(async () => (await loopTimeline.boundingBox())!.height).toBeGreaterThan(originalTimeline + 45);
  await page.getByRole("separator", { name: "Resize loop preview and timeline" }).focus();
  await page.keyboard.press("ArrowDown");
  await expect.poll(async () => (await loopTimeline.boundingBox())!.height).toBeLessThan(originalTimeline + 45);
  const savedTimeline = (await loopTimeline.boundingBox())!.height;

  await page.reload();
  await page.getByRole("button", { name: /Sources & Clips/ }).click();
  expect((await sourceList.boundingBox())!.width).toBeCloseTo(savedLeft, 0);
  expect((await inspector.boundingBox())!.width).toBeCloseTo(savedRight, 0);
  expect((await sourceBottom.boundingBox())!.height).toBeCloseTo(savedBottom, 0);
  await page.getByRole("button", { name: /Loop Builder/ }).click();
  expect((await loopTimeline.boundingBox())!.height).toBeCloseTo(savedTimeline, 0);

  await page.setViewportSize({ width: 760, height: 900 });
  await page.getByRole("button", { name: /Sources & Clips/ }).click();
  await expect.poll(async () => (await page.locator(".source-editor").boundingBox())!.width).toBeGreaterThanOrEqual(300);
  const narrowEditor = (await page.locator(".source-editor").boundingBox())!;
  expect(narrowEditor.x + narrowEditor.width).toBeLessThanOrEqual(760);
});

test("history actions stay in the status bar across workspaces and narrow widths", async ({ page }) => {
  await useCatalogDefaults(page);
  await page.setViewportSize({ width: 1180, height: 900 });
  await page.goto("/studio/");
  const buttons = page.locator(".status-bar .history-button");
  const metadata = page.locator(".status-metadata");
  await expect(buttons).toHaveCount(2);
  expect(Math.abs((await buttons.first().boundingBox())!.y - (await buttons.last().boundingBox())!.y)).toBeLessThan(2);
  expect((await buttons.last().boundingBox())!.x + (await buttons.last().boundingBox())!.width).toBeLessThan((await metadata.boundingBox())!.x);
  await expect(page.locator(".sources-workspace .history-toolbar")).toHaveCount(0);
  await page.getByRole("button", { name: /Loop Builder/ }).click();
  await expect(buttons).toHaveCount(2);
  await expect(page.locator(".loops-workspace .history-toolbar")).toHaveCount(0);
  await page.setViewportSize({ width: 500, height: 900 });
  await expect(buttons.first()).toBeInViewport();
  await expect(buttons.last()).toBeInViewport();
  await expect(metadata).toBeHidden();
});

test("keeps every source video and its controls inside the preview", async ({ page }) => {
  await useCatalogDefaults(page);
  await page.goto("/studio/");
  const video = page.locator(".source-preview video");
  for (const width of [1600, 1180]) {
    await page.setViewportSize({ width, height: 900 });
    for (const scene of ["metropolis-machine", "trip-to-the-moon", "nosferatu"]) {
      await selectScene(page, scene);
      for (const index of [0, 4, 7, 11]) {
        await page.locator(".source-list .list-card").nth(index).click();
        await expect.poll(() => video.evaluate((element: HTMLVideoElement) => element.videoWidth)).toBeGreaterThan(0);
        const bounds = await video.evaluate((element: HTMLVideoElement) => {
          const outer = element.parentElement!.getBoundingClientRect();
          const inner = element.getBoundingClientRect();
          return { outer: { left: outer.left, top: outer.top, right: outer.right, bottom: outer.bottom }, inner: { left: inner.left, top: inner.top, right: inner.right, bottom: inner.bottom } };
        });
        expect(bounds.inner.left).toBeGreaterThanOrEqual(bounds.outer.left);
        expect(bounds.inner.top).toBeGreaterThanOrEqual(bounds.outer.top);
        expect(bounds.inner.right).toBeLessThanOrEqual(bounds.outer.right);
        expect(bounds.inner.bottom).toBeLessThanOrEqual(bounds.outer.bottom);
      }
    }
  }
});

test("timeline and sidebar clip clicks both play from the In point", async ({ page }) => {
  const project = catalogProject("metropolis-machine");
  project.id = "clip-start-fixture";
  project.sources = [{ ...project.sources[0], id: "feature" }];
  project.clips = [{ id: "range", sourceId: "feature", label: "Middle range", inSeconds: 2, outSeconds: 5, color: "#9bd9e8", defaultEndBehavior: "loop" }];
  project.visualLoops = [{ id: "default", name: "Default", length: { bars: 4 }, repeat: true, events: [] }];
  project.defaultLoopId = "default";
  await page.route("**/api/studio/projects/clip-start-fixture", (route) => route.fulfill({ json: project }));
  await page.goto("/studio/dist/?scene=clip-start-fixture");
  const video = page.locator(".source-preview video");
  await expect.poll(() => video.evaluate((element: HTMLVideoElement) => element.videoWidth)).toBeGreaterThan(0);
  await video.evaluate((element: HTMLVideoElement & { seekWrites?: number[] }) => {
    element.seekWrites = [];
    const time = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, "currentTime")!;
    Object.defineProperty(element, "currentTime", {
      configurable: true,
      get() { return time.get!.call(this); },
      set(value: number) { element.seekWrites!.push(value); time.set!.call(this, value); },
    });
  });
  const clip = page.locator(".clip-range").first();
  await clip.click();
  expect(await video.evaluate((element: HTMLVideoElement & { seekWrites?: number[] }) => element.seekWrites)).toEqual([2]);
  expect(await video.evaluate((element: HTMLVideoElement) => element.currentTime)).toBeCloseTo(2, 0);
  expect(await video.evaluate((element: HTMLVideoElement) => element.paused)).toBe(false);
  await page.locator(".clip-card").first().click();
  expect(await video.evaluate((element: HTMLVideoElement & { seekWrites?: number[] }) => element.seekWrites)).toEqual([2, 2]);
  expect(await video.evaluate((element: HTMLVideoElement) => element.currentTime)).toBeCloseTo(2, 0);
  await clip.focus();
  await page.keyboard.press("Enter");
  expect(await video.evaluate((element: HTMLVideoElement & { seekWrites?: number[] }) => element.seekWrites)).toEqual([2, 2, 2]);
  expect(await video.evaluate((element: HTMLVideoElement) => element.currentTime)).toBeCloseTo(2, 0);
});

test("dragging the detail timeline suspends playback until release", async ({ page }) => {
  await useCatalogDefaults(page);
  await page.goto("/studio/");
  const video = page.locator(".source-preview video");
  await expect.poll(() => video.evaluate((element: HTMLVideoElement) => element.videoWidth)).toBeGreaterThan(0);
  await video.evaluate((element: HTMLVideoElement & { playEvents?: number }) => {
    element.playEvents = 0;
    element.addEventListener("play", () => { element.playEvents = (element.playEvents ?? 0) + 1; });
  });
  await page.getByRole("button", { name: "Play", exact: true }).click();
  await expect.poll(() => video.evaluate((element: HTMLVideoElement) => element.paused)).toBe(false);
  await expect.poll(() => video.evaluate((element: HTMLVideoElement & { playEvents?: number }) => element.playEvents)).toBe(1);

  const timeline = page.getByTestId("source-timeline");
  const bounds = await timeline.boundingBox();
  const start = { x: bounds!.x + bounds!.width * 0.55, y: bounds!.y + 4 };
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(start.x - 80, start.y, { steps: 4 });
  await expect.poll(() => video.evaluate((element: HTMLVideoElement) => element.paused)).toBe(true);
  expect(await video.evaluate((element: HTMLVideoElement & { playEvents?: number }) => element.playEvents)).toBe(1);
  await page.mouse.up();
  await expect.poll(() => video.evaluate((element: HTMLVideoElement) => element.paused)).toBe(false);

  await page.getByRole("button", { name: "Pause", exact: true }).click();
  const clip = await page.locator(".clip-range").first().boundingBox();
  await page.mouse.move(clip!.x + clip!.width / 2, clip!.y + clip!.height / 2);
  await page.mouse.down();
  await page.mouse.move(clip!.x + clip!.width / 2 + 25, clip!.y + clip!.height / 2, { steps: 4 });
  await page.mouse.up();
  await expect.poll(() => video.evaluate((element: HTMLVideoElement) => element.paused)).toBe(true);
});

test("source microtimeline follows the video clock without transition lag", async ({ page }) => {
  const project = catalogProject("metropolis-machine");
  project.id = "playhead-handoff-fixture";
  project.sources = [{ ...project.sources[0], id: "feature", durationSeconds: 120 }];
  project.clips = [];
  await page.route("**/api/studio/projects/playhead-handoff-fixture", (route) => route.fulfill({ json: project }));
  await page.goto("/studio/dist/?scene=playhead-handoff-fixture");
  const video = page.locator(".source-preview video");
  await expect.poll(() => video.evaluate((element: HTMLVideoElement) => element.videoWidth)).toBeGreaterThan(0);
  await video.evaluate((element: HTMLVideoElement) => { element.currentTime = 6; });
  await expect.poll(() => video.evaluate((element: HTMLVideoElement) => element.currentTime)).toBeCloseTo(6, 1);
  const timeline = page.getByTestId("source-timeline");
  const rulerTick = page.locator(".source-timeline-wrap .time-ruler span").first();
  await expect.poll(async () => Number(await timeline.getAttribute("data-window-start"))).toBeCloseTo(1, 1);
  await expect(rulerTick).toHaveCSS("transition-duration", "0s");
  await page.getByRole("button", { name: "Play", exact: true }).click();
  await expect(rulerTick).toHaveCSS("transition-duration", "0s");
  await expect(page.locator(".source-playhead")).toHaveCSS("transition-duration", "0s");
  await expect.poll(() => video.evaluate((element: HTMLVideoElement) => element.currentTime)).toBeGreaterThan(6.1);
  await expect.poll(async () => Number(await timeline.getAttribute("data-window-start"))).toBeGreaterThan(1.1);
  await expect.poll(() => page.evaluate(() => {
    const media = document.querySelector(".source-preview video") as HTMLVideoElement;
    const detail = document.querySelector(".source-timeline")!;
    return Math.abs(Number(detail.getAttribute("data-window-start")) - (media.currentTime - 5));
  })).toBeLessThan(0.12);
  await page.getByRole("button", { name: "Pause", exact: true }).click();
  await expect(rulerTick).toHaveCSS("transition-duration", "0s");
});

test("a microtimeline click briefly slides the window to the new playhead", async ({ page }) => {
  const project = catalogProject("metropolis-machine");
  project.id = "micro-jump-fixture";
  project.sources = [{ ...project.sources[0], id: "feature", durationSeconds: 120 }];
  project.clips = [];
  await page.route("**/api/studio/projects/micro-jump-fixture", (route) => route.fulfill({ json: project }));
  await page.goto("/studio/dist/?scene=micro-jump-fixture");
  const video = page.locator(".source-preview video");
  await video.evaluate((element: HTMLVideoElement) => {
    let currentTime = 36;
    Object.defineProperty(element, "currentTime", { configurable: true, get: () => currentTime, set: (time: number) => { currentTime = time; } });
    element.dispatchEvent(new Event("seeked"));
  });
  const timeline = page.getByTestId("source-timeline");
  await expect(timeline).toHaveAttribute("data-window-start", "31.000");
  await page.evaluate(() => {
    const node = document.querySelector('[data-testid="source-timeline"]')!;
    const state = window as typeof window & { jumpSamples?: number[] };
    state.jumpSamples = [];
    const started = performance.now();
    const sample = () => {
      state.jumpSamples!.push(Number(node.getAttribute("data-window-start")));
      if (performance.now() - started < 300) requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
  });
  const bounds = await timeline.boundingBox();
  await timeline.click({ position: { x: bounds!.width * 0.8, y: 4 } });
  await expect.poll(async () => Number(await timeline.getAttribute("data-window-start"))).toBeCloseTo(34, 1);
  await expect(timeline).toHaveAttribute("data-window-animating", "false");
  const samples = await page.evaluate(() => (window as typeof window & { jumpSamples?: number[] }).jumpSamples ?? []);
  expect(samples.some((value) => value > 31.2 && value < 33.8)).toBe(true);
});

test("the ten-second jump buttons slide the detail timeline in both directions", async ({ page }) => {
  const project = catalogProject("metropolis-machine");
  project.id = "button-jump-fixture";
  project.sources = [{ ...project.sources[0], id: "feature", durationSeconds: 120 }];
  project.clips = [];
  await page.route("**/api/studio/projects/button-jump-fixture", (route) => route.fulfill({ json: project }));
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.goto("/studio/dist/?scene=button-jump-fixture");
  const video = page.locator(".source-preview video");
  await video.evaluate((element: HTMLVideoElement) => {
    let currentTime = 36;
    Object.defineProperty(element, "currentTime", { configurable: true, get: () => currentTime, set: (time: number) => { currentTime = time; } });
    element.dispatchEvent(new Event("seeked"));
  });
  const timeline = page.getByTestId("source-timeline");
  await expect(timeline).toHaveAttribute("data-window-start", "31.000");
  const sampleJump = async (button: string, from: number, to: number) => {
    await page.evaluate(() => {
      const node = document.querySelector('[data-testid="source-timeline"]')!;
      const state = window as typeof window & { jumpSamples?: number[] };
      state.jumpSamples = [];
      const started = performance.now();
      const sample = () => {
        state.jumpSamples!.push(Number(node.getAttribute("data-window-start")));
        if (performance.now() - started < 300) requestAnimationFrame(sample);
      };
      requestAnimationFrame(sample);
    });
    await page.getByRole("button", { name: button }).click();
    await expect.poll(async () => Number(await timeline.getAttribute("data-window-start"))).toBeCloseTo(to, 1);
    await expect(timeline).toHaveAttribute("data-window-animating", "false");
    const samples = await page.evaluate(() => (window as typeof window & { jumpSamples?: number[] }).jumpSamples ?? []);
    expect(samples.some((value) => value > Math.min(from, to) + 0.5 && value < Math.max(from, to) - 0.5)).toBe(true);
  };
  await sampleJump("Forward 10 seconds", 31, 41);
  await expect.poll(() => video.evaluate((element: HTMLVideoElement) => element.currentTime)).toBe(46);
  await sampleJump("Back 10 seconds", 41, 31);
  await expect.poll(() => video.evaluate((element: HTMLVideoElement) => element.currentTime)).toBe(36);
});

test("dragging the full-source overview previews ten seconds and seeks once on release", async ({ page }) => {
  const project = catalogProject("metropolis-machine");
  project.id = "macro-drag-fixture";
  project.sources = [{ ...project.sources[0], id: "feature", durationSeconds: 120 }];
  project.clips = [];
  await page.route("**/api/studio/projects/macro-drag-fixture", (route) => route.fulfill({ json: project }));
  await page.goto("/studio/dist/?scene=macro-drag-fixture");
  const video = page.locator(".source-preview video");
  await video.evaluate((element: HTMLVideoElement & { seekWrites?: number[] }) => {
    let currentTime = element.currentTime;
    element.seekWrites = [];
    Object.defineProperty(element, "currentTime", {
      configurable: true,
      get: () => currentTime,
      set: (time: number) => { currentTime = time; element.seekWrites!.push(time); },
    });
  });
  const overview = page.getByTestId("source-overview");
  const timeline = page.getByTestId("source-timeline");
  const bounds = await overview.boundingBox();
  const y = bounds!.y + bounds!.height / 2;
  await page.mouse.move(bounds!.x + bounds!.width * 0.2, y);
  await page.mouse.down();
  await page.mouse.move(bounds!.x + bounds!.width * 0.7, y, { steps: 8 });
  await expect(timeline).toHaveAttribute("data-window-previewing", "true");
  await expect.poll(async () => Number(await timeline.getAttribute("data-window-start"))).toBeCloseTo(79, 0);
  expect(await video.evaluate((element: HTMLVideoElement & { seekWrites?: number[] }) => element.seekWrites)).toEqual([]);
  await page.mouse.up();
  await expect(timeline).toHaveAttribute("data-window-previewing", "false");
  expect(await video.evaluate((element: HTMLVideoElement & { seekWrites?: number[] }) => element.seekWrites)).toEqual([84]);
  await overview.click({ position: { x: bounds!.width * 0.3, y: bounds!.height / 2 } });
  const seekWrites = await video.evaluate((element: HTMLVideoElement & { seekWrites?: number[] }) => element.seekWrites ?? []);
  expect(seekWrites).toHaveLength(2);
  expect(seekWrites[1]).toBeCloseTo(36, 0);
  await expect.poll(async () => Number(await timeline.getAttribute("data-window-start"))).toBeCloseTo(31, 0);
});

test("a slow full-source jump shows a loading ring until the video is ready", async ({ page }) => {
  await useCatalogDefaults(page);
  await page.goto("/studio/");
  const video = page.locator(".source-preview video");
  await expect.poll(() => video.evaluate((element: HTMLVideoElement) => element.readyState)).toBeGreaterThanOrEqual(2);
  await video.evaluate((element: HTMLVideoElement) => {
    let currentTime = element.currentTime;
    Object.defineProperty(element, "currentTime", {
      configurable: true,
      get: () => currentTime,
      set: (time: number) => { currentTime = time; element.dispatchEvent(new Event("seeking")); },
    });
  });
  const overview = page.getByTestId("source-overview");
  const bounds = await overview.boundingBox();
  await overview.click({ position: { x: bounds!.width * 0.7, y: bounds!.height / 2 } });
  await expect.poll(async () => Number(await overview.getAttribute("aria-valuenow"))).toBeGreaterThan(5);
  const loading = page.getByRole("status", { name: "Video loading" });
  await expect(loading).toBeVisible();
  await video.evaluate((element: HTMLVideoElement) => element.dispatchEvent(new Event("seeked")));
  await expect(loading).toHaveCount(0);
  await page.waitForTimeout(180);
  await expect(loading).toHaveCount(0);
  await video.evaluate((element: HTMLVideoElement) => element.dispatchEvent(new Event("waiting")));
  await expect(loading).toBeVisible();
  await video.evaluate((element: HTMLVideoElement) => element.dispatchEvent(new Event("playing")));
  await expect(loading).toHaveCount(0);
});

test("long sources use a 10-second timeline that follows the playhead and edits in visible time", async ({ page }) => {
  const project = catalogProject("metropolis-machine");
  project.id = "long-source-fixture";
  project.name = "Long source fixture";
  project.sources = [{ ...project.sources[0], id: "feature", durationSeconds: 120 }];
  project.clips = [
    { id: "early", sourceId: "feature", label: "Early", inSeconds: 1, outSeconds: 3, color: "#9bd9e8", defaultEndBehavior: "loop" },
    { id: "later", sourceId: "feature", label: "Later", inSeconds: 35, outSeconds: 38, color: "#e3aa80", defaultEndBehavior: "loop" },
  ];
  project.visualLoops = [{ id: "default", name: "Default", length: { bars: 4 }, repeat: true, events: [] }];
  project.defaultLoopId = "default";
  await page.route("**/api/studio/projects/long-source-fixture", (route) => route.fulfill({ json: project }));
  await page.goto("/studio/dist/?scene=long-source-fixture");
  await expect(page.getByLabel("Scene title")).toHaveValue("Long source fixture");
  await expect(page.getByText("Reusable ranges")).toHaveCount(0);
  const timeline = page.getByTestId("source-timeline");
  await expect(timeline).toHaveAttribute("data-window-start", "0.000");
  await expect(timeline).toHaveAttribute("data-window-end", "10.000");
  await expect(page.locator(".clip-range")).toHaveCount(1);
  await expect(page.locator(".clip-range")).toHaveAttribute("data-clip-id", "early");

  const video = page.locator(".source-preview video");
  await video.evaluate((element: HTMLVideoElement) => {
    let currentTime = 0;
    Object.defineProperty(element, "currentTime", { configurable: true, get: () => currentTime, set: (value: number) => { currentTime = value; } });
    element.dispatchEvent(new Event("seeked"));
  });
  const overview = page.getByTestId("source-overview");
  await expect(overview.locator(".source-overview-clip")).toHaveCount(2);
  const bounds = await timeline.boundingBox();
  await timeline.click({ position: { x: bounds!.width * 0.8, y: 4 } });
  await expect(page.locator(".clip-card")).toHaveCount(2);
  expect(Number(await overview.getAttribute("aria-valuenow"))).toBeCloseTo(8, 1);

  const overviewBounds = await overview.boundingBox();
  await overview.click({ position: { x: overviewBounds!.width * 0.3, y: overviewBounds!.height / 2 } });
  expect(Number(await overview.getAttribute("aria-valuenow"))).toBeCloseTo(36, 0);
  await expect.poll(async () => Number(await timeline.getAttribute("data-window-start"))).toBeCloseTo(31, 0);
  await expect.poll(async () => Number(await timeline.getAttribute("data-window-end"))).toBeCloseTo(41, 0);
  await video.evaluate((element: HTMLVideoElement) => { element.currentTime = 36; element.dispatchEvent(new Event("seeked")); });
  await expect(page.locator(".transport-time")).toHaveText("0:36.0");
  await expect(page.locator(".source-timeline-nav")).toHaveCount(0);
  await expect.poll(async () => {
    const centered = await page.locator(".source-playhead").boundingBox();
    const bounds = await timeline.boundingBox();
    return Math.abs(centered!.x - (bounds!.x + bounds!.width / 2));
  }).toBeLessThan(2);
  const detailBounds = await timeline.boundingBox();
  await page.mouse.move(detailBounds!.x + detailBounds!.width / 2, detailBounds!.y + 4);
  await page.mouse.down();
  await page.mouse.move(detailBounds!.x + detailBounds!.width * 0.6, detailBounds!.y + 4, { steps: 5 });
  await page.mouse.up();
  await expect.poll(async () => Number(await overview.getAttribute("aria-valuenow"))).toBeCloseTo(35, 0);
  await expect(page.locator(".clip-card")).toHaveCount(2);
  await video.evaluate((element: HTMLVideoElement) => { element.currentTime = 36; element.dispatchEvent(new Event("seeked")); });
  await page.getByRole("button", { name: "Forward 10 seconds" }).click();
  await expect(timeline).toHaveAttribute("data-window-start", "41.000");
  await page.keyboard.press("ArrowLeft");
  await expect(timeline).toHaveAttribute("data-window-start", "31.000");
  await page.keyboard.press("ArrowRight");
  await expect(timeline).toHaveAttribute("data-window-start", "41.000");
  await page.keyboard.press("ArrowLeft");
  await expect(timeline).toHaveAttribute("data-window-start", "31.000");
  await page.getByRole("textbox", { name: "Scene title" }).focus();
  await page.keyboard.press("ArrowRight");
  await expect(timeline).toHaveAttribute("data-window-start", "31.000");
  await page.getByRole("button", { name: "Play", exact: true }).focus();
  await page.keyboard.press("ArrowRight");
  await expect(timeline).toHaveAttribute("data-window-start", "41.000");
  await page.keyboard.press("ArrowLeft");
  await expect(timeline).toHaveAttribute("data-window-start", "31.000");
  await expect(page.locator(".clip-range")).toHaveCount(1);
  await expect(page.locator(".clip-range")).toHaveAttribute("data-clip-id", "later");
  const visible = await page.locator(".clip-range").boundingBox();
  expect(visible!.width / bounds!.width).toBeCloseTo(0.3, 1);
  await page.mouse.move(visible!.x + visible!.width / 2, visible!.y + visible!.height / 2);
  await page.mouse.down();
  await page.mouse.move(visible!.x + visible!.width / 2 + bounds!.width * 0.1, visible!.y + visible!.height / 2, { steps: 5 });
  await page.mouse.up();
  expect(Number(await page.locator(".inspector-fields .field-row input").first().inputValue())).toBeCloseTo(36, 1);

  await video.evaluate((element: HTMLVideoElement) => { element.currentTime = 119; element.dispatchEvent(new Event("seeked")); });
  await expect(timeline).toHaveAttribute("data-window-start", "110.000");
  await expect(timeline).toHaveAttribute("data-window-end", "120.000");

  await overview.click({ position: { x: overviewBounds!.width * 0.6, y: overviewBounds!.height / 2 } });
  const mark = page.getByRole("button", { name: "Mark new clip" });
  await mark.click();
  await expect(page.getByRole("button", { name: "Finish clip" })).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator(".clip-card")).toHaveCount(2);
  await expect(overview.locator(".source-overview-anchor")).toHaveCount(1);
  await overview.click({ position: { x: overviewBounds!.width * 0.5, y: overviewBounds!.height / 2 } });
  await expect(overview.locator(".source-overview-pending")).toHaveCount(1);
  await page.getByRole("button", { name: "Finish clip" }).click();
  await expect(page.locator(".clip-card")).toHaveCount(3);
  await expect(mark).toHaveAttribute("aria-pressed", "false");
  const createdIn = Number(await page.locator(".inspector-fields .field-row input").first().inputValue());
  const createdOut = Number(await page.locator(".inspector-fields .field-row input").nth(1).inputValue());
  expect(createdIn).toBeCloseTo(60, 0);
  expect(createdOut).toBeCloseTo(72, 0);
  await overview.click({ position: { x: overviewBounds!.width * 0.55, y: overviewBounds!.height / 2 } });
  await expect(page.locator(".inspector-fields")).toHaveCount(0);
  const inRange = await page.locator(".clip-range").last().boundingBox();
  await page.locator(".clip-range").last().click({ position: { x: inRange!.width / 2, y: inRange!.height / 2 } });
  await video.evaluate((element: HTMLVideoElement) => { element.currentTime = 66; element.dispatchEvent(new Event("seeked")); });
  await page.getByRole("button", { name: "Set in" }).click();
  await expect.poll(async () => Number(await page.locator(".inspector-fields .field-row input").first().inputValue())).toBeCloseTo(66, 0);
  await overview.click({ position: { x: overviewBounds!.width * 0.575, y: overviewBounds!.height / 2 } });
  await page.locator(".clip-range").last().click();
  await video.evaluate((element: HTMLVideoElement) => { element.currentTime = 69; element.dispatchEvent(new Event("seeked")); });
  await page.getByRole("button", { name: "Set out" }).click();
  await expect.poll(async () => Number(await page.locator(".inspector-fields .field-row input").nth(1).inputValue())).toBeCloseTo(69, 0);
  await expect(page.locator(".transport-row").getByRole("button", { name: "Set in" })).toHaveCount(0);
  const inputBounds = await page.locator(".clip-time-field input").first().boundingBox();
  const setBounds = await page.getByRole("button", { name: "Set in" }).boundingBox();
  expect(setBounds!.x).toBeGreaterThan(inputBounds!.x + inputBounds!.width / 2);
  expect(setBounds!.x + setBounds!.width).toBeLessThan(inputBounds!.x + inputBounds!.width);
  await expect(page.locator(".clip-time-field input").first()).toHaveCSS("appearance", "textfield");
});

test("source clips play on selection and transport icons show playback state", async ({ page }) => {
  await useCatalogDefaults(page);
  await page.goto("/studio/");
  const video = page.locator(".source-preview video");
  const play = page.getByRole("button", { name: "Play", exact: true });
  const loop = page.getByRole("button", { name: "Loop audition" });
  const cut = page.getByRole("button", { name: "Mark new clip" });
  await expect.poll(() => video.evaluate((element: HTMLVideoElement) => element.videoWidth)).toBeGreaterThan(0);
  expect(await video.evaluate((element: HTMLVideoElement) => element.controls)).toBe(false);
  await expect(video).toHaveCSS("cursor", "pointer");
  await expect(play).toHaveAttribute("aria-pressed", "false");
  const playGlyph = await play.locator("svg path").getAttribute("d");
  await expect(play.locator("svg")).toHaveCSS("stroke", "none");
  await expect(loop.locator("svg.loop-glyph .loop-arc")).toHaveCount(2);
  await expect(loop.locator("svg.loop-glyph .loop-arrowhead")).toHaveCount(2);
  await expect(cut.locator("svg")).toHaveCount(1);
  await expect(cut.locator("svg path")).toHaveCount(1);
  await expect(loop.locator("svg")).toHaveCount(1);
  await expect(page.locator(".source-list .list-card").first()).toContainText("1 clip");
  await play.hover();
  await expect(play).toHaveCSS("background-color", "rgb(38, 81, 91)");

  await page.locator(".clip-range").first().click();
  await expect.poll(() => video.evaluate((element: HTMLVideoElement) => element.currentTime)).toBeGreaterThan(3);
  await expect.poll(() => video.evaluate((element: HTMLVideoElement) => element.paused)).toBe(false);
  await expect(page.getByRole("button", { name: "Stop audition" })).toHaveAttribute("aria-pressed", "true");
  await page.locator(".clip-card").first().click();
  await expect.poll(() => video.evaluate((element: HTMLVideoElement) => element.paused)).toBe(false);
  await expect(page.getByRole("button", { name: "Pause", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("button", { name: "Pause", exact: true })).toHaveClass(/active/);
  await expect(page.getByRole("button", { name: "Pause", exact: true }).locator("svg path")).not.toHaveAttribute("d", playGlyph!);
  await expect(page.getByRole("button", { name: "Pause", exact: true }).locator("svg path")).toHaveAttribute("d", /M6 4h4\.5v16/);
  await expect(page.getByRole("button", { name: "Pause", exact: true }).locator("svg")).toHaveCSS("stroke", "none");
  await expect(page.getByRole("button", { name: "Pause", exact: true })).toHaveCSS("background-color", "rgb(155, 217, 232)");
  await page.getByRole("button", { name: "Pause", exact: true }).click();
  await expect(play).toHaveAttribute("aria-pressed", "false");
  await video.click();
  await expect.poll(() => video.evaluate((element: HTMLVideoElement) => element.paused)).toBe(false);
  await video.click();
  await expect.poll(() => video.evaluate((element: HTMLVideoElement) => element.paused)).toBe(true);

  await video.evaluate((element: HTMLVideoElement) => { element.currentTime = 1; });
  await cut.click();
  await expect(page.getByRole("button", { name: "Finish clip" })).toHaveClass(/active/);
  await expect(page.getByRole("button", { name: "Finish clip" })).toHaveClass(/recording/);
  await expect(page.getByRole("button", { name: "Finish clip" }).locator("svg circle")).toHaveCount(1);
  await page.mouse.move(0, 0);
  await expect(page.getByRole("button", { name: "Finish clip" })).toHaveCSS("background-color", "rgb(76, 32, 36)");
  await expect(page.locator(".clip-card")).toHaveCount(1);
  await video.evaluate((element: HTMLVideoElement) => { element.currentTime = 3; });
  await page.getByRole("button", { name: "Finish clip" }).click();
  await expect(page.locator(".clip-card")).toHaveCount(2);
  await expect(cut).not.toHaveClass(/recording/);
  await expect(cut.locator("svg path")).toHaveCount(1);
  await expect(page.locator(".source-list .list-card").first()).toContainText("2 clips");
  await page.locator(".clip-card").last().click();
  await expect.poll(() => video.evaluate((element: HTMLVideoElement) => element.paused)).toBe(false);
  await expect(page.getByRole("button", { name: "Stop audition" })).toHaveClass(/active/);
  await expect(page.getByRole("button", { name: "Stop audition" })).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "Stop audition" }).hover();
  await expect(page.getByRole("button", { name: "Stop audition" })).toHaveCSS("background-color", "rgb(201, 240, 248)");
  const selectedOut = Number(await page.locator(".inspector-fields .field-row input").nth(1).inputValue());
  const selectedIn = Number(await page.locator(".inspector-fields .field-row input").nth(0).inputValue());
  await video.evaluate((element: HTMLVideoElement, outPoint) => { element.currentTime = outPoint - 0.015; }, selectedOut);
  await expect.poll(() => video.evaluate((element: HTMLVideoElement) => element.currentTime)).toBeLessThan(selectedIn + 0.5);
  await page.getByRole("button", { name: "Pause", exact: true }).click();
  const range = await page.locator(".clip-range").last().boundingBox();
  await page.mouse.move(range!.x + range!.width / 2, range!.y + range!.height / 2);
  await page.mouse.down();
  await page.mouse.move(range!.x + range!.width / 2 + 24, range!.y + range!.height / 2, { steps: 4 });
  await page.mouse.up();
  await expect(page.getByRole("button", { name: "Stop audition" })).toHaveAttribute("aria-pressed", "true");
  await expect.poll(() => video.evaluate((element: HTMLVideoElement) => element.paused)).toBe(true);
  await page.locator(".clip-card").last().click();
  await expect.poll(() => video.evaluate((element: HTMLVideoElement) => element.paused)).toBe(false);
  await page.locator(".clip-card").first().click();
  await expect(page.getByRole("button", { name: "Stop audition" })).toHaveAttribute("aria-pressed", "true");
  await expect.poll(() => video.evaluate((element: HTMLVideoElement) => element.paused)).toBe(false);
  await page.locator(".source-list .list-card").nth(1).click();
  await expect(page.getByRole("button", { name: "Stop audition" })).toHaveAttribute("aria-pressed", "true");
  await expect.poll(() => video.evaluate((element: HTMLVideoElement) => element.paused)).toBe(false);
  await page.locator(".clip-card").first().click();
  await expect.poll(() => video.evaluate((element: HTMLVideoElement) => element.paused)).toBe(false);
  await expect(page.getByRole("button", { name: "Stop audition" })).toHaveClass(/active/);
  await page.getByRole("button", { name: "Pause", exact: true }).click();
  await expect(page.getByRole("button", { name: "Stop audition" })).toHaveAttribute("aria-pressed", "true");
  await expect.poll(() => video.evaluate((element: HTMLVideoElement) => element.paused)).toBe(true);
  await page.waitForTimeout(150);
  expect(await video.evaluate((element: HTMLVideoElement) => element.paused)).toBe(true);
  await page.getByRole("button", { name: "Stop audition" }).click();
  await expect(page.getByRole("button", { name: "Loop audition" })).toHaveAttribute("aria-pressed", "false");
  await page.locator(".clip-range").first().click();
  await expect(page.getByRole("button", { name: "Stop audition" })).toHaveAttribute("aria-pressed", "true");
});

test("clicking the loop video toggles preview playback", async ({ page }) => {
  await useCatalogDefaults(page);
  await page.goto("/studio/");
  await page.getByRole("button", { name: /Loop Builder/ }).click();
  const preview = page.locator(".loop-preview");
  await expect(page.getByRole("button", { name: "Play preview" })).toBeVisible();
  await preview.click();
  await expect(page.getByRole("button", { name: "Pause preview" })).toBeVisible();
  await preview.click();
  await expect(page.getByRole("button", { name: "Play preview" })).toBeVisible();
});

test("loop edits keep the playing video element and its timeline position", async ({ page }) => {
  await useCatalogDefaults(page);
  await page.route("**/api/studio/projects/metropolis-machine/prepare", (route) => route.fulfill({ json: { media: {}, created: 0, reused: 0, removed: 0, warnings: [] } }));
  await page.goto("/studio/");
  await page.getByRole("button", { name: /Loop Builder/ }).click();
  await expect(page.locator(".loop-preview video.is-visible")).toHaveCount(1);
  await page.getByRole("button", { name: "Play preview" }).click();
  const video = page.locator(".loop-preview video.is-visible");
  await expect.poll(() => video.evaluate((node: HTMLVideoElement) => node.currentTime)).toBeGreaterThan(0.1);
  await page.evaluate(() => {
    const state = window as typeof window & { previewVideo?: HTMLVideoElement; previewSeeks?: number };
    state.previewVideo = document.querySelector(".loop-preview video.is-visible") as HTMLVideoElement;
    state.previewSeeks = 0;
    state.previewVideo.addEventListener("seeking", () => { state.previewSeeks = (state.previewSeeks ?? 0) + 1; });
  });
  await page.getByRole("textbox", { name: "Loop name" }).pressSequentially(" remix", { delay: 30 });
  expect(await page.evaluate(() => document.querySelector(".loop-preview video.is-visible") === (window as typeof window & { previewVideo?: HTMLVideoElement }).previewVideo)).toBe(true);
  await page.locator(".loop-event").first().click();
  await page.getByRole("slider", { name: "Opacity" }).fill("70");
  expect(await page.evaluate(() => document.querySelector(".loop-preview video.is-visible") === (window as typeof window & { previewVideo?: HTMLVideoElement }).previewVideo)).toBe(true);
  expect(await page.evaluate(() => (window as typeof window & { previewSeeks?: number }).previewSeeks)).toBe(0);
  await expect.poll(() => video.evaluate((node: HTMLVideoElement) => node.paused)).toBe(false);
});

test("clicking empty Loop Builder timeline seeks the preview and moves its cursor", async ({ page }) => {
  await useCatalogDefaults(page);
  await page.route("**/api/studio/projects/metropolis-machine/prepare", (route) => route.fulfill({ json: { media: {}, created: 0, reused: 0, removed: 0, warnings: [] } }));
  await page.goto("/studio/");
  await page.getByRole("button", { name: /Loop Builder/ }).click();
  const timeline = page.getByTestId("loop-timeline");
  const bounds = await timeline.boundingBox();
  expect(bounds).not.toBeNull();
  await page.mouse.click(bounds!.x + bounds!.width * 0.75, bounds!.y + bounds!.height - 8);
  const length = Number(await page.getByTestId("preview-scrub").getAttribute("aria-valuemax"));
  await expect.poll(async () => Number(await page.getByTestId("preview-scrub").getAttribute("aria-valuenow"))).toBeGreaterThan(length * 0.74);
  await expect.poll(async () => Number.parseFloat(await timeline.locator(".loop-playhead").evaluate((node: HTMLElement) => node.style.left))).toBeGreaterThan(74);
  await expect.poll(() => page.locator(".loop-preview video.is-visible").evaluate((node: HTMLVideoElement) => node.currentTime)).toBeGreaterThan(1.5);
  await page.getByRole("button", { name: "Play preview" }).click();
  await page.mouse.click(bounds!.x + bounds!.width * 0.25, bounds!.y + bounds!.height - 8);
  await expect.poll(async () => Number(await page.getByTestId("preview-scrub").getAttribute("aria-valuenow"))).toBeLessThan(length * 0.35);
  await expect.poll(async () => Number.parseFloat(await timeline.locator(".loop-playhead").evaluate((node: HTMLElement) => node.style.left))).toBeLessThan(35);
  await expect.poll(() => page.locator(".loop-preview video.is-visible").evaluate((node: HTMLVideoElement) => node.currentTime)).toBeLessThan(1);
  await page.getByRole("button", { name: "Pause preview" }).click();
  const eventLeft = await timeline.locator(".loop-event").first().evaluate((node: HTMLElement) => node.style.left);
  await page.mouse.move(bounds!.x + bounds!.width * 0.2, bounds!.y + bounds!.height - 8);
  await page.mouse.down();
  await page.mouse.move(bounds!.x + bounds!.width * 0.55, bounds!.y + bounds!.height - 8, { steps: 8 });
  await expect.poll(async () => Number.parseFloat(await timeline.locator(".loop-playhead").evaluate((node: HTMLElement) => node.style.left))).toBeGreaterThan(54);
  await page.mouse.move(bounds!.x + bounds!.width * 0.82, bounds!.y + bounds!.height - 8, { steps: 8 });
  await page.mouse.up();
  await expect.poll(async () => Number.parseFloat(await timeline.locator(".loop-playhead").evaluate((node: HTMLElement) => node.style.left))).toBeGreaterThan(81);
  await expect.poll(() => page.locator(".loop-preview video.is-visible").evaluate((node: HTMLVideoElement) => node.currentTime)).toBeGreaterThan(1.8);
  expect(await timeline.locator(".loop-event").first().evaluate((node: HTMLElement) => node.style.left)).toBe(eventLeft);
});

test("the loop preview shows a loader while its active video has no frame", async ({ page }) => {
  await useCatalogDefaults(page);
  await page.goto("/studio/");
  await page.getByRole("button", { name: /Loop Builder/ }).click();
  const video = page.locator(".loop-preview video.is-visible").first();
  await expect.poll(() => video.evaluate((element: HTMLVideoElement) => element.readyState)).toBeGreaterThanOrEqual(2);
  const loading = page.getByRole("status", { name: "Loop video loading" });
  await expect(loading).toHaveCount(0);
  await video.evaluate((element: HTMLVideoElement) => Object.defineProperty(element, "readyState", { configurable: true, get: () => 0 }));
  await page.getByRole("button", { name: "Play preview" }).click();
  await expect.poll(async () => Number(await page.getByTestId("preview-scrub").getAttribute("aria-valuenow"))).toBeGreaterThan(0.1);
  await expect(loading).toBeVisible();
  await video.evaluate((element: HTMLVideoElement) => { delete (element as HTMLVideoElement & { readyState?: number }).readyState; });
  await expect(loading).toHaveCount(0);
});

test("opacity controls layer visibility without a mode dropdown and inspector selects have caret space", async ({ page }) => {
  await useCatalogDefaults(page);
  await page.goto("/studio/");
  const sourceSelect = page.locator(".sources-workspace .inspector select").first();
  await expect(sourceSelect).toHaveCSS("appearance", "none");
  await expect(sourceSelect).toHaveCSS("padding-right", "38px");
  await expect(sourceSelect).toHaveCSS("background-image", /svg/);

  await page.getByRole("button", { name: /Loop Builder/ }).click();
  await page.locator(".loop-list-select").filter({ hasText: /Cue A · Sequence/ }).click();
  await expect(page.getByRole("combobox", { name: "Visibility" })).toHaveCount(0);
  await page.locator(".loop-event").first().click();
  await expect(page.getByRole("combobox", { name: "Clip", exact: true })).toHaveCSS("padding-right", "38px");
  for (const event of await page.locator(".loop-event").all()) {
    await event.click();
    await expect(page.getByRole("slider", { name: "Opacity" })).toHaveValue("100");
  }
  const opacity = page.getByRole("slider", { name: "Opacity" });
  await opacity.focus();
  await page.keyboard.press("Home");
  await expect(opacity).toHaveValue("0");
  await page.locator(".clip-strip button").last().dblclick();
  await expect(page.getByRole("slider", { name: "Opacity" })).toHaveValue("100");

});

test("clip cards and timeline bars loop on click, while source seeks and the loop toggle exit audition", async ({ page }) => {
  const project = catalogProject("metropolis-machine");
  project.id = "clip-exit-fixture";
  project.name = "Clip exit fixture";
  project.sources = [{ ...project.sources[0], id: "feature" }];
  project.clips = [{ id: "short", sourceId: "feature", label: "Short preview", inSeconds: 1, outSeconds: 2, color: "#9bd9e8", defaultEndBehavior: "loop" }];
  project.visualLoops = [{ id: "default", name: "Default", length: { bars: 4 }, repeat: true, events: [] }];
  project.defaultLoopId = "default";
  await page.route("**/api/studio/projects/clip-exit-fixture", (route) => route.fulfill({ json: project }));
  await page.goto("/studio/dist/?scene=clip-exit-fixture");
  const video = page.locator(".source-preview video");
  await expect.poll(() => video.evaluate((element: HTMLVideoElement) => element.videoWidth)).toBeGreaterThan(0);
  const clipCard = page.locator(".clip-card").first();
  await expect(clipCard).toContainText("0:01.0 · 1.00 sec");
  await clipCard.click();
  await expect.poll(() => video.evaluate((element: HTMLVideoElement) => element.paused)).toBe(false);
  await expect(page.getByRole("button", { name: "Stop audition" })).toHaveAttribute("aria-pressed", "true");
  await video.evaluate((element: HTMLVideoElement) => { element.currentTime = 1.96; });
  await expect.poll(() => video.evaluate((element: HTMLVideoElement) => element.currentTime)).toBeLessThan(1.7);

  await page.getByRole("button", { name: "Stop audition" }).click();
  await expect(page.getByRole("button", { name: "Loop audition" })).toHaveAttribute("aria-pressed", "false");
  await video.evaluate((element: HTMLVideoElement) => { element.currentTime = 1.96; });
  await expect.poll(() => video.evaluate((element: HTMLVideoElement) => element.currentTime)).toBeGreaterThan(2.2);

  const clipRange = page.locator(".clip-range").first();
  await clipRange.click();
  await expect(page.getByRole("button", { name: "Stop audition" })).toHaveAttribute("aria-pressed", "true");
  await expect.poll(() => video.evaluate((element: HTMLVideoElement) => element.currentTime)).toBeLessThan(2);
  await video.evaluate((element: HTMLVideoElement) => { element.currentTime = 1.96; });
  await expect.poll(() => video.evaluate((element: HTMLVideoElement) => element.currentTime)).toBeLessThan(1.7);
  await page.getByRole("button", { name: "Pause", exact: true }).click();

  const overview = page.getByTestId("source-overview");
  const overviewBounds = await overview.boundingBox();
  await overview.click({ position: { x: overviewBounds!.width * 0.55, y: overviewBounds!.height / 2 } });
  await expect(page.locator(".clip-card.selected")).toHaveCount(0);
  await expect(page.locator(".inspector-fields")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Loop audition" })).toBeDisabled();
  await expect.poll(() => video.evaluate((element: HTMLVideoElement) => element.currentTime)).toBeGreaterThan(4);
  await page.getByRole("button", { name: "Play", exact: true }).click();
  await expect.poll(() => video.evaluate((element: HTMLVideoElement) => element.currentTime)).toBeGreaterThan(4.2);
  await expect.poll(() => video.evaluate((element: HTMLVideoElement) => element.paused)).toBe(false);
  await page.getByRole("button", { name: "Pause", exact: true }).click();

  await clipCard.click();
  await expect(page.getByRole("button", { name: "Stop audition" })).toHaveAttribute("aria-pressed", "true");
  await video.evaluate((element: HTMLVideoElement) => { element.currentTime = 1.96; });
  await expect.poll(() => video.evaluate((element: HTMLVideoElement) => element.currentTime)).toBeLessThan(1.7);
  await page.getByRole("button", { name: "Stop audition" }).click();
  await expect.poll(() => video.evaluate((element: HTMLVideoElement) => element.currentTime)).toBeGreaterThan(2.2);
  await clipCard.click();
  await expect(page.getByRole("button", { name: "Stop audition" })).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "Pause", exact: true }).click();
  const detail = page.getByTestId("source-timeline");
  const detailBounds = await detail.boundingBox();
  await detail.click({ position: { x: detailBounds!.width * 0.75, y: 4 } });
  await expect(page.locator(".clip-card.selected")).toHaveCount(0);
  await expect(page.locator(".inspector-fields")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Loop audition" })).toBeDisabled();
  await expect.poll(() => video.evaluate((element: HTMLVideoElement) => element.currentTime)).toBeGreaterThan(5);
});

test("a second Record click cancels at an unchanged paused playhead, but moved edges create a clip", async ({ page }) => {
  await useCatalogDefaults(page);
  await page.goto("/studio/");
  const video = page.locator(".source-preview video");
  await expect.poll(() => video.evaluate((element: HTMLVideoElement) => element.videoWidth)).toBeGreaterThan(0);
  await video.evaluate((element: HTMLVideoElement) => { element.pause(); element.currentTime = 2; });
  await expect.poll(() => video.evaluate((element: HTMLVideoElement) => element.currentTime)).toBeCloseTo(2, 1);
  const initialClipCount = await page.locator(".clip-card").count();
  await page.getByRole("button", { name: "Mark new clip" }).click();
  await expect(page.getByRole("button", { name: "Finish clip" })).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator(".source-overview-anchor")).toHaveCount(1);
  await page.getByRole("button", { name: "Finish clip" }).click();
  await expect(page.getByRole("button", { name: "Mark new clip" })).toHaveAttribute("aria-pressed", "false");
  await expect(page.locator(".source-overview-anchor")).toHaveCount(0);
  await expect(page.locator(".clip-card")).toHaveCount(initialClipCount);

  await page.getByRole("button", { name: "Mark new clip" }).click();
  await video.evaluate((element: HTMLVideoElement) => { element.currentTime = 4; });
  await expect.poll(() => video.evaluate((element: HTMLVideoElement) => element.currentTime)).toBeCloseTo(4, 1);
  await page.getByRole("button", { name: "Finish clip" }).click();
  await expect(page.locator(".clip-card")).toHaveCount(initialClipCount + 1);
  await expect(page.locator(".inspector-fields .field-row input").first()).toHaveValue("2.000");
  await expect(page.locator(".inspector-fields .field-row input").nth(1)).toHaveValue("4.000");

  await video.evaluate((element: HTMLVideoElement) => { element.currentTime = 6; });
  await expect.poll(() => video.evaluate((element: HTMLVideoElement) => element.currentTime)).toBeCloseTo(6, 1);
  await page.getByRole("button", { name: "Mark new clip" }).click();
  await video.evaluate((element: HTMLVideoElement) => { element.currentTime = 5; });
  await expect.poll(() => video.evaluate((element: HTMLVideoElement) => element.currentTime)).toBeCloseTo(5, 1);
  await page.getByRole("button", { name: "Finish clip" }).click();
  await expect(page.locator(".clip-card")).toHaveCount(initialClipCount + 2);
  await expect(page.locator(".inspector-fields .field-row input").first()).toHaveValue("5.000");
  await expect(page.locator(".inspector-fields .field-row input").nth(1)).toHaveValue("6.000");
});

test("marking both clip edges during playback does not pause the source", async ({ page }) => {
  await useCatalogDefaults(page);
  await page.goto("/studio/");
  const video = page.locator(".source-preview video");
  await expect.poll(() => video.evaluate((element: HTMLVideoElement) => element.videoWidth)).toBeGreaterThan(0);
  await video.evaluate((element: HTMLVideoElement) => { element.currentTime = 1; });
  await page.getByRole("button", { name: "Play", exact: true }).click();
  await expect.poll(() => video.evaluate((element: HTMLVideoElement) => element.paused)).toBe(false);
  await page.getByRole("button", { name: "Mark new clip" }).click();
  await expect(page.getByRole("button", { name: "Finish clip" })).toHaveClass(/active/);
  await expect.poll(() => video.evaluate((element: HTMLVideoElement) => element.paused)).toBe(false);
  await video.evaluate((element: HTMLVideoElement) => { element.currentTime = 3; });
  await page.getByRole("button", { name: "Finish clip" }).click();
  await expect(page.locator(".clip-card")).toHaveCount(2);
  await expect.poll(() => video.evaluate((element: HTMLVideoElement) => element.paused)).toBe(false);
});

test("Space toggles source and loop playback once, except while editing", async ({ page }) => {
  await useCatalogDefaults(page);
  await page.goto("/studio/");
  const video = page.locator(".source-preview video");
  await expect.poll(() => video.evaluate((element: HTMLVideoElement) => element.videoWidth)).toBeGreaterThan(0);
  await video.focus();
  await page.keyboard.press("Space");
  await expect.poll(() => video.evaluate((element: HTMLVideoElement) => element.paused)).toBe(false);
  await page.keyboard.press("Space");
  await expect.poll(() => video.evaluate((element: HTMLVideoElement) => element.paused)).toBe(true);
  await page.locator(".inspector-fields input").first().focus();
  await page.keyboard.press("Space");
  await expect.poll(() => video.evaluate((element: HTMLVideoElement) => element.paused)).toBe(true);
  await page.getByRole("button", { name: "Play", exact: true }).focus();
  await page.keyboard.press("Space");
  await expect.poll(() => video.evaluate((element: HTMLVideoElement) => element.paused)).toBe(false);

  await page.getByRole("button", { name: /Loop Builder/ }).click();
  const playPreview = page.getByRole("button", { name: "Play preview" });
  await expect(playPreview).toBeVisible();
  await playPreview.focus();
  await page.keyboard.press("Space");
  await expect(page.getByRole("button", { name: "Pause preview" })).toBeVisible();
  await page.getByRole("button", { name: "Pause preview" }).focus();
  await page.keyboard.press("Space");
  await expect(playPreview).toBeVisible();
  await page.locator(".loop-editor input[type='number']").first().focus();
  await page.keyboard.press("Space");
  await expect(playPreview).toBeVisible();

});

test("loop mode toggles without starting, stopping, or seeking playback", async ({ page }) => {
  await useCatalogDefaults(page);
  await page.goto("/studio/");
  const video = page.locator(".source-preview video");
  await expect.poll(() => video.evaluate((element: HTMLVideoElement) => element.videoWidth)).toBeGreaterThan(0);
  await video.evaluate((element: HTMLVideoElement) => { element.currentTime = 1.25; });
  await expect.poll(() => video.evaluate((element: HTMLVideoElement) => element.currentTime)).toBeGreaterThan(1.2);
  await page.getByRole("button", { name: "Loop audition" }).click();
  await expect(page.getByRole("button", { name: "Stop audition" })).toHaveAttribute("aria-pressed", "true");
  expect(await video.evaluate((element: HTMLVideoElement) => ({ paused: element.paused, time: element.currentTime }))).toMatchObject({ paused: true, time: 1.25 });
  await page.getByRole("button", { name: "Stop audition" }).click();
  expect(await video.evaluate((element: HTMLVideoElement) => ({ paused: element.paused, time: element.currentTime }))).toMatchObject({ paused: true, time: 1.25 });

  await page.getByRole("button", { name: "Play", exact: true }).click();
  await expect.poll(() => video.evaluate((element: HTMLVideoElement) => element.paused)).toBe(false);
  await video.evaluate((element: HTMLVideoElement) => { element.currentTime = 2; });
  await page.getByRole("button", { name: "Loop audition" }).click();
  await expect.poll(() => video.evaluate((element: HTMLVideoElement) => element.paused)).toBe(false);
  expect(await video.evaluate((element: HTMLVideoElement) => element.currentTime)).toBeGreaterThanOrEqual(2);
  await page.getByRole("button", { name: "Stop audition" }).click();
  await expect.poll(() => video.evaluate((element: HTMLVideoElement) => element.paused)).toBe(false);
  expect(await video.evaluate((element: HTMLVideoElement) => element.currentTime)).toBeGreaterThanOrEqual(2);
  await video.evaluate((element: HTMLVideoElement) => { element.currentTime = 7.9; });
  await expect.poll(() => video.evaluate((element: HTMLVideoElement) => element.paused)).toBe(true);
});

test("authors clip ranges, loop instances, cue mappings, and publishes", async ({ page }) => {
  let savedProject: any = null;
  let publishedScene: any = null;
  await page.route("**/api/studio/projects", (route) => route.fulfill({ json: savedProject ? [{ id: savedProject.id, name: savedProject.name, updatedAt: savedProject.updatedAt }] : [] }));
  await page.route("**/api/studio/projects/metropolis-machine", (route) => {
    if (route.request().method() === "GET") return savedProject ? route.fulfill({ json: savedProject }) : route.fulfill({ status: 404, body: "Not saved" });
    savedProject = JSON.parse(route.request().postData() ?? "null");
    return route.fulfill({ json: { id: savedProject.id, saved: true } });
  });
  await page.route("**/api/studio/projects/metropolis-machine/publish", (route) => {
    publishedScene = JSON.parse(route.request().postData() ?? "null");
    return route.fulfill({ json: { file: "/api/studio/projects/metropolis-machine/published" } });
  });
  await page.goto("/studio/");
  await expect(page.getByText("Scene Studio", { exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Robot reveal" })).toBeVisible();
  await expect(page.locator(".source-list .list-card")).toHaveCount(12);
  await expect(page.locator(".clip-card")).toHaveCount(1);
  await expect(page.locator(".clip-range").first()).toHaveCSS("opacity", "0.9");
  await expect(page.getByRole("link", { name: "Original film page" })).toHaveAttribute("href", /wikisource/);

  await page.getByRole("button", { name: "Loop audition" }).click();
  await expect(page.getByRole("button", { name: "Stop audition" })).toHaveAttribute("aria-pressed", "true");
  await expect.poll(() => page.locator(".source-preview video").evaluate((video: HTMLVideoElement) => video.paused)).toBe(true);
  await page.getByRole("button", { name: "Play", exact: true }).click();
  await expect.poll(() => page.locator(".source-preview video").evaluate((video: HTMLVideoElement) => ({ paused: video.paused, time: video.currentTime }))).toMatchObject({ paused: false });
  await expect.poll(() => page.locator(".source-preview video").evaluate((video: HTMLVideoElement) => video.currentTime)).toBeGreaterThan(0.05);
  await expect.poll(() => page.locator(".source-playhead").evaluate((element: HTMLElement) => Number.parseFloat(element.style.left))).toBeGreaterThan(1);
  await page.locator(".source-preview video").evaluate((video: HTMLVideoElement) => { video.currentTime = 7.9; });
  await expect.poll(() => page.locator(".source-preview video").evaluate((video: HTMLVideoElement) => video.currentTime)).toBeLessThan(0.9);
  await page.getByRole("button", { name: "Stop audition" }).click();
  await expect.poll(() => page.locator(".source-preview video").evaluate((video: HTMLVideoElement) => video.paused)).toBe(false);
  await page.getByRole("button", { name: "Pause", exact: true }).click();
  await expect.poll(() => page.locator(".source-preview video").evaluate((video: HTMLVideoElement) => video.paused)).toBe(true);

  await page.locator(".source-preview video").evaluate((video: HTMLVideoElement) => { video.currentTime = 1; });
  await page.getByRole("button", { name: "Mark new clip" }).click();
  await page.locator(".source-preview video").evaluate((video: HTMLVideoElement) => { video.currentTime = 3; });
  await page.getByRole("button", { name: "Finish clip" }).click();
  await expect(page.locator(".clip-card")).toHaveCount(2);
  await expect(page.locator(".inspector-fields .field-row input").nth(0)).toHaveValue(/^\d+\.\d{3}$/);
  await expect(page.locator(".inspector-fields .field-row input").nth(1)).toHaveValue(/^\d+\.\d{3}$/);

  await page.getByRole("button", { name: /Loop Builder/ }).click();
  await expect(page.getByRole("heading", { name: /Default/ })).toBeVisible();
  const beforeEvents = await page.locator(".loop-event").count();
  await page.locator(".clip-strip button").last().dblclick();
  await expect(page.locator(".loop-event")).toHaveCount(beforeEvents + 1);
  await expect(page.getByText("Clip instance", { exact: true })).toBeVisible();
  await page.getByText("Slow zoom & pan").click();
  await expect(page.getByRole("button", { name: "Pan and zoom target" })).toBeVisible();
  const motionSpeed = page.getByRole("slider", { name: "Motion speed" });
  await motionSpeed.focus();
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("ArrowRight");
  await expect(motionSpeed).toHaveValue("2");
  const zoomAmount = page.getByRole("slider", { name: "Zoom amount" });
  await zoomAmount.focus();
  await page.keyboard.press("End");
  await expect(zoomAmount).toHaveValue("300");
  const preview = page.locator(".loop-preview");
  const previewBox = await preview.boundingBox();
  expect(previewBox).not.toBeNull();
  await page.mouse.click(previewBox!.x + previewBox!.width * 0.76, previewBox!.y + previewBox!.height * 0.31);
  await expect(page.locator(".motion-target-readout")).toContainText("76%, 31%");
  await expect(page.getByRole("button", { name: "Play preview" })).toBeVisible();
  await page.screenshot({ path: "studio/test-results/loop-motion.png", fullPage: true });

  await expect(page.locator(".loop-list-card")).toHaveCount(8);
  await expect(page.locator(".loop-cue-badge").first()).toHaveText("A");
  await expect(page.locator(".loop-cue-badge").last()).toHaveText("H");

  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.locator(".status-bar")).toContainText("Saved");
  await page.getByRole("button", { name: "Publish", exact: true }).click();
  await expect(page.locator(".status-bar")).toContainText("Published for Live Console");
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem("video-sync-published-scene") ?? "null")?.schemaVersion)).toBe(4);

  expect(savedProject.clips).toHaveLength(13);
  expect(publishedScene.visualLoops).toHaveLength(8);
  expect(publishedScene.cueBindings.map((binding: { visual: { loopId: string } }) => binding.visual.loopId)).toEqual(savedProject.visualLoops.map((loop: { id: string }) => loop.id));
  expect(publishedScene.cueBindings.every((binding: { cue: { type: string } }) => binding.cue.type === "auto")).toBe(true);
  expect(publishedScene.lanePriority).toBe("top");
  expect(publishedScene.visualLoops[0].events[0].lane).toBe(0);
  expect(publishedScene.visualLoops.find((loop: { id: string }) => loop.id === "cue-e-loop")?.compositing).toBeUndefined();
  expect(publishedScene.randomLoop.fit).toBe("contain");
  expect(publishedScene.sourcePage).toContain("wikisource.org");
  const authoredMotion = publishedScene.visualLoops.flatMap((loop: { events: Array<{ id: string; appearance: { motion?: { speed?: number; end: { focus: { x: number; y: number } } } } }> }) => loop.events).find((event: { id: string }) => event.id === "event-2")?.appearance.motion;
  expect(authoredMotion?.speed).toBe(2);
  expect(authoredMotion?.end.scale).toBe(4);
  expect(authoredMotion?.end.focus.x).toBeCloseTo(0.76, 1);
  expect(authoredMotion?.end.focus.y).toBeCloseTo(0.31, 1);

  await page.screenshot({ path: "studio/test-results/scene-studio.png", fullPage: true });
  await page.reload();
  await expect(page.locator(".status-bar")).toContainText("Local session restored · Metropolis Machine");
  await expect(page.getByRole("button", { name: /Loop Builder/ })).toHaveClass(/active/);
  await page.getByRole("button", { name: /Sources & Clips/ }).click();
  await expect(page.locator(".clip-card")).toHaveCount(2);
  await expect(page.getByRole("button", { name: "Reload saved" })).toBeEnabled();
  await page.locator(".inspector-fields input").first().fill("Temporary unsaved rename");
  page.once("dialog", (dialog) => void dialog.accept());
  await page.getByRole("button", { name: "Reload saved" }).click();
  await expect(page.locator(".clip-card").first()).toContainText("Robot reveal");
});

test("opens three real film scenes across all workspaces and keeps unsaved drafts while switching", async ({ page }) => {
  await useCatalogDefaults(page);
  await page.goto("/studio/");
  await expect(page.getByRole("textbox", { name: "Scene title" })).toHaveValue("Metropolis Machine");
  await expect(page.locator(".app-header .scene-open")).toBeVisible();
  await expect(page.locator(".app-header .scene-open")).toHaveText("");
  await expect(page.locator(".app-header .scene-open svg")).toHaveCount(1);
  await page.getByRole("button", { name: "Change scene" }).click();
  await page.getByRole("searchbox", { name: "Search scenes" }).fill("moon");
  await expect(page.locator(".scene-dialog-list button")).toHaveCount(2);
  await expect(page.locator('[data-scene-id="trip-to-the-moon"]')).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog", { name: "Select scene" })).toHaveCount(0);
  for (const [id, firstClip, sourceDomain] of [
    ["metropolis-machine", "Robot reveal", "wikisource"],
    ["trip-to-the-moon", "Moon-face impact", "wikimedia"],
    ["nosferatu", "Orlok doorway", "archive.org"],
  ]) {
    await selectScene(page, id);
    await expect(page.getByRole("textbox", { name: "Scene title" })).toHaveValue(id === "metropolis-machine" ? "Metropolis Machine" : id === "trip-to-the-moon" ? "A Trip to the Moon" : "Nosferatu");
    await expect(page.locator(".status-bar")).toContainText("12 sources · 12 clips · 8 loops");
    await expect(page.locator(".source-list .list-card")).toHaveCount(12);
    await expect(page.locator(".clip-card").first()).toContainText(firstClip);
    await page.locator(".source-list .list-card").last().click();
    await expect(page.locator(".clip-card")).toHaveCount(1);
    await expect(page.locator(".source-editor h2")).not.toHaveText(firstClip);
    await page.locator(".source-list .list-card").first().click();
    await expect(page.locator(".clip-card").first()).toContainText(firstClip);
    await expect(page.getByRole("link", { name: "Original film page" })).toHaveAttribute("href", new RegExp(sourceDomain));
    const mediaPath = await page.locator(".source-preview video").getAttribute("src");
    expect(mediaPath).toMatch(/^\/assets\/scenes\//);
    expect((await page.request.head(mediaPath!)).ok()).toBeTruthy();
    await page.getByRole("button", { name: /Loop Builder/ }).click();
    await expect(page.locator(".loop-list .list-card")).toHaveCount(8);
    await expect(page.locator(".clip-strip button")).toHaveCount(12);
    if (id === "metropolis-machine") {
      await page.locator(".loop-list-select").filter({ hasText: /Cue E · Crossfade/ }).click();
      await expect(page.getByRole("combobox", { name: "Visibility" })).toHaveCount(0);
      await expect(page.locator(".loop-preview video")).toHaveCount(2);
    }
    await expect(page.locator(".loop-cue-badge").first()).toHaveText("A");
    await expect(page.locator(".loop-cue-badge").last()).toHaveText("H");
    await expect(page.locator(".loop-default-button.active")).toHaveCount(1);
    await page.getByRole("button", { name: /Sources & Clips/ }).click();
  }
  await selectScene(page, "metropolis-machine");
  await page.locator(".inspector-fields input").first().fill("Robot reveal remix");
  await expect(page.getByRole("dialog", { name: "Change clip cut?" })).toHaveCount(0);
  await expect(page.locator(".status-bar")).toContainText("Unsaved edits");
  await selectScene(page, "trip-to-the-moon");
  await selectScene(page, "metropolis-machine");
  await expect(page.locator(".clip-card").first()).toContainText("Robot reveal remix");
  await expect(page.locator(".status-bar")).toContainText("Draft edits restored");
});

test("picker opens the full playable catalog and source-needed starters", async ({ page }) => {
  await useCatalogDefaults(page);
  await page.goto("/studio/");
  await page.getByRole("button", { name: "Change scene" }).click();
  await expect(page.locator(".scene-dialog-list button")).toHaveCount(36);
  await expect(page.locator(".scene-dialog-list button", { hasText: "Needs source video" })).toHaveCount(8);
  await page.locator('[data-scene-id="gumby-clay-trip"]').click();
  await expect(page.getByRole("textbox", { name: "Scene title" })).toHaveValue("Gumby Clay Trip");
  await expect(page.locator(".status-bar")).toContainText("12 sources · 12 clips · 8 loops");
  await expect(page.locator(".source-preview video")).toHaveAttribute("src", /gumby-clay-trip\/clip-1\.mp4$/);
  await page.getByRole("button", { name: /Loop Builder/ }).click();
  await expect(page.locator(".loop-list .list-card")).toHaveCount(8);
  await page.getByRole("button", { name: "Change scene" }).click();
  await page.getByRole("searchbox", { name: "Search scenes" }).fill("Barbarella");
  await expect(page.locator(".scene-dialog-list button")).toHaveCount(1);
  await page.locator('[data-scene-id="barbarella"]').click();
  await expect(page.getByRole("textbox", { name: "Scene title" })).toHaveValue("Barbarella");
  await expect(page.locator(".status-bar")).toContainText("0 sources · 0 clips · 1 loops");
  await page.getByRole("button", { name: /Sources & Clips/ }).click();
  await expect(page.getByText("Import a long source video to begin.")).toBeVisible();
  await page.getByRole("button", { name: "Publish" }).click();
  await expect(page.locator(".status-bar")).toContainText("Add video clips to a loop before publishing");
});

test("Live Console loads multiple published scenes from the local server", async ({ page }) => {
  const first = compileRuntimeScene(catalogProject("metropolis-machine"));
  const second = compileRuntimeScene(catalogProject("trip-to-the-moon"));
  first.name = "Published Metropolis";
  second.name = "Published Moon";
  await page.route("**/api/studio/published", (route) => route.fulfill({ json: [first, second] }));
  await page.goto("/poc/");
  const names = await page.evaluate(async () => {
    const { sceneById } = await import("/poc/scene-registry.mjs");
    return [sceneById("metropolis-machine").name, sceneById("trip-to-the-moon").name];
  });
  expect(names).toEqual(["Published Metropolis", "Published Moon"]);
});

test("direct scene links open unsaved catalog scenes", async ({ page }) => {
  await useCatalogDefaults(page);
  await page.goto("/studio/?scene=three-bad-men");
  await expect(page.getByRole("textbox", { name: "Scene title" })).toHaveValue("3 Bad Men");
  await expect(page.locator(".status-bar")).toContainText("12 sources · 12 clips · 8 loops");
});

test("duplicates instances immediately after the original and lets reordered lanes control preview", async ({ page }) => {
  await useCatalogDefaults(page);
  await page.goto("/studio/");
  await page.getByRole("button", { name: /Loop Builder/ }).click();
  await page.locator(".loop-list-select").filter({ hasText: /Cue A · Sequence/ }).click();

  await expect(page.locator(".loop-event")).toHaveCount(2);
  await page.locator(".loop-event").first().click();
  await expect(page.getByText("Instances", { exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Duplicate Transformation rings after original" }).click();
  await expect(page.locator(".loop-event")).toHaveCount(3);
  await expect(page.locator(".loop-event[data-event-id='event-3']")).toHaveAttribute("data-lane", "0");
  await expect(page.locator(".loop-list .list-card.selected")).toContainText("3 bars");
  const positions = await page.locator(".loop-event").evaluateAll((events) => events.map((event) => Number.parseFloat((event as HTMLElement).style.left)));
  expect(positions[0]).toBeCloseTo(0);
  expect(positions[1]).toBeCloseTo(33.333, 1);
  expect(positions[2]).toBeCloseTo(66.667, 1);

  await page.locator(".clip-strip button").first().dblclick();
  await expect(page.locator(".loop-event[data-event-id='event-4']")).toHaveAttribute("data-lane", "1");
  await expect(page.locator(".loop-preview video.is-visible")).toHaveAttribute("data-event-id", "cue-a-loop-a");
  await expect(page.locator(".loop-lane-rail .grip-dots")).toHaveCount(4);
  await expect(page.locator(".loop-list [data-lane-order]")).toHaveCount(0);
  await page.locator('[data-lane-order="1"]').dragTo(page.locator('[data-lane-order="0"]'));
  await expect(page.locator(".loop-event[data-event-id='event-4']")).toHaveAttribute("data-lane", "0");
  await expect(page.locator(".loop-event[data-event-id='cue-a-loop-a']")).toHaveAttribute("data-lane", "1");
  await expect(page.locator(".loop-preview video.is-visible")).toHaveAttribute("data-event-id", "event-4");
});

test("duplicate buttons and six-dot lane handles stay visible in a narrower window", async ({ page }) => {
  await useCatalogDefaults(page);
  await page.setViewportSize({ width: 900, height: 900 });
  await page.goto("/studio/");
  await page.getByRole("button", { name: /Loop Builder/ }).click();
  await page.locator(".loop-list-select").filter({ hasText: /Cue A · Sequence/ }).click();
  await page.locator(".loop-event").first().click();
  const duplicate = page.getByRole("button", { name: "Duplicate Transformation rings after original" });
  await expect(duplicate).toHaveText("Duplicate instance");
  await expect(duplicate).toBeInViewport();
  const actionTypography = await page.locator(".instance-actions button").evaluateAll((buttons) => buttons.map((button) => {
    const style = getComputedStyle(button);
    return { family: style.fontFamily, size: style.fontSize, weight: style.fontWeight, lineHeight: style.lineHeight };
  }));
  expect(actionTypography[0]).toEqual(actionTypography[1]);
  expect(actionTypography[0].size).toBe("12px");
  await expect(page.getByRole("button", { name: "Drag lane 1 to reorder" })).toBeInViewport();
  await duplicate.click();
  await expect(page.locator(".loop-event")).toHaveCount(3);
});

test("zoom amount, duplicate action, and descriptive history work across tabs", async ({ page }) => {
  await useCatalogDefaults(page);
  await page.goto("/studio/");
  await expect(page.locator(".status-bar .history-toolbar")).toBeVisible();
  await expect(page.locator(".app-header .history-button")).toHaveCount(0);
  await page.getByRole("button", { name: /Loop Builder/ }).click();
  await expect(page.locator(".status-bar .history-toolbar")).toBeVisible();
  await page.locator(".loop-event").first().click();
  const duplicate = page.getByRole("button", { name: /Duplicate .* after original/ });
  const duplicateBox = await duplicate.boundingBox();
  const deleteBox = await page.getByRole("button", { name: "Delete instance" }).boundingBox();
  expect(duplicateBox!.y).toBeLessThan(deleteBox!.y);
  await duplicate.click();
  await expect(page.locator(".loop-event")).toHaveCount(2);
  await expect(page.getByRole("button", { name: "Undo: Add clip instance" })).toBeEnabled();
  await page.getByRole("button", { name: "Undo: Add clip instance" }).click();
  await expect(page.locator(".loop-event")).toHaveCount(1);
  await expect(page.getByRole("button", { name: "Redo: Add clip instance" })).toBeEnabled();
  await page.getByRole("button", { name: "Redo: Add clip instance" }).click();
  await expect(page.locator(".loop-event")).toHaveCount(2);

  await page.locator(".loop-event").first().click();
  await page.getByText("Slow zoom & pan").click();
  const zoom = page.getByLabel("Zoom amount");
  await expect(zoom).toHaveAttribute("min", "0");
  await expect(zoom).toHaveAttribute("max", "300");
  await zoom.focus();
  await page.keyboard.press("Home");
  await expect(zoom).toHaveValue("0");
  await page.keyboard.press("End");
  await expect(zoom).toHaveValue("300");
  await expect(page.getByRole("button", { name: "Undo: Zoom 0% → 300%" })).toBeEnabled();
  await expect(page.locator(".status-bar .history-toolbar")).toBeVisible();
});

test("Live Console renderer reveals a covered lower lane at its correct media time", async ({ page }) => {
  const event = (id: string, clipId: string, lane: number, at: number, duration: number) => ({
    id, clipId, lane, at: { beats: at }, duration: { beats: duration },
    source: { startSeconds: 0, endSeconds: 7.9, loop: true, rate: 1 },
    appearance: { z: lane === 0 ? 0 : 99, opacity: 1, blendMode: "normal", fit: "cover", filters: [] },
  });
  const scene = {
    schemaVersion: 4, id: "lane-test-scene", name: "Lane test", availability: "ready", lanePriority: "top",
    clips: [1, 2].map((number) => ({ id: `clip-${number}`, label: `Clip ${number}`, src: "/assets/scenes/metropolis/robot-reveal.mp4", startSeconds: 0, durationSeconds: 8 })),
    visualLoops: [{ id: "song-default", name: "Default", length: { bars: 2 }, repeat: true, events: [
      event("lower", "clip-1", 1, 0, 8), event("upper", "clip-2", 0, 2, 2),
    ] }],
    defaultLoopId: "song-default", cueBindings: [], advance: { afterSongs: 1 },
  };
  await page.addInitScript((published) => localStorage.setItem("video-sync-published-scene", JSON.stringify(published)), scene);
  await page.goto("/poc/");
  await page.evaluate(async () => {
    const { VisualEngine } = await import("/poc/engine.mjs");
    const stage = document.createElement("div");
    document.body.append(stage);
    const engine = new VisualEngine(stage);
    engine.running = false;
    const anchor = performance.timeOrigin + performance.now();
    const clock = { bpm: 120, playing: true, anchorBeat: 0, anchorEpochMs: anchor };
    await engine.decks[0].applyState({ loaded: true, playing: false, started: true, sceneId: "lane-test-scene", generation: 1, activeLoopId: "song-default", loopAnchorBeat: 0, loopGeneration: 0, opacity: 1, clock, linkClock: clock });
    (window as typeof window & { laneTest?: { engine: InstanceType<typeof VisualEngine>; anchor: number } }).laneTest = { engine, anchor };
  });
  const visibleAt = async (beat: number) => page.evaluate((position) => {
    const { engine, anchor } = (window as typeof window & { laneTest: { engine: { decks: Array<{ render: (time: number) => void; container: HTMLElement }> }; anchor: number } }).laneTest;
    engine.decks[0].render(anchor + position * 500);
    return [...engine.decks[0].container.querySelectorAll("video.is-visible")].map((video) => (video as HTMLVideoElement).dataset.eventId);
  }, beat);
  await expect.poll(() => page.evaluate(() => {
    const { engine } = (window as typeof window & { laneTest: { engine: { decks: Array<{ container: HTMLElement }> } } }).laneTest;
    return (engine.decks[0].container.querySelector('[data-event-id="lower"]') as HTMLVideoElement).readyState;
  })).toBeGreaterThanOrEqual(1);
  expect(await visibleAt(0)).toEqual(["lower"]);
  expect(await visibleAt(2)).toEqual(["upper"]);
  expect(await visibleAt(4)).toEqual(["lower"]);
  await page.evaluate(() => {
    const { engine } = (window as typeof window & { laneTest: { engine: { decks: Array<{ runtimeScene: { visualLoops: Array<{ events: Array<{ id: string; appearance: { opacity: number } }> }> } }> } } }).laneTest;
    engine.decks[0].runtimeScene.visualLoops[0].events.find((event) => event.id === "upper")!.appearance.opacity = 0.5;
  });
  expect(await visibleAt(2)).toEqual(["lower", "upper"]);
  const layers = await page.evaluate(() => {
    const { engine } = (window as typeof window & { laneTest: { engine: { decks: Array<{ container: HTMLElement }> } } }).laneTest;
    return [...engine.decks[0].container.querySelectorAll("video.is-visible")].map((video) => ({ id: (video as HTMLVideoElement).dataset.eventId, z: Number((video as HTMLElement).style.zIndex), opacity: Number((video as HTMLElement).style.opacity) }));
  });
  expect(layers.find((layer) => layer.id === "upper")!.z).toBeGreaterThan(layers.find((layer) => layer.id === "lower")!.z);
  expect(layers.find((layer) => layer.id === "upper")!.opacity).toBe(0.5);
  await expect.poll(() => page.evaluate(() => {
    const { engine } = (window as typeof window & { laneTest: { engine: { decks: Array<{ container: HTMLElement }> } } }).laneTest;
    return (engine.decks[0].container.querySelector('[data-event-id="lower"]') as HTMLVideoElement).currentTime;
  })).toBeGreaterThan(1.8);
});

test("loop instances move between lanes without overlapping and Delete removes only the selection", async ({ page }) => {
  await useCatalogDefaults(page);
  await page.goto("/studio/");
  await page.getByRole("button", { name: /Loop Builder/ }).click();
  await page.locator(".loop-list-select").filter({ hasText: /Cue A · Sequence/ }).click();

  const scrub = await page.getByTestId("preview-scrub").boundingBox();
  const grid = await page.getByTestId("loop-timeline").boundingBox();
  expect(scrub).not.toBeNull();
  expect(grid).not.toBeNull();
  expect(Math.abs(scrub!.x - grid!.x)).toBeLessThan(1);
  expect(Math.abs(scrub!.width - grid!.width)).toBeLessThan(1);

  const events = page.locator(".loop-event");
  await expect(events).toHaveCount(2);
  await expect(events.nth(0)).toHaveAttribute("data-lane", "0");
  await expect(events.nth(1)).toHaveAttribute("data-lane", "0");
  const moveDown = async (index: number, beatOffset: number, laneOffset: number) => {
    const event = events.nth(index);
    const box = await event.boundingBox();
    expect(box).not.toBeNull();
    const startX = box!.x + box!.width / 2;
    const startY = box!.y + box!.height / 2;
    await page.mouse.move(startX, startY);
    await page.mouse.down();
    await page.mouse.move(startX + grid!.width * beatOffset / 8, startY + laneOffset * 46, { steps: 8 });
    await page.mouse.up();
  };

  await moveDown(0, 0, 1);
  await expect(events.nth(0)).toHaveAttribute("data-lane", "1");
  await moveDown(1, 0, 1);
  await expect(events.nth(1)).toHaveAttribute("data-lane", "1");
  expect(await events.nth(0).evaluate((event: HTMLElement) => event.style.left)).toBe("0%");
  expect(await events.nth(1).evaluate((event: HTMLElement) => event.style.left)).toBe("50%");

  const secondBefore = await events.nth(1).evaluate((event: HTMLElement) => event.style.left);
  await moveDown(1, -4, 0);
  await expect(events.nth(1)).toHaveAttribute("data-lane", "1");
  expect(await events.nth(1).evaluate((event: HTMLElement) => event.style.left)).toBe(secondBefore);
  await expect(page.getByRole("status")).toContainText("cannot overlap");

  await events.nth(0).click();
  await page.keyboard.press("Delete");
  await expect(events).toHaveCount(1);
  await events.first().click();
  await page.getByRole("textbox", { name: "Loop name" }).focus();
  await page.keyboard.press("Backspace");
  await expect(events).toHaveCount(1);
});
