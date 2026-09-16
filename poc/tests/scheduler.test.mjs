import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { tickFrequency } from "../metronome.mjs";
import { clockFromLinkMessage, commandFromController, rekordboxTempoPlan, resolveHotCueRoute, transportEntriesForEvent } from "../bridge-controls.mjs";
import { isSafeBridgeReplay } from "../bridge-replay.mjs";
import { BEAT_FX_CATALOG, beatFxFrame, effectAppliesToDeck, stepBeatMultiplier } from "../effects.mjs";
import { computeDeckOpacities, dominantDeck } from "../mix.mjs";
import { createPhraseClock, phraseBeatAt, syncPhraseClock, visualLoopWindows } from "../phrase-transport.mjs";
import { phrasePosition, SongCounter, noteToBeats } from "../scheduler.mjs";
import { filtersToCss, musicalToBeats, resolveVisualLoop } from "../sequencer.mjs";
import { compileTwoClipLoop, TWO_CLIP_RECIPE_TYPES } from "../loop-recipes.mjs";
import { SceneQueue } from "../scene-queue.mjs";
import { authoredClipOrder, clipOrderForAssignment, normalizeClipOrder, remapSceneClipId } from "../scene-variation.mjs";
import { generateRandomLoop } from "../random-loop.mjs";
import { combineTransforms, kenBurnsFrame, motionWithClipSubject } from "../motion.mjs";
import { SUBJECT_FOCUS, subjectFocusFor } from "../ken-burns-library.mjs";
import { ControllerTransportTracker, parseDeckRuntime, serializeDeckRuntime } from "../transport-state.mjs";
import { crossedHotCues } from "../cue-crossings.mjs";
import { mediaTimeForMusicalOffset } from "../media-time.mjs";
import { PLAYABLE_SCENES, SCENES } from "../scene-registry.mjs";

const projectRoot = join(dirname(fileURLToPath(import.meta.url)), "../..");
const sceneFiles = ["metropolis-machine.scene.json"];

async function loadScene(filename = sceneFiles[0]) {
  return JSON.parse(await readFile(join(projectRoot, "scenes", filename), "utf8"));
}

const resolve = (scene, loopId, beat, options = {}) => resolveVisualLoop(scene, loopId, beat, {
  started: true,
  loopAnchorBeat: 0,
  loopGeneration: 1,
  ...options,
});

test("musical durations use four beats per bar and support 1/16 notes", () => {
  assert.equal(musicalToBeats({ bars: 2, beats: 1 }), 9);
  assert.equal(noteToBeats(16), 0.25);
});

test("the 16-bar phrase counter wraps continuously", () => {
  assert.deepEqual(phrasePosition(0), { bar: 1, barProgress: 0, phraseProgress: 0 });
  assert.equal(phrasePosition(63.5).bar, 16);
  assert.equal(phrasePosition(64).bar, 1);
  assert.equal(phrasePosition(66).barProgress, 0.5);
});

test("the phrase clock runs only while a deck is playing and restarts at bar one", () => {
  const idle = createPhraseClock(120, 1000);
  assert.equal(idle.playing, false);
  assert.equal(phraseBeatAt(idle, 4000), 0);

  const started = syncPhraseClock(idle, {
    wasAnyPlaying: false,
    isAnyPlaying: true,
    epochMs: 4000,
    bpm: 120,
  });
  assert.equal(started.playing, true);
  assert.equal(phraseBeatAt(started, 4000), 0);
  assert.equal(phraseBeatAt(started, 5000), 2);

  const continued = syncPhraseClock(started, {
    wasAnyPlaying: true,
    isAnyPlaying: true,
    epochMs: 5000,
    bpm: 120,
  });
  assert.equal(continued.anchorEpochMs, 4000);

  const stopped = syncPhraseClock(continued, {
    wasAnyPlaying: true,
    isAnyPlaying: false,
    epochMs: 6000,
    bpm: 120,
  });
  assert.equal(stopped.playing, false);
  assert.equal(phraseBeatAt(stopped, 9000), 0);

  const restarted = syncPhraseClock(stopped, {
    wasAnyPlaying: false,
    isAnyPlaying: true,
    epochMs: 9000,
    bpm: 120,
  });
  assert.equal(phraseBeatAt(restarted, 9000), 0);
  assert.deepEqual(phrasePosition(phraseBeatAt(restarted, 9000), 16), {
    bar: 1,
    barProgress: 0,
    phraseProgress: 0,
  });
});

test("visual loop windows stay aligned when a three-bar loop crosses a 16-bar phrase", () => {
  const firstPhrase = visualLoopWindows({
    phraseBeat: 0,
    deckBeat: 0,
    loopAnchorBeat: 0,
    loopLengthBeats: 12,
  });
  assert.deepEqual(firstPhrase.map((window) => window.visibleStartBars), [0, 3, 6, 9, 12, 15]);
  assert.equal(firstPhrase.at(-1).visibleEndBars, 16);

  const secondPhrase = visualLoopWindows({
    phraseBeat: 64,
    deckBeat: 64,
    loopAnchorBeat: 0,
    loopLengthBeats: 12,
  });
  assert.deepEqual(secondPhrase.slice(0, 3).map((window) => [
    window.visibleStartBars,
    window.visibleEndBars,
  ]), [[0, 2], [2, 5], [5, 8]]);
});

