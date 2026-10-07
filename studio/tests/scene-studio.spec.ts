import { expect, test, type Page } from "@playwright/test";
import { catalogProject, migrateLegacyDefaultClipRanges } from "../client/src/catalog";
import { compileRuntimeScene } from "../client/src/model";

async function useCatalogDefaults(page: Page) {
  await page.route("**/api/studio/projects", (route) => route.fulfill({ json: [] }));
  await page.route(/\/api\/studio\/projects\/(metropolis-machine|trip-to-the-moon|nosferatu)$/, (route) => route.fulfill({ status: 404, body: "Not saved" }));
}

async function selectScene(page: Page, id: string) {
  await page.getByRole("button", { name: "Change scene" }).click();
  const dialog = page.getByRole("dialog", { name: "Select scene" });
  await expect(dialog).toBeVisible();
  await dialog.locator(`[data-scene-id="${id}"]`).click();
  await expect(dialog).toHaveCount(0);
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

test("Live Console restores deck, queue, mixer, tempo, and FX state from local storage", async ({ page }) => {
  await page.route("**/api/bridge/events*", (route) => route.fulfill({ status: 200, contentType: "text/event-stream", body: "" }));
  await page.goto("/poc/");
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

test("selecting a source clip seeks once for mouse and keyboard input", async ({ page }) => {
  await useCatalogDefaults(page);
  await page.goto("/studio/");
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
  expect(await video.evaluate((element: HTMLVideoElement & { seekWrites?: number[] }) => element.seekWrites)).toHaveLength(1);
  await clip.focus();
  await page.keyboard.press("Enter");
  expect(await video.evaluate((element: HTMLVideoElement & { seekWrites?: number[] }) => element.seekWrites)).toHaveLength(2);
});

test("source clips play on selection and transport icons show playback state", async ({ page }) => {
  await useCatalogDefaults(page);
  await page.goto("/studio/");
  const video = page.locator(".source-preview video");
  const play = page.getByRole("button", { name: "Play", exact: true });
  const loop = page.getByRole("button", { name: "Loop audition" });
  const cut = page.getByRole("button", { name: "Cut clip here" });
  await expect.poll(() => video.evaluate((element: HTMLVideoElement) => element.videoWidth)).toBeGreaterThan(0);
  await expect(play).toHaveAttribute("aria-pressed", "false");
  await expect(cut.locator("svg")).toHaveCount(1);
  await expect(loop.locator("svg")).toHaveCount(1);
  await expect(page.locator(".source-list .list-card").first()).toContainText("1 clip");
  await play.hover();
  await expect(play).toHaveCSS("background-color", "rgb(38, 81, 91)");

  await page.locator(".clip-range").first().click();
  await expect.poll(() => video.evaluate((element: HTMLVideoElement) => element.paused)).toBe(false);
  await expect(page.getByRole("button", { name: "Pause", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("button", { name: "Pause", exact: true })).toHaveClass(/active/);
  await expect(page.getByRole("button", { name: "Pause", exact: true })).toHaveCSS("background-color", "rgb(155, 217, 232)");
  await page.getByRole("button", { name: "Pause", exact: true }).click();
  await expect(play).toHaveAttribute("aria-pressed", "false");

  await cut.click();
  await expect(page.locator(".clip-card")).toHaveCount(2);
  await expect(page.locator(".source-list .list-card").first()).toContainText("2 clips");
  await page.locator(".clip-card").last().click();
  await expect.poll(() => video.evaluate((element: HTMLVideoElement) => element.paused)).toBe(false);
  await page.getByRole("button", { name: "Loop audition" }).click();
  await expect(page.getByRole("button", { name: "Stop audition" })).toHaveClass(/active/);
  await expect(page.getByRole("button", { name: "Stop audition" })).toHaveAttribute("aria-pressed", "true");
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
  await page.locator(".clip-range").last().click();
  await expect.poll(() => video.evaluate((element: HTMLVideoElement) => element.paused)).toBe(false);
  await page.locator(".clip-card").first().click();
  await expect(page.getByRole("button", { name: "Stop audition" })).toHaveAttribute("aria-pressed", "true");
  await expect.poll(() => video.evaluate((element: HTMLVideoElement) => element.paused)).toBe(false);
  await page.locator(".source-list .list-card").nth(1).click();
  await expect(page.getByRole("button", { name: "Stop audition" })).toHaveAttribute("aria-pressed", "true");
  await expect.poll(() => video.evaluate((element: HTMLVideoElement) => element.paused)).toBe(false);
  await page.locator(".clip-range").first().click();
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
  await expect(page.getByRole("button", { name: "Loop audition" })).toHaveAttribute("aria-pressed", "false");
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

  await page.getByRole("button", { name: "Cut clip here" }).click();
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
  await page.screenshot({ path: "studio/test-results/loop-motion.png", fullPage: true });

  await page.getByRole("button", { name: /Cue Map/ }).click();
  await expect(page.getByRole("heading", { name: "Performance preview" })).toBeVisible();
  await expect(page.locator(".cue-grid article")).toHaveCount(8);
  await page.locator(".cue-grid article").nth(7).locator("select").selectOption("cue-a-loop");

  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.locator(".status-bar")).toContainText("Saved");
  await page.getByRole("button", { name: "Publish", exact: true }).click();
  await expect(page.locator(".status-bar")).toContainText("Published for Live Console");
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem("video-sync-published-scene") ?? "null")?.schemaVersion)).toBe(4);

  expect(savedProject.clips).toHaveLength(13);
  expect(publishedScene.visualLoops).toHaveLength(8);
  expect(publishedScene.lanePriority).toBe("top");
  expect(publishedScene.visualLoops[0].events[0].lane).toBe(0);
  expect(publishedScene.visualLoops.find((loop: { id: string }) => loop.id === "cue-e-loop")?.compositing).toBe("layers");
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
  await expect(page.getByRole("button", { name: /Cue Map/ })).toHaveClass(/active/);
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
  await expect(page.locator(".scene-dialog-list button")).toHaveCount(1);
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
      await page.getByRole("button", { name: /Cue E · Crossfade/ }).click();
      await expect(page.getByRole("combobox", { name: "Visibility" })).toHaveValue("layers");
      await expect(page.locator(".loop-preview video")).toHaveCount(2);
    }
    await page.getByRole("button", { name: /Cue Map/ }).click();
    await expect(page.locator(".cue-grid article")).toHaveCount(8);
    await expect(page.locator(".cue-grid article").first().locator("select")).toHaveValue("cue-a-loop");
    await expect(page.locator(".cue-grid article").last().locator("select")).toHaveValue("");
    await page.getByRole("button", { name: /Sources & Clips/ }).click();
  }
  await selectScene(page, "metropolis-machine");
  await page.locator(".inspector-fields input").first().fill("Robot reveal remix");
  await expect(page.locator(".status-bar")).toContainText("Unsaved edits");
  await selectScene(page, "trip-to-the-moon");
  await selectScene(page, "metropolis-machine");
  await expect(page.locator(".clip-card").first()).toContainText("Robot reveal remix");
  await expect(page.locator(".status-bar")).toContainText("Draft edits restored");
});

