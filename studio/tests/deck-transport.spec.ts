import { expect, test, type Page } from "@playwright/test";

async function mockBridge(page: Page) {
  await page.route("**/api/studio/published", (route) => route.fulfill({ json: [] }));
  await page.addInitScript(() => {
    class TestBridge extends EventTarget {
      constructor() {
        super();
        (window as any).testBridge = this;
      }
      close() {}
    }
    (window as any).EventSource = TestBridge;
  });
  await page.goto("/poc/");
  await page.waitForFunction(() => Boolean((window as any).testBridge));
}

async function emit(page: Page, type: string, payload: unknown) {
  await page.evaluate(({ type, payload }) => {
    (window as any).testBridge.dispatchEvent(new MessageEvent(type, { data: JSON.stringify(payload) }));
  }, { type, payload });
}

function observedDeck(deck: number, playing: boolean, positionSeconds = 24, hotCues: unknown[] = []) {
  return {
    deck, loaded: true, bpm: 120, playing, transportKnown: true,
    positionSeconds, beatPosition: positionSeconds * 2,
    trackFingerprint: `test-track-${deck}`, loadGeneration: 1,
    hotCues, hotCueMetadataBasis: "visible", hotCueMetadataVisible: true,
  };
}

async function observe(page: Page, decks: ReturnType<typeof observedDeck>[]) {
  await emit(page, "bridge-message", {
    type: "rekordbox.deck-state", emittedAtUnixMs: Date.now(),
    payload: { contractVersion: 2, adapterSessionId: "test-session", decks },
  });
}

async function savedDeck(page: Page, index = 0) {
  return page.evaluate((index) => JSON.parse(localStorage.getItem("video-sync-player-state-v1") ?? "null")?.decks[index], index);
}

test("confirmed deck transport repairs inverted parity in console, projector, and after reload", async ({ page, context }) => {
  await mockBridge(page);
  const output = await context.newPage();
  await output.goto("/poc/output.html");
  await emit(page, "controller-transport", { decks: [
    { deck: 1, known: true, playing: true }, { deck: 2, known: true, playing: false },
  ] });
  await observe(page, [observedDeck(1, false), observedDeck(2, true)]);
  const left = page.locator(".deck-visual-1 video.is-visible").first();
  const right = page.locator(".deck-visual-2 video.is-visible").first();
  await expect(page.locator("#deck-1-state")).toHaveText("paused");
  await expect(page.locator("#deck-2-state")).toHaveText("playing");
  await expect.poll(() => left.evaluate((video: HTMLVideoElement) => video.paused)).toBe(true);
  await expect.poll(() => right.evaluate((video: HTMLVideoElement) => video.paused)).toBe(false);
  await expect.poll(() => output.locator(".deck-visual-1 video.is-visible").first().evaluate((video: HTMLVideoElement) => video.paused)).toBe(true);
  await expect.poll(() => output.locator(".deck-visual-2 video.is-visible").first().evaluate((video: HTMLVideoElement) => video.paused)).toBe(false);

  await observe(page, [observedDeck(1, true, 24.2), observedDeck(2, false, 24.2)]);
  await expect.poll(() => left.evaluate((video: HTMLVideoElement) => video.paused)).toBe(false);
  await expect.poll(() => right.evaluate((video: HTMLVideoElement) => video.paused)).toBe(true);
  const before = await left.evaluate((video: HTMLVideoElement) => video.currentTime);
  await expect.poll(() => left.evaluate((video: HTMLVideoElement) => video.currentTime)).toBeGreaterThan(before + 0.1);

  await page.reload();
  await page.waitForFunction(() => Boolean((window as any).testBridge));
  await observe(page, [observedDeck(1, false, 25), observedDeck(2, true, 25)]);
  await expect(page.locator("#deck-1-state")).toHaveText("paused");
  await expect(page.locator("#deck-2-state")).toHaveText("playing");
  await expect.poll(() => left.evaluate((video: HTMLVideoElement) => video.paused)).toBe(true);
  await expect.poll(() => right.evaluate((video: HTMLVideoElement) => video.paused)).toBe(false);
});