test("visual loop windows begin where a cue was actually activated", () => {
  const windows = visualLoopWindows({
    phraseBeat: 0.01,
    deckBeat: 0,
    loopAnchorBeat: 0,
    loopLengthBeats: 8,
    loopStartPhraseBeat: 0.01,
  });
  assert.equal(windows.length, 8);
  assert.equal(windows[0].visibleStartBars, 0.0025);
  assert.ok(windows.every((window) => window.visibleEndBars - window.visibleStartBars > 0.02));
});

test("the metronome uses a higher tick on beat one of every measure", () => {
  assert.ok(tickFrequency(0) > tickFrequency(1));
  assert.equal(tickFrequency(0), tickFrequency(4));
  assert.equal(tickFrequency(1), tickFrequency(2));
});

test("a Link peer clock becomes the continuously advancing visual clock", () => {
  assert.deepEqual(clockFromLinkMessage({
    type: "link.clock",
    emittedAtUnixMs: 123456,
    payload: { tempo: 127.5, beat: 42.25, playing: false },
  }), { bpm: 127.5, playing: true, anchorBeat: 42.25, anchorEpochMs: 123456 });
});

test("visible Rekordbox deck BPM overrides the generic Link-session tempo", () => {
  const message = {
    type: "rekordbox.deck-state",
    payload: {
      decks: [
        { deck: 1, loaded: true, bpm: 90 },
        { deck: 2, loaded: true, bpm: 124.5 },
      ],
    },
  };
  assert.deepEqual(rekordboxTempoPlan(message, [
    { playing: false },
    { playing: true },
  ], [0.8, 0.2]), {
    bpm: 124.5,
    sourceDeck: 2,
    decks: [{ deck: 1, bpm: 90 }, { deck: 2, bpm: 124.5 }],
  });
  assert.deepEqual(rekordboxTempoPlan(message, [
    { playing: true },
    { playing: true },
  ], [0.25, 0.75]).sourceDeck, 2);
  assert.equal(rekordboxTempoPlan({
    type: "rekordbox.deck-state",
    payload: { decks: [{ deck: 1, loaded: false, bpm: null }] },
  }), null);
});

test("passive hot-cue crossings interpolate the actual crossing time and reject seeks", () => {
  const hotCues = [{ cueIndex: 0, timeSeconds: 8 }, { cueIndex: 3, timeSeconds: 34 }];
  const [crossing] = crossedHotCues({
    positionSeconds: 7.6,
    epochMs: 1000,
    hotCues,
  }, {
    positionSeconds: 8.6,
    epochMs: 2000,
    hotCues,
  }, { playing: true });
  assert.equal(crossing.cueIndex, 0);
  assert.equal(crossing.timeSeconds, 8);
  assert.ok(Math.abs(crossing.crossedAtEpochMs - 1400) < 0.001);
  assert.equal(crossing.observedAtEpochMs, 2000);
  assert.deepEqual(crossedHotCues({
    positionSeconds: 8,
    epochMs: 1000,
    hotCues,
  }, {
    positionSeconds: 34.1,
    epochMs: 2000,
    hotCues,
  }, { playing: true }), []);
});

test("a pass over Hot Cue H reaches its generated random-loop fallback", async () => {
  const scene = await loadScene("metropolis-machine.scene.json");
  const randomLoop = generateRandomLoop(scene, () => 0.25);
  const hotCues = [
    { cueIndex: 7, timeSeconds: 44 },
    { cueIndex: 5, timeSeconds: 54 },
  ];
  const [crossing] = crossedHotCues({
    positionSeconds: 43.7,
    epochMs: 1000,
    hotCues,
  }, {
    positionSeconds: 44.3,
    epochMs: 1600,
    hotCues,
  }, { playing: true });

  assert.equal(crossing.cueIndex, 7);
  assert.deepEqual(resolveHotCueRoute(scene, crossing.cueIndex, randomLoop), {
    input: "hotCueH",
    binding: null,
    loopId: "random-loop",
    activeCueInput: "hotCueH",
  });
});

test("late visual activation seeks into the clip where its musical event should be", () => {
  assert.equal(mediaTimeForMusicalOffset({ startSeconds: 3, rate: 1, loop: false }, 4, 120, 20), 5);
  assert.equal(mediaTimeForMusicalOffset({ startSeconds: 3, rate: 2, loop: false }, 4, 120, 20), 7);
  const wrapped = mediaTimeForMusicalOffset({ startSeconds: 10, rate: 1, loop: true }, 42, 120, 30);
  assert.ok(Math.abs(wrapped - 11.04) < 0.001);
});