test("duplicates instances immediately after the original and lets reordered lanes control preview", async ({ page }) => {
  await useCatalogDefaults(page);
  await page.goto("/studio/");
  await page.getByRole("button", { name: /Loop Builder/ }).click();
  await page.getByRole("button", { name: /Cue A · Sequence/ }).click();

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
  await expect(page.locator(".loop-preview video")).toHaveAttribute("data-event-id", "cue-a-loop-a");
  await expect(page.locator(".loop-lane-rail .grip-dots")).toHaveCount(4);
  await expect(page.locator(".loop-list [data-lane-order]")).toHaveCount(0);
  await page.locator('[data-lane-order="1"]').dragTo(page.locator('[data-lane-order="0"]'));
  await expect(page.locator(".loop-event[data-event-id='event-4']")).toHaveAttribute("data-lane", "0");
  await expect(page.locator(".loop-event[data-event-id='cue-a-loop-a']")).toHaveAttribute("data-lane", "1");
  await expect(page.locator(".loop-preview video")).toHaveAttribute("data-event-id", "event-4");
});

test("duplicate buttons and six-dot lane handles stay visible in a narrower window", async ({ page }) => {
  await useCatalogDefaults(page);
  await page.setViewportSize({ width: 900, height: 900 });
  await page.goto("/studio/");
  await page.getByRole("button", { name: /Loop Builder/ }).click();
  await page.getByRole("button", { name: /Cue A · Sequence/ }).click();
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

test("zoom amount, duplicate action, and descriptive history stay in the right inspector", async ({ page }) => {
  await useCatalogDefaults(page);
  await page.goto("/studio/");
  await expect(page.locator(".sources-workspace .history-toolbar")).toBeVisible();
  await expect(page.locator(".app-header .history-button")).toHaveCount(0);
  await page.getByRole("button", { name: /Loop Builder/ }).click();
  await expect(page.locator(".loops-workspace .history-toolbar")).toBeVisible();
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
  await page.getByRole("button", { name: /Cue Map/ }).click();
  await expect(page.locator(".cue-workspace .history-toolbar")).toBeVisible();
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
  expect(await visibleAt(0)).toEqual(["lower"]);
  expect(await visibleAt(2)).toEqual(["upper"]);
  expect(await visibleAt(4)).toEqual(["lower"]);
  await expect.poll(() => page.evaluate(() => {
    const { engine } = (window as typeof window & { laneTest: { engine: { decks: Array<{ container: HTMLElement }> } } }).laneTest;
    return (engine.decks[0].container.querySelector('[data-event-id="lower"]') as HTMLVideoElement).currentTime;
  })).toBeGreaterThan(1.8);
});

test("loop instances move between lanes without overlapping and Delete removes only the selection", async ({ page }) => {
  await useCatalogDefaults(page);
  await page.goto("/studio/");
  await page.getByRole("button", { name: /Loop Builder/ }).click();
  await page.getByRole("button", { name: /Cue A · Sequence/ }).click();

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