test("creating cue slots activates one-shots once and phase-aligns a saved loop beyond five seconds", async ({ page }) => {
  await mockBridge(page);
  await observe(page, [observedDeck(1, true), observedDeck(2, true)]);
  const oneShot = { cueIndex: 0, kind: "cue", timeSeconds: 24.1 };
  await observe(page, [observedDeck(1, true, 24.1, [oneShot]), observedDeck(2, true)]);
  await expect(page.locator("[data-cue-deck='1'][data-cue='0']")).toHaveAttribute("aria-pressed", "true");
  await expect.poll(async () => (await savedDeck(page))?.activeCueInput).toBe("hotCueA");
  const afterOneShot = await savedDeck(page);
  expect(afterOneShot.clock.anchorBeat - afterOneShot.loopAnchorBeat).toBeCloseTo(0, 1);
  await observe(page, [observedDeck(1, true, 24.2, [oneShot]), observedDeck(2, true)]);
  await expect.poll(async () => (await savedDeck(page))?.clock.anchorEpochMs).toBeGreaterThan(afterOneShot.clock.anchorEpochMs);
  expect((await savedDeck(page)).loopGeneration).toBe(afterOneShot.loopGeneration);

  // A controller press precedes creation metadata. Its debounce must not mask
  // the saved start or reset an already-running audio loop to the press time.
  await emit(page, "bridge-message", { type: "controller.control", payload: {
    event: "hotcue.c", deck: 1, value: 1, active: true,
  } });
  const loop = { cueIndex: 2, kind: "loop", timeSeconds: 8, lengthBeats: 64 };
  await observe(page, [observedDeck(1, true, 24.3, [oneShot, loop]), observedDeck(2, true)]);
  await expect.poll(async () => (await savedDeck(page))?.activeCueMetadata?.timeSeconds).toBe(8);
  const afterLoop = await savedDeck(page);
  expect(afterLoop.activeCueInput).toBe("hotCueC");
  expect(afterLoop.clock.anchorBeat - afterLoop.loopAnchorBeat).toBeCloseTo(32.6, 1);
  expect((await savedDeck(page, 1)).activeCueInput).toBeNull();
  await expect.poll(() => page.locator(".deck-visual-1 video.is-visible").first().evaluate((video: HTMLVideoElement) => video.paused)).toBe(false);

  await observe(page, [observedDeck(1, false, 24.3, [oneShot, loop]), observedDeck(2, true)]);
  await observe(page, [observedDeck(1, false, 24.3, [oneShot, loop, { cueIndex: 3, kind: "cue", timeSeconds: 24.3 }]), observedDeck(2, true)]);
  await expect.poll(async () => (await savedDeck(page))?.activeCueInput).toBe("hotCueD");
  await expect(page.locator("#deck-1-state")).toHaveText("paused");
  await expect.poll(() => page.locator(".deck-visual-1 video.is-visible").first().evaluate((video: HTMLVideoElement) => video.paused)).toBe(true);
});

test("deleting the active cue returns only that deck to its scene default", async ({ page }) => {
  await mockBridge(page);
  const cues = [
    { cueIndex: 0, kind: "cue", timeSeconds: 4 },
    { cueIndex: 1, kind: "cue", timeSeconds: 8 },
    { cueIndex: 2, kind: "loop", timeSeconds: 16, lengthBeats: 32 },
    { cueIndex: 7, kind: "loop", timeSeconds: 20, lengthBeats: 16 },
  ];
  let visible = [...cues];
  const press = (deck: number, cueIndex: number) => emit(page, "bridge-message", {
    type: "controller.control", payload: { event: `hotcue.${String.fromCharCode(97 + cueIndex)}`, deck, value: 1, active: true },
  });
  await observe(page, [observedDeck(1, true, 24, cues), observedDeck(2, true, 24, cues)]);
  await press(1, 0);
  await press(2, 2);
  visible = visible.filter((cue) => cue.cueIndex !== 1);
  await observe(page, [observedDeck(1, true, 24, visible), observedDeck(2, true, 24, cues)]);
  await expect.poll(async () => (await savedDeck(page))?.activeCueInput).toBe("hotCueA");

  // Removing a one-shot, a loop, or the random H slot all return to default,
  // including immediately after a press while cue debounce is active.
  for (const cueIndex of [0, 2, 7]) {
    await press(1, cueIndex);
    await expect(page.locator(`[data-cue-deck='1'][data-cue='${cueIndex}']`)).toHaveAttribute("aria-pressed", "true");
    visible = visible.filter((cue) => cue.cueIndex !== cueIndex);
    await observe(page, [observedDeck(1, true, 24, visible), observedDeck(2, true, 24, cues)]);
    await expect.poll(async () => (await savedDeck(page))?.activeCueInput).toBeNull();
    const deck = await savedDeck(page);
    expect(deck.activeLoopId).toBe("song-default");
    expect(deck.activeCueMetadata).toBeNull();
    expect(deck.playing).toBe(true);
    expect((await savedDeck(page, 1)).activeCueInput).toBe("hotCueC");
  }
});