test("normalized GRV6 controls map to deterministic player commands", () => {
  assert.deepEqual(commandFromController({ event: "mixer.crossfader", deck: 0, value: 0.75, active: true }), { type: "crossfader", value: 0.75 });
  assert.deepEqual(commandFromController({ event: "deck.level", deck: 2, value: 1.2, active: true }), { type: "deck-level", deck: 2, value: 1 });
  assert.deepEqual(commandFromController({ event: "deck.play", deck: 1, value: 1, active: true }), { type: "toggle-deck", deck: 1 });
  assert.deepEqual(commandFromController({ event: "deck.load", deck: 2, value: 1, active: true }), { type: "load-deck", deck: 2 });
  assert.equal(commandFromController({ event: "deck.play", deck: 1, value: 0, active: false }), null);
  assert.deepEqual(commandFromController({ event: "hotcue.c", deck: 2, value: 1, active: true }), { type: "hot-cue", deck: 2, cueIndex: 2 });
  assert.deepEqual(commandFromController({ event: "beatfx.select.mobius-tri", deck: 0, value: 1, active: true }), { type: "beatfx-select", effect: "mobius-tri" });
  assert.deepEqual(commandFromController({ event: "beatfx.target.deck2", deck: 0, value: 1, active: true }), { type: "beatfx-target", target: "deck2" });
  assert.deepEqual(commandFromController({ event: "beatfx.toggle", deck: 0, value: 1, active: true }), { type: "beatfx-toggle" });
  assert.deepEqual(commandFromController({ event: "beatfx.beat-down", deck: 0, value: 1, active: true }), { type: "beatfx-beat-step", direction: -1 });
  assert.deepEqual(commandFromController({ event: "beatfx.depth", deck: 0, value: 0.63, active: true }), { type: "beatfx-depth", value: 0.63 });
});

test("a live transport edge updates only the deck that changed", () => {
  const decks = [
    { deck: 1, known: true, playing: true, updatedAtUnixMs: 2000 },
    { deck: 2, known: true, playing: false, updatedAtUnixMs: 1000 },
  ];
  assert.deepEqual(transportEntriesForEvent({ decks }), decks);
  assert.deepEqual(transportEntriesForEvent({ decks, changedDeck: 1 }), [decks[0]]);
  assert.deepEqual(transportEntriesForEvent({ decks, changedDeck: 2 }), [decks[1]]);
});

test("the checked-in GRV6 profile maps LOAD 1 and LOAD 2 to deck-load commands", async () => {
  const profile = await readFile(join(projectRoot, "bridge", "config", "ddj-grv6.csv"), "utf8");
  assert.match(profile, /^deck\.load,0x96,0x46,1,button$/m);
  assert.match(profile, /^deck\.load,0x96,0x47,2,button$/m);
  assert.deepEqual(commandFromController({ event: "deck.load", deck: 1, value: 1, active: true }), { type: "load-deck", deck: 1 });
  assert.deepEqual(commandFromController({ event: "deck.load", deck: 2, value: 1, active: true }), { type: "load-deck", deck: 2 });
});

test("controller transport parity survives a page reconnect and stop remains stop", () => {
  const tracker = new ControllerTransportTracker(2);
  assert.equal(tracker.snapshot().decks[0].known, false);
  assert.equal(tracker.observe({ event: "deck.play", deck: 1, active: true }, 1000), true);
  assert.equal(tracker.snapshot().decks[0].playing, true);

  const restored = new ControllerTransportTracker(2, tracker.snapshot(1100), { now: 1200 });
  assert.equal(restored.snapshot().decks[0].playing, true);
  restored.observe({ event: "deck.play", deck: 1, active: true }, 1300);
  assert.equal(restored.snapshot().decks[0].playing, false);

  const seeded = new ControllerTransportTracker(2);
  assert.equal(seeded.seed(1, true, 1400), true);
  assert.equal(seeded.seed(1, false, 1500), false);
  seeded.observe({ event: "deck.play", deck: 1, active: true }, 1600);
  assert.equal(seeded.snapshot().decks[0].playing, false);

  const loaded = new ControllerTransportTracker(2);
  loaded.observe({ event: "deck.load", deck: 2, active: true }, 1700);
  assert.deepEqual(loaded.snapshot().decks[1], {
    deck: 2,
    known: true,
    playing: false,
    updatedAtUnixMs: 1700,
  });
  loaded.observe({ event: "hotcue.c", deck: 2, active: true }, 1800);
  assert.deepEqual(loaded.snapshot().decks[1], {
    deck: 2,
    known: true,
    playing: true,
    updatedAtUnixMs: 1800,
  });
});

test("deck runtime transport and scene survive a browser reload", () => {
  const randomLoop = {
    id: "random-loop",
    name: "Random · Sequence · Clip 1 + Clip 2",
    length: { bars: 1 },
    repeat: true,
    events: [{
      id: "random-a",
      at: { beats: 0 },
      duration: { beats: 4 },
      clipId: "clip-1",
      source: { startSeconds: 1, loop: true, rate: 1 },
      appearance: { z: 0, opacity: 1, blendMode: "normal", fit: "cover", filters: [] },
    }],
  };
  const runtime = [{
    sceneId: "metropolis-machine",
    generation: 3,
    loaded: true,
    playing: true,
    started: true,
    counted: true,
    clipOrder: ["clip-4", "clip-2", "clip-3", "clip-1"],
    randomLoop,
    activeLoopId: "cue-b-loop",
    activeCueInput: "hotCueB",
    cueAnchorLinkBeat: 12,
    loopAnchorBeat: 8,
    loopGeneration: 4,
    clock: { bpm: 123, playing: true, anchorBeat: 16, anchorEpochMs: 1000 },
  }];
  const restored = parseDeckRuntime(serializeDeckRuntime(runtime), ["metropolis-machine"], 1);
  assert.equal(restored[0].playing, true);
  assert.equal(restored[0].sceneId, "metropolis-machine");
  assert.equal(restored[0].activeLoopId, "cue-b-loop");
  assert.deepEqual(restored[0].clipOrder, ["clip-4", "clip-2", "clip-3", "clip-1"]);
  assert.deepEqual(restored[0].randomLoop, randomLoop);
  assert.equal(restored[0].clock.playing, true);
});

test("later songs in a repeated queue entry shuffle clips while the first keeps authored order", () => {
  const scene = {
    clips: ["one", "two", "three", "four"].map((id) => ({ id })),
  };
  const first = clipOrderForAssignment(scene, { occurrence: 1 }, () => 0);
  const repeat = clipOrderForAssignment(scene, { occurrence: 2 }, () => 0);
  assert.deepEqual(first, authoredClipOrder(scene));
  assert.deepEqual(new Set(repeat), new Set(first));
  assert.notDeepEqual(repeat, first);
  assert.notEqual(repeat[0], first[0]);
  assert.equal(remapSceneClipId(scene, repeat, "one"), repeat[0]);
  assert.deepEqual(normalizeClipOrder(scene, ["bad"]), first);
});

test("bridge history never replays transport or hot-cue edges", () => {
  assert.equal(isSafeBridgeReplay({ type: "controller.control", payload: { event: "deck.play" } }), false);
  assert.equal(isSafeBridgeReplay({ type: "controller.control", payload: { event: "hotcue.b" } }), false);
  assert.equal(isSafeBridgeReplay({ type: "controller.control", payload: { event: "beatfx.toggle" } }), false);
  assert.equal(isSafeBridgeReplay({ type: "controller.control", payload: { event: "beatfx.select.echo" } }), true);
  assert.equal(isSafeBridgeReplay({ type: "controller.control", payload: { event: "beatfx.target.master" } }), true);
  assert.equal(isSafeBridgeReplay({ type: "controller.control", payload: { event: "beatfx.depth" } }), true);
  assert.equal(isSafeBridgeReplay({ type: "controller.control", payload: { event: "mixer.crossfader" } }), true);
  assert.equal(isSafeBridgeReplay({ type: "midi.raw", payload: {} }), true);
});

test("an unassigned Hot Cue selects the deck's generated random loop", async () => {
  const scene = await loadScene("metropolis-machine.scene.json");
  const randomLoop = generateRandomLoop(scene, () => 0.25);
  assert.deepEqual(resolveHotCueRoute(scene, 0), {
    input: "hotCueA",
    binding: scene.cueBindings[0],
    loopId: "cue-a-loop",
    activeCueInput: "hotCueA",
  });
  assert.deepEqual(resolveHotCueRoute(scene, 7, randomLoop), {
    input: "hotCueH",
    binding: null,
    loopId: "random-loop",
    activeCueInput: "hotCueH",
  });
  assert.equal(resolveHotCueRoute(scene, 7).loopId, "song-default");
});

test("all fourteen GRV6 Beat FX have distinct beat-synchronous video treatments", () => {
  assert.equal(BEAT_FX_CATALOG.length, 14);
  const signatures = BEAT_FX_CATALOG.map(({ id }) => {
    const frame = beatFxFrame({ selected: id, enabled: true, depth: 1, beatMultiplier: 1 }, 0.37);
    return [frame.filter, frame.transform, frame.opacity, frame.clipPath, frame.overlayBackground, frame.overlayBlendMode].join("|");
  });
  assert.equal(new Set(signatures).size, BEAT_FX_CATALOG.length);
  assert.equal(effectAppliesToDeck("master", 1), true);
  assert.equal(effectAppliesToDeck("deck2", 1), false);
  assert.equal(effectAppliesToDeck("deck2", 2), true);
  assert.equal(stepBeatMultiplier(1, -1), 0.5);
  assert.equal(stepBeatMultiplier(1, 1), 2);
});

test("a loaded but never-started scene resolves to the first default-loop event", async () => {
  const scene = await loadScene();
  const [preview] = resolveVisualLoop(scene, scene.defaultLoopId, 36, { started: false });
  assert.equal(preview.loopId, "song-default");
  assert.equal(preview.eventId, "song-default-clip-1");
  assert.equal(preview.clipId, "clip-1");
  assert.match(preview.occurrenceKey, /^preview:/);
});

test("default playback holds Clip 1 instead of cycling clips", async () => {
  const scene = await loadScene();
  const selectedAt = (beat) => resolve(scene, "song-default", beat)[0]?.clipId;
  assert.equal(selectedAt(15.999), "clip-1");
  assert.equal(selectedAt(16), "clip-1");
  assert.equal(selectedAt(32), "clip-1");
  assert.equal(selectedAt(63.999), "clip-1");
  assert.equal(selectedAt(64), "clip-1");
});

test("looping hot cues restart their visual loop at each modeled audio-loop cycle", async () => {
  const scene = await loadScene();
  const firstA = resolve(scene, "cue-a-loop", 100, { loopAnchorBeat: 100 })[0];
  const secondA = resolve(scene, "cue-a-loop", 116, { loopAnchorBeat: 100 })[0];
  assert.equal(firstA.clipId, "clip-2");
  assert.equal(secondA.clipId, "clip-2");
  assert.notEqual(firstA.occurrenceKey, secondA.occurrenceKey);

  assert.equal(resolve(scene, "cue-b-loop", 0)[0].clipId, "clip-4");
  assert.equal(resolve(scene, "cue-b-loop", 2)[0].clipId, "clip-5");
  assert.equal(resolve(scene, "cue-b-loop", 4)[0].clipId, "clip-4");
  assert.equal(resolve(scene, "cue-b-loop", 6)[0].clipId, "clip-5");
  assert.equal(resolve(scene, "cue-b-loop", 8)[0].clipId, "clip-4");
});

test("Metropolis jump cue C flashes Clip 7 over Clip 6 and retriggers at its four-bar boundary", async () => {
  const scene = await loadScene("metropolis-machine.scene.json");
  const first = resolve(scene, "cue-c-loop", 0.1);
  const betweenFlashes = resolve(scene, "cue-c-loop", 1);
  const beforeWrap = resolve(scene, "cue-c-loop", 15.999);
  const afterWrap = resolve(scene, "cue-c-loop", 16.1);
  assert.deepEqual(first.map((item) => item.clipId), ["clip-6", "clip-7"]);
  assert.deepEqual(betweenFlashes.map((item) => item.clipId), ["clip-6"]);
  assert.deepEqual(beforeWrap.map((item) => item.clipId), ["clip-6"]);
  assert.deepEqual(afterWrap.map((item) => item.clipId), ["clip-6", "clip-7"]);
  assert.notEqual(first[0].occurrenceKey, afterWrap[0].occurrenceKey);
  assert.equal(first[0].source.loop, true);
});

test("two-clip recipes compile to deterministic timeline events", () => {
  assert.deepEqual(TWO_CLIP_RECIPE_TYPES, ["sequence", "alternate", "flash-overlay", "call-response", "crossfade"]);
  const clips = [{ id: "clip-a", startSeconds: 1 }, { id: "clip-b", startSeconds: 2 }];
  const make = (type, options = {}) => compileTwoClipLoop({
    id: `${type}-loop`,
    name: type,
    type,
    length: { bars: 2 },
    clips,
    fit: "cover",
    ...options,
  });

  const sequence = make("sequence", { switchAt: { bars: 1 } });
  assert.deepEqual(sequence.events.map((item) => [item.clipId, musicalToBeats(item.at), musicalToBeats(item.duration)]), [
    ["clip-a", 0, 4],
    ["clip-b", 4, 4],
  ]);

  const alternate = make("alternate", { segment: { beats: 2 } });
  assert.deepEqual(alternate.events.map((item) => item.clipId), ["clip-a", "clip-b", "clip-a", "clip-b"]);

  const flash = make("flash-overlay", { interval: { beats: 2 }, flashDuration: { beats: 0.25 } });
  assert.equal(flash.events[0].clipId, "clip-a");
  assert.deepEqual(flash.events.slice(1).map((item) => musicalToBeats(item.at)), [0, 2, 4, 6]);
  assert.ok(flash.events.slice(1).every((item) => item.clipId === "clip-b" && item.appearance.z === 10));

  const callResponse = compileTwoClipLoop({
    id: "call-response-loop",
    name: "call-response",
    type: "call-response",
    length: { bars: 1 },
    clips,
    fit: "cover",
    switchAt: { beats: 3 },
  });
  assert.deepEqual(callResponse.events.map((item) => musicalToBeats(item.duration)), [3, 1]);

  const crossfade = make("crossfade");
  assert.deepEqual(crossfade.events.map((item) => item.appearance.opacityEnvelope), [
    { from: 1, to: 0, curve: "linear" },
    { from: 0, to: 1, curve: "linear" },
  ]);
  assert.ok(crossfade.events.every((item) => item.appearance.blendMode === "plus-lighter"));
});

test("a random loop is materialized once as a normal deterministic event timeline", () => {
  const scene = SCENES.find((candidate) => candidate.id === "metropolis-machine");
  const seeded = (initial) => {
    let state = initial >>> 0;
    return () => {
      state = (1664525 * state + 1013904223) >>> 0;
      return state / 0x100000000;
    };
  };
  const first = generateRandomLoop(scene, seeded(42));
  const replay = generateRandomLoop(scene, seeded(42));
  const nextLoad = generateRandomLoop(scene, seeded(43));
  assert.deepEqual(first, replay);
  assert.notDeepEqual(first, nextLoad);
  assert.equal(first.id, "random-loop");
  assert.equal(new Set(first.events.map((event) => event.clipId)).size, 2);
  assert.ok(first.events.every((event) => event.source.loop));
  assert.ok(first.events.every((event) => Number.isInteger(event.source.startSeconds * 2)));
  assert.ok(first.events.some((event) => event.source.startSeconds > 0));
});

test("crossfade opacity follows musical progress through the loop", () => {
  const visualLoop = compileTwoClipLoop({
    id: "crossfade-loop",
    name: "Crossfade",
    type: "crossfade",
    length: { bars: 2 },
    clips: [{ id: "clip-a" }, { id: "clip-b" }],
    fit: "cover",
  });
  const scene = { defaultLoopId: visualLoop.id, visualLoops: [visualLoop] };
  assert.deepEqual(resolve(scene, visualLoop.id, 0).map((item) => item.opacity), [1, 0]);
  assert.deepEqual(resolve(scene, visualLoop.id, 4).map((item) => item.opacity), [0.5, 0.5]);
  const nearEnd = resolve(scene, visualLoop.id, 7.999).map((item) => item.opacity);
  assert.ok(nearEnd[0] < 0.001);
  assert.ok(nearEnd[1] > 0.999);
});

test("visual-loop timeline events can overlap", () => {
  const raw = { z: 0, opacity: 1, blendMode: "normal", fit: "cover", filters: [] };
  const scene = {
    defaultLoopId: "layered",
    visualLoops: [{
      id: "layered",
      length: { bars: 1 },
      events: [
        { id: "bed", at: { beats: 0 }, duration: { bars: 1 }, clipId: "clip-1", source: { startSeconds: 0, loop: true }, appearance: raw },
        { id: "accent", at: { beats: 2 }, duration: { beats: 0.25 }, clipId: "clip-2", source: { startSeconds: 0, loop: true }, appearance: { ...raw, z: 10 } },
      ],
    }],
  };
  assert.deepEqual(resolve(scene, "layered", 2.1).map((item) => item.eventId), ["bed", "accent"]);
  assert.deepEqual(resolve(scene, "layered", 2.25).map((item) => item.eventId), ["bed"]);
});

test("raw is the default and filters can belong to one appearance", () => {
  assert.equal(filtersToCss([]), "none");
  assert.equal(filtersToCss([{ type: "invert", amount: 1 }, { type: "contrast", amount: 1.2 }]), "invert(1) contrast(1.2)");
});

test("Ken Burns motion pans toward a normalized subject without exposing an edge", () => {
  const motion = {
    type: "ken-burns",
    easing: "ease-in-out",
    start: { scale: 1, focus: { x: 0.5, y: 0.5 } },
    end: { scale: 1.15, focus: { x: 0.2, y: 0.8 } },
  };
  const start = kenBurnsFrame(motion, 0);
  const middle = kenBurnsFrame(motion, 0.5);
  const end = kenBurnsFrame(motion, 1);
  assert.equal(start.scale, 1);
  assert.equal(start.translateXPercent, 0);
  assert.ok(middle.scale > 1 && middle.scale < 1.15);
  assert.equal(Number(end.scale.toFixed(2)), 1.15);
  assert.ok(Math.abs(end.translateXPercent) <= 7.5 + Number.EPSILON);
  assert.ok(Math.abs(end.translateYPercent) <= 7.5 + Number.EPSILON);
  assert.match(end.transform, /^translate3d\(.+\) scale\(1\.1500\)$/);
  assert.equal(combineTransforms("none", end.transform, "scale(1.02)"), `${end.transform} scale(1.02)`);
  assert.deepEqual(
    motionWithClipSubject({ ...motion, focusSource: "clip-subject" }, { x: 0.75, y: 0.2 }).end.focus,
    { x: 0.75, y: 0.2 },
  );
});

test("approximately one third of authored cue loops carry subject-aware motion", () => {
  for (const scene of SCENES) {
    const motionLoops = scene.visualLoops.slice(1).filter((visualLoop) => visualLoop.events.some((event) => event.appearance.motion));
    assert.ok(motionLoops.length >= 2 && motionLoops.length <= 3, `${scene.id}: unexpected motion-loop count`);
    assert.ok(scene.visualLoops[0].events.every((event) => !event.appearance.motion), `${scene.id}: default loop should stay raw`);
    for (const visualLoop of motionLoops) {
      const animated = visualLoop.events.filter((event) => event.appearance.motion);
      assert.ok(animated.length >= 1);
      assert.equal(new Set(animated.map((event) => event.clipId)).size, 1);
      assert.ok(animated.every((event) => event.appearance.motion.progress === "loop"));
      if (scene.availability === "ready") {
        assert.equal(SUBJECT_FOCUS[scene.id]?.length, 12, `${scene.id}: incomplete subject analysis`);
        assert.deepEqual(subjectFocusFor(scene.id, animated[0].clipId), scene.clips.find((clip) => clip.id === animated[0].clipId).subjectFocus);
      }
    }
  }
});

test("loop-relative motion continues across repeated appearances of one clip", () => {
  const scene = SCENES.find((candidate) => candidate.id === "metropolis-machine");
  const atStart = resolve(scene, "cue-a-loop", 0)[0];
  const halfwayThroughFirstEvent = resolve(scene, "cue-a-loop", 2)[0];
  assert.equal(atStart.motion.type, "ken-burns");
  assert.equal(atStart.loopProgress, 0);
  assert.equal(halfwayThroughFirstEvent.loopProgress, 0.25);
  assert.notEqual(
    kenBurnsFrame(atStart.motion, atStart.loopProgress).transform,
    kenBurnsFrame(halfwayThroughFirstEvent.motion, halfwayThroughFirstEvent.loopProgress).transform,
  );
});

test("deck opacity normalizes fader intent to a 100 percent visual mix", () => {
  assert.deepEqual(computeDeckOpacities([
    { loaded: true, level: 1 },
    { loaded: true, level: 0.5 },
  ], 0.5), [2 / 3, 1 / 3]);
  assert.deepEqual(computeDeckOpacities([
    { loaded: true, level: 1 },
    { loaded: true, level: 1 },
  ], 0), [1, 0]);
  assert.deepEqual(computeDeckOpacities([
    { loaded: false, level: 1 },
    { loaded: true, level: 0.7 },
  ], 0.2), [0, 1]);
  assert.deepEqual(computeDeckOpacities([
    { loaded: true, level: 0 },
    { loaded: true, level: 0 },
  ], 0.5), [0, 0]);
  assert.equal(dominantDeck([0.67, 0.33]), 1);
  assert.equal(dominantDeck([0.5, 0.5]), null);
});

test("a deck load is counted once by the first qualifying event", () => {
  const songs = new SongCounter(2);
  songs.load(1);
  assert.equal(songs.qualify(1, "play").counted, true);
  assert.equal(songs.qualify(1, "hot-cue").counted, false);
  songs.load(1);
  assert.equal(songs.qualify(1, "became-dominant").total, 2);
});

test("checked-in scenes use persistent version 4 visual-loop mappings", async () => {
  for (const filename of sceneFiles) {
    const scene = await loadScene(filename);
    assert.equal(scene.schemaVersion, 4);
    const expectedClipCount = 12;
    assert.equal(scene.clips.length, expectedClipCount);
    assert.deepEqual(scene.clips.map((clip) => clip.id), Array.from({ length: expectedClipCount }, (_, index) => `clip-${index + 1}`));
    assert.ok(scene.clips.every((clip) => !("role" in clip) && !("filters" in clip)));
    assert.equal(scene.defaultLoopId, "song-default");
    const expectedLoopIds = ["song-default", "cue-a-loop", "cue-b-loop", "cue-c-loop", "cue-d-loop", "cue-e-loop", "cue-f-loop", "cue-g-loop"];
    assert.deepEqual(scene.visualLoops.map((visualLoop) => visualLoop.id), expectedLoopIds);
    assert.ok(scene.visualLoops.flatMap((visualLoop) => visualLoop.events).every((event) => event.source.loop));
    assert.deepEqual(scene.cueBindings.map((binding) => binding.cue.type), ["loop", "loop", "jump", "loop", "loop", "loop", "loop"]);
    assert.equal(scene.randomLoop.id, "random-loop");
    assert.deepEqual(scene.randomLoop.candidateClipIds, scene.clips.map((clip) => clip.id));
    assert.ok(scene.clips.filter((clip) => clip.startSeconds > 0).length >= 6);
    for (const binding of scene.cueBindings.filter((item) => item.cue.type === "loop")) {
      const visualLoop = scene.visualLoops.find((candidate) => candidate.id === binding.visual.loopId);
      assert.equal(musicalToBeats(binding.cue.length), musicalToBeats(visualLoop.length));
      assert.equal(binding.visual.retrigger, "audio-loop-cycle");
    }
    const cueC = scene.cueBindings.find((binding) => binding.input === "hotCueC");
    assert.equal(cueC.visual.loopId, "cue-c-loop");
    assert.equal(scene.advance.afterSongs, 1);
  }
});

test("Metropolis preserves its one, two, three, and four-bar opening loop lengths", async () => {
  const scene = await loadScene("metropolis-machine.scene.json");
  assert.deepEqual(scene.visualLoops.slice(0, 4).map((visualLoop) => musicalToBeats(visualLoop.length) / 4), [1, 2, 3, 4]);
  assert.deepEqual(scene.visualLoops.slice(0, 4).map((visualLoop) => visualLoop.events[0].clipId), ["clip-1", "clip-2", "clip-4", "clip-6"]);
  assert.equal(resolve(scene, "song-default", 4)[0].clipId, "clip-1");
  assert.equal(resolve(scene, "cue-a-loop", 8)[0].clipId, "clip-2");
  assert.equal(resolve(scene, "cue-b-loop", 12)[0].clipId, "clip-4");
  assert.equal(resolve(scene, "cue-c-loop", 16)[0].clipId, "clip-6");
});

test("Metropolis uses all twelve clips while limiting authored cross-loop reuse", async () => {
  const scene = await loadScene("metropolis-machine.scene.json");
  assert.deepEqual([...new Set(scene.visualLoops[0].events.map((event) => event.clipId))], ["clip-1"]);
  const loopUse = new Map();
  for (const visualLoop of scene.visualLoops.slice(1)) {
    const clipIds = new Set(visualLoop.events.map((event) => event.clipId));
    assert.equal(clipIds.size, 2, visualLoop.id);
    for (const clipId of clipIds) loopUse.set(clipId, (loopUse.get(clipId) ?? 0) + 1);
  }
  assert.deepEqual(new Set(["clip-1", ...loopUse.keys()]), new Set(scene.clips.map((clip) => clip.id)));
  assert.ok(Math.max(...loopUse.values()) <= 2);
});

test("every playable film uses twelve clips and lower-reuse two-clip cue loops", () => {
  for (const scene of PLAYABLE_SCENES) {
    assert.equal(scene.clips.length, 12, scene.id);
    const used = new Set(scene.visualLoops[0].events.map((event) => event.clipId));
    const loopUse = new Map([...used].map((clipId) => [clipId, 1]));
    for (const visualLoop of scene.visualLoops.slice(1)) {
      const clipIds = new Set(visualLoop.events.map((event) => event.clipId));
      assert.equal(clipIds.size, 2, `${scene.id}:${visualLoop.id}`);
      for (const clipId of clipIds) {
        used.add(clipId);
        loopUse.set(clipId, (loopUse.get(clipId) ?? 0) + 1);
      }
    }
    assert.deepEqual(used, new Set(scene.clips.map((clip) => clip.id)), scene.id);
    assert.ok(Math.max(...loopUse.values()) <= 2, scene.id);
  }
});

test("runtime catalog is film-only, with twelve clips in every playable scene", () => {
  assert.equal(SCENES.length, 36);
  assert.ok(SCENES.every((scene) => scene.clips.length >= 8));
  assert.ok(PLAYABLE_SCENES.every((scene) => scene.clips.length === 12));
  assert.deepEqual(PLAYABLE_SCENES.map((scene) => scene.id), [
    "metropolis-machine",
    "gumby-clay-trip",
    "swing-you-sinners",
    "fiddlesticks",
    "skeleton-dance",
    "prince-achmed",
    "trip-to-the-moon",
    "king-of-jazz",
    "whoopee",
    "gullivers-travels",
    "nothing-sacred",
    "charade",
    "cameramans-revenge",
    "the-lodger",
    "underworld",
    "docks-of-new-york",
    "haxan",
    "nosferatu",
    "cat-and-canary",
    "usher",
    "aelita",
    "woman-in-moon",
    "crazy-ray",
    "mechanical-man",
    "iron-horse",
    "three-bad-men",
    "movie-camera",
    "ballet-mecanique",
  ]);
});

test("scene queue assigns a repeated scene for exactly the configured number of song loads", () => {
  const queue = new SceneQueue(["one", "two"], {
    items: [
      { id: "first", sceneId: "one", repetitions: 3 },
      { id: "second", sceneId: "two", repetitions: 1 },
    ],
    cursorIndex: 0,
    used: 0,
  });
  assert.deepEqual([queue.claim().sceneId, queue.claim().sceneId, queue.claim().sceneId, queue.claim().sceneId], ["one", "one", "one", "two"]);
  assert.equal(queue.next.sceneId, "one");
});

test("selecting a queue item resets its progress and continues from that point", () => {
  const queue = new SceneQueue(["one", "two", "three"], {
    items: [
      { id: "first", sceneId: "one", repetitions: 3 },
      { id: "second", sceneId: "two", repetitions: 2 },
      { id: "third", sceneId: "three", repetitions: 1 },
    ],
    cursorIndex: 0,
    used: 2,
  });
  assert.equal(queue.select("second"), true);
  assert.equal(queue.used, 0);
  assert.deepEqual([queue.claim().sceneId, queue.claim().sceneId, queue.claim().sceneId], ["two", "two", "three"]);
});

test("scene usage totals every configured song repetition", () => {
  const queue = new SceneQueue(["one", "two"], {
    items: [
      { id: "one-a", sceneId: "one", repetitions: 1 },
      { id: "one-b", sceneId: "one", repetitions: 2 },
      { id: "two-a", sceneId: "two", repetitions: 4 },
    ],
  });
  assert.equal(queue.usageFor("one"), 3);
  assert.equal(queue.usageFor("two"), 4);
});

test("a saved queue containing only retired scenes falls back to the film catalog", () => {
  const queue = new SceneQueue(["film-one", "film-two"], {
    items: [{ id: "retired", sceneId: "not-in-catalog", repetitions: 4 }],
    cursorIndex: 0,
    used: 3,
  });
  assert.deepEqual(queue.items.map((item) => item.sceneId), ["film-one", "film-two"]);
  assert.equal(queue.next.sceneId, "film-one");
});

test("alternating deck loads consume one shared scene-queue position per song", () => {
  const queue = new SceneQueue(["one", "two", "three"], {
    items: [
      { id: "first", sceneId: "one", repetitions: 1 },
      { id: "second", sceneId: "two", repetitions: 1 },
      { id: "third", sceneId: "three", repetitions: 1 },
    ],
    cursorIndex: 0,
    used: 0,
  });
  const deckScenes = new Map();
  const load = (deck) => deckScenes.set(deck, queue.claim().sceneId);
  load(1);
  assert.deepEqual(Object.fromEntries(deckScenes), { 1: "one" });
  load(2);
  assert.deepEqual(Object.fromEntries(deckScenes), { 1: "one", 2: "two" });
  load(1);
  assert.deepEqual(Object.fromEntries(deckScenes), { 1: "three", 2: "two" });
});

test("reordering the scene queue preserves which entry will be claimed next", () => {
  const queue = new SceneQueue(["one", "two", "three"]);
  queue.claim();
  const currentId = queue.next.id;
  queue.move(currentId, 0);
  assert.equal(queue.next.id, currentId);
  assert.equal(queue.claim().sceneId, "two");
});
