import { VisualEngine } from "./engine.mjs";
import { clockFromLinkMessage, commandFromController, rekordboxTempoPlan, resolveHotCueRoute, transportEntriesForEvent } from "./bridge-controls.mjs";
import { BEAT_FX_CATALOG, beatFxById, formatBeatMultiplier, stepBeatMultiplier } from "./effects.mjs";
import { LinkMetronome } from "./metronome.mjs";
import { computeDeckOpacities, dominantDeck } from "./mix.mjs";
import { createPhraseClock, phraseBeatAt, syncPhraseClock, visualLoopWindows } from "./phrase-transport.mjs";
import { PLAYABLE_SCENES, SCENES } from "./scene-registry.mjs";
import { parseSavedSceneQueue, SceneQueue } from "./scene-queue.mjs";
import { authoredClipOrder, clipOrderForAssignment, normalizeClipOrder, remapSceneClipId } from "./scene-variation.mjs";
import { generateRandomLoop } from "./random-loop.mjs";
import { beatAt, SongCounter, nowEpochMs, reanchorClock } from "./scheduler.mjs";
import { musicalToBeats } from "./sequencer.mjs";
import { parseDeckRuntime, serializeDeckRuntime } from "./transport-state.mjs";
import { crossedHotCues } from "./cue-crossings.mjs";

const channel = new BroadcastChannel("video-sync-poc-v4");
const songCounter = new SongCounter(2);
const sceneQueueStorageKey = "video-sync-scene-queue-v1";
const deckRuntimeStorageKey = "video-sync-deck-runtime-v1";
let savedSceneQueue = null;
try {
  savedSceneQueue = parseSavedSceneQueue(localStorage.getItem(sceneQueueStorageKey));
} catch {
  // Persistence is optional; the sequencer still works for this session.
}
let sceneQueue = new SceneQueue(PLAYABLE_SCENES.map((scene) => scene.id), savedSceneQueue);
const stage = document.querySelector("#preview-stage");
const paneLayout = document.querySelector(".layout");
const paneResizer = document.querySelector("#pane-resizer");
const paneRatioStorageKey = "video-sync-pane-ratio";
const defaultPaneRatio = 0.65;
let paneRatio = defaultPaneRatio;
let resizingPointerId = null;

try {
  const savedPaneRatio = Number(localStorage.getItem(paneRatioStorageKey));
  if (Number.isFinite(savedPaneRatio) && savedPaneRatio > 0) paneRatio = savedPaneRatio;
} catch {
  // A blocked storage API should not affect the live controls.
}

function paneGeometry() {
  const styles = getComputedStyle(paneLayout);
  const gap = Number.parseFloat(styles.columnGap) || 0;
  const dividerWidth = paneResizer.getBoundingClientRect().width;
  const availableWidth = Math.max(1, paneLayout.clientWidth - dividerWidth - (gap * 2));
  const minimumLeft = Math.min(420, availableWidth * 0.5);
  const minimumRight = Math.min(360, availableWidth - minimumLeft);
  return {
    availableWidth,
    gap,
    dividerWidth,
    minimumRatio: minimumLeft / availableWidth,
    maximumRatio: (availableWidth - minimumRight) / availableWidth,
  };
}

function applyPaneRatio(nextRatio) {
  paneRatio = nextRatio;
  if (!window.matchMedia("(min-width: 1051px)").matches) return;
  const geometry = paneGeometry();
  paneRatio = Math.min(geometry.maximumRatio, Math.max(geometry.minimumRatio, paneRatio));
  paneLayout.style.setProperty("--left-pane", `${geometry.availableWidth * paneRatio}px`);
  paneResizer.setAttribute("aria-valuenow", String(Math.round(paneRatio * 100)));
}

function savePaneRatio() {
  try {
    localStorage.setItem(paneRatioStorageKey, String(paneRatio));
  } catch {
    // Resizing still works for the current session if storage is unavailable.
  }
}

function finishPaneResize() {
  resizingPointerId = null;
  paneResizer.classList.remove("is-dragging");
  document.body.classList.remove("is-pane-resizing");
}

paneResizer.addEventListener("pointerdown", (event) => {
  if (event.button !== 0 || !window.matchMedia("(min-width: 1051px)").matches) return;
  resizingPointerId = event.pointerId;
  paneResizer.focus({ preventScroll: true });
  paneResizer.setPointerCapture(event.pointerId);
  paneResizer.classList.add("is-dragging");
  document.body.classList.add("is-pane-resizing");
  event.preventDefault();
});

paneResizer.addEventListener("pointermove", (event) => {
  if (event.pointerId !== resizingPointerId) return;
  const geometry = paneGeometry();
  const bounds = paneLayout.getBoundingClientRect();
  const leftWidth = event.clientX - bounds.left - geometry.gap - (geometry.dividerWidth / 2);
  applyPaneRatio(leftWidth / geometry.availableWidth);
});

paneResizer.addEventListener("pointerup", (event) => {
  if (event.pointerId !== resizingPointerId) return;
  savePaneRatio();
  finishPaneResize();
});
paneResizer.addEventListener("pointercancel", finishPaneResize);
paneResizer.addEventListener("lostpointercapture", finishPaneResize);

paneResizer.addEventListener("keydown", (event) => {
  if (!["ArrowLeft", "ArrowRight", "Home"].includes(event.key)) return;
  event.preventDefault();
  const nextRatio = event.key === "Home"
    ? defaultPaneRatio
    : paneRatio + (event.key === "ArrowRight" ? 0.025 : -0.025);
  applyPaneRatio(nextRatio);
  savePaneRatio();
});

paneResizer.addEventListener("dblclick", () => {
  applyPaneRatio(defaultPaneRatio);
  savePaneRatio();
});

new ResizeObserver(() => applyPaneRatio(paneRatio)).observe(paneLayout);
applyPaneRatio(paneRatio);

function makeDeck(id, sceneId) {
  const selectedScene = sceneById(sceneId);
  return {
    id,
    sceneId,
    generation: 0,
    loaded: false,
    playing: false,
    started: false,
    counted: false,
    level: 1,
    clipOrder: authoredClipOrder(selectedScene),
    randomLoop: null,
    activeLoopId: selectedScene.defaultLoopId,
    activeCueInput: null,
    cueAnchorLinkBeat: null,
    loopAnchorBeat: 0,
    loopGeneration: 0,
    clock: { bpm: 100, playing: false, anchorBeat: 0, anchorEpochMs: nowEpochMs() },
  };
}

function sceneById(id) {
  return SCENES.find((scene) => scene.id === id) ?? SCENES[0];
}

let snapshot = {
  linkClock: { bpm: 100, playing: true, anchorBeat: 0, anchorEpochMs: nowEpochMs() },
  phraseClock: createPhraseClock(100, nowEpochMs()),
  decks: [makeDeck(1, SCENES[0].id), makeDeck(2, SCENES[1].id)],
  crossfader: 0.5,
  opacities: [0, 0],
  songCount: 0,
  effects: {
    beatFx: { selected: "delay", enabled: false, target: "master", depth: 0.5, beatMultiplier: 1 },
  },
};

try {
  const restored = parseDeckRuntime(sessionStorage.getItem(deckRuntimeStorageKey), SCENES.map((scene) => scene.id));
  if (restored) {
    snapshot.decks = snapshot.decks.map((deck, index) => {
      const saved = restored[index];
      if (!saved) return deck;
      const scene = sceneById(saved.sceneId);
      const randomLoop = saved.randomLoop ?? (saved.loaded ? generateRandomLoop(scene) : null);
      const activeLoopId = scene.visualLoops.some((loop) => loop.id === saved.activeLoopId) || randomLoop?.id === saved.activeLoopId
        ? saved.activeLoopId
        : scene.defaultLoopId;
      return { ...deck, ...saved, randomLoop, activeLoopId, clipOrder: normalizeClipOrder(scene, saved.clipOrder) };
    });
  }
} catch {
  // Runtime persistence is only a reload aid; the live controls still work without it.
}

if (snapshot.decks.some((deck) => deck.playing)) {
  snapshot.phraseClock = syncPhraseClock(snapshot.phraseClock, {
    wasAnyPlaying: false,
    isAnyPlaying: true,
    epochMs: nowEpochMs(),
    bpm: snapshot.linkClock.bpm,
  });
}

function saveDeckRuntime() {
  try {
    sessionStorage.setItem(deckRuntimeStorageKey, serializeDeckRuntime(snapshot.decks));
  } catch {
    // A blocked storage API should not affect transport control.
  }
}

let lastPhraseCycle = -1;
const engine = new VisualEngine(stage, (metrics) => {
  const timeline = document.querySelector("#phrase-timeline");
  const phraseCounter = timeline.closest(".phrase-counter");
  phraseCounter.classList.toggle("is-inactive", !metrics.phraseActive);
  timeline.setAttribute("aria-disabled", String(!metrics.phraseActive));
  timeline.setAttribute("aria-valuenow", String(metrics.phraseActive ? Math.round(metrics.phraseProgress * 100) : 0));
  timeline.querySelectorAll("[data-phrase-bar]").forEach((bar) => {
    const barNumber = Number(bar.dataset.phraseBar);
    const progress = metrics.phraseActive
      ? barNumber < metrics.phraseBar ? 100 : barNumber === metrics.phraseBar ? metrics.phraseBarProgress * 100 : 0
      : 0;
    bar.classList.toggle("is-current", metrics.phraseActive && barNumber === metrics.phraseBar);
    bar.classList.toggle("is-complete", metrics.phraseActive && barNumber < metrics.phraseBar);
    bar.style.setProperty("--bar-progress", `${progress}%`);
  });
  document.querySelectorAll(".cue-track").forEach((track) => {
    track.style.setProperty("--playhead", `${metrics.phraseActive ? metrics.phraseProgress * 100 : 0}%`);
  });
  if (metrics.phraseActive && metrics.phraseCycle !== lastPhraseCycle) {
    snapshot.decks.forEach((deck, index) => renderCueUi(deck, index + 1, sceneById(deck.sceneId)));
  }
  lastPhraseCycle = metrics.phraseActive ? metrics.phraseCycle : -1;
});

const metronomeButton = document.querySelector("#metronome");
const bpmInput = document.querySelector("#bpm");
const metronome = new LinkMetronome(() => snapshot.linkClock, (enabled) => {
  metronomeButton.textContent = enabled ? "Metronome on" : "Metronome off";
  metronomeButton.setAttribute("aria-pressed", String(enabled));
});

document.querySelectorAll("[data-scene-deck]").forEach((select) => {
  SCENES.forEach((scene) => {
    const option = document.createElement("option");
    option.value = scene.id;
    option.textContent = scene.availability === "ready" ? scene.name : `${scene.name} · source needed`;
    option.disabled = scene.availability !== "ready";
    select.append(option);
  });
  const deck = snapshot.decks[Number(select.dataset.sceneDeck) - 1];
  select.value = deck.sceneId;
});

const beatFxSelect = document.querySelector("#beatfx-select");
for (const effect of BEAT_FX_CATALOG) {
  const option = document.createElement("option");
  option.value = effect.id;
  option.textContent = effect.label;
  beatFxSelect.append(option);
}

function recomputeMix() {
  snapshot.opacities = computeDeckOpacities(snapshot.decks, snapshot.crossfader);
  const dominant = dominantDeck(snapshot.opacities);
  if (dominant && snapshot.decks[dominant - 1].playing) qualifySong(dominant, "became-dominant");
}

function broadcastSnapshot() {
  recomputeMix();
  engine.applySnapshot(snapshot);
  channel.postMessage({ type: "snapshot", snapshot });
  renderState();
}

function anyDeckPlaying() {
  return snapshot.decks.some((deck) => deck.playing);
}

function updatePhraseTransport(wasAnyPlaying, epochMs = nowEpochMs()) {
  snapshot.phraseClock = syncPhraseClock(snapshot.phraseClock, {
    wasAnyPlaying,
    isAnyPlaying: anyDeckPlaying(),
    epochMs,
    bpm: snapshot.linkClock.bpm,
  });
}

function loadDeck(deckNumber) {
  const wasAnyPlaying = anyDeckPlaying();
  const deck = snapshot.decks[deckNumber - 1];
  const assignment = sceneQueue.claim();
  if (assignment) {
    deck.sceneId = assignment.sceneId;
    deck.sequenceAssignment = assignment;
    deck.clipOrder = clipOrderForAssignment(sceneById(deck.sceneId), assignment);
    saveSceneQueue();
  }
  const scene = sceneById(deck.sceneId);
  deck.randomLoop = generateRandomLoop(scene);
  songCounter.load(deckNumber);
  deck.generation += 1;
  deck.loaded = true;
  deck.playing = false;
  deck.started = false;
  deck.counted = false;
  deck.activeLoopId = scene.defaultLoopId;
  deck.activeCueInput = null;
  deck.cueAnchorLinkBeat = null;
  deck.loopAnchorBeat = 0;
  deck.loopGeneration += 1;
  deck.clock = { bpm: snapshot.linkClock.bpm, playing: false, anchorBeat: 0, anchorEpochMs: nowEpochMs() };
  updatePhraseTransport(wasAnyPlaying);
  saveDeckRuntime();
}

function toggleDeck(deckNumber) {
  const wasAnyPlaying = anyDeckPlaying();
  const deck = snapshot.decks[deckNumber - 1];
  if (!deck.loaded) loadDeck(deckNumber);
  const now = nowEpochMs();
  deck.playing = !deck.playing;
  deck.started ||= deck.playing;
  deck.clock = reanchorClock(deck.clock, now, { playing: deck.playing });
  if (deck.playing) qualifySong(deckNumber, "play");
  updatePhraseTransport(wasAnyPlaying, now);
  saveDeckRuntime();
  broadcastSnapshot();
}

function setDeckPlaying(deckNumber, playing) {
  const wasAnyPlaying = anyDeckPlaying();
  const deck = snapshot.decks[deckNumber - 1];
  const wasLoaded = deck.loaded;
  if (!wasLoaded) loadDeck(deckNumber);
  const nextPlaying = Boolean(playing);
  if (deck.playing === nextPlaying) {
    if (!wasLoaded) broadcastSnapshot();
    return;
  }
  deck.playing = nextPlaying;
  deck.started ||= nextPlaying;
  deck.clock = reanchorClock(deck.clock, nowEpochMs(), { playing: nextPlaying });
  if (nextPlaying) qualifySong(deckNumber, "play");
  updatePhraseTransport(wasAnyPlaying);
  saveDeckRuntime();
  broadcastSnapshot();
}

function ensureDeckPlaying(deckNumber, reason) {
  const wasAnyPlaying = anyDeckPlaying();
  const deck = snapshot.decks[deckNumber - 1];
  if (!deck.loaded) loadDeck(deckNumber);
  if (!deck.playing) {
    deck.playing = true;
    deck.started = true;
    deck.clock = reanchorClock(deck.clock, nowEpochMs(), { playing: true });
  }
  updatePhraseTransport(wasAnyPlaying);
  qualifySong(deckNumber, reason);
}

function qualifySong(deckNumber, reason) {
  const result = songCounter.qualify(deckNumber, reason);
  if (!result.counted) return;
  snapshot.decks[deckNumber - 1].counted = true;
  snapshot.songCount = result.total;
}

const automaticCueObservations = new Map();
const manualCueSuppressionUntil = new Map();

function triggerCue(deckNumber, cueIndex, options = {}) {
  const deck = snapshot.decks[deckNumber - 1];
  if (!deck.loaded) loadDeck(deckNumber);
  const route = resolveHotCueRoute(sceneById(deck.sceneId), cueIndex, deck.randomLoop);
  ensureDeckPlaying(deckNumber, route.input);
  const epochMs = nowEpochMs();
  const requestedAnchor = Number(options.anchorEpochMs);
  const anchorEpochMs = Number.isFinite(requestedAnchor)
    ? Math.min(epochMs, Math.max(epochMs - 5000, requestedAnchor))
    : epochMs;
  if (!options.automatic) manualCueSuppressionUntil.set(deckNumber, epochMs + 1500);
  deck.activeLoopId = route.loopId;
  deck.activeCueInput = route.activeCueInput;
  deck.cueAnchorLinkBeat = route.binding ? beatAt(snapshot.linkClock, anchorEpochMs) : null;
  deck.loopAnchorBeat = beatAt(deck.clock, anchorEpochMs);
  deck.loopGeneration += 1;
  saveDeckRuntime();
  broadcastSnapshot();
}

function applyAutomaticCueCrossings(message) {
  const epochMs = message.emittedAtUnixMs ?? nowEpochMs();
  for (const deckState of message.payload?.decks ?? []) {
    const deckNumber = Number(deckState.deck);
    const positionSeconds = typeof deckState.positionSeconds === "number" ? deckState.positionSeconds : NaN;
    if (!Number.isInteger(deckNumber) || !Number.isFinite(positionSeconds)) continue;
    const current = {
      positionSeconds,
      hotCues: deckState.hotCues ?? [],
      epochMs,
    };
    const previous = automaticCueObservations.get(deckNumber);
    automaticCueObservations.set(deckNumber, current);
    if (epochMs < (manualCueSuppressionUntil.get(deckNumber) ?? 0)) continue;

    const deck = snapshot.decks[deckNumber - 1];
    const scene = deck ? sceneById(deck.sceneId) : null;
    if (!deck || !scene) continue;
    // Let the normal cue router handle every visible Rekordbox cue. In
    // particular, H intentionally has no fixed scene binding and resolves to
    // the deck's generated random loop. Filtering to authored bindings here
    // made that orange loop marker disappear during passive playback even
    // though pressing H manually worked.
    const crossing = crossedHotCues(previous, current, { playing: deck.playing }).at(-1);
    if (!crossing) continue;
    triggerCue(deckNumber, crossing.cueIndex, {
      automatic: true,
      anchorEpochMs: crossing.crossedAtEpochMs,
    });
    appendBridgeEvent(
      `auto cue · D${deckNumber} · ${String.fromCharCode(65 + crossing.cueIndex)} · ${(crossing.observedAtEpochMs - crossing.crossedAtEpochMs).toFixed(0)} ms compensated`,
      "control",
      epochMs,
    );
  }
}

function setBpm(bpm) {
  const now = nowEpochMs();
  snapshot.linkClock = reanchorClock(snapshot.linkClock, now, { bpm });
  snapshot.phraseClock = syncPhraseClock(snapshot.phraseClock, {
    wasAnyPlaying: anyDeckPlaying(),
    isAnyPlaying: anyDeckPlaying(),
    epochMs: now,
    bpm,
  });
  snapshot.decks = snapshot.decks.map((deck) => ({
    ...deck,
    clock: reanchorClock(deck.clock, now, { bpm }),
  }));
  broadcastSnapshot();
}

function bars(value) {
  return musicalToBeats(value) / 4;
}

function cueLetter(input) {
  return input.replace("hotCue", "");
}

function cueKind(binding) {
  if (binding.cue.type === "loop") return `${bars(binding.cue.length)}-bar audio loop`;
  return binding.cue.type === "random" ? "random fallback" : "jump cue";
}

function visualLoopForDeck(scene, deck, loopId = deck.activeLoopId) {
  return scene.visualLoops.find((visualLoop) => visualLoop.id === loopId)
    ?? (deck.randomLoop?.id === loopId ? deck.randomLoop : null);
}

function activeCueBinding(scene, deck) {
  const binding = scene.cueBindings.find((candidate) => candidate.input === deck.activeCueInput);
  if (binding) return binding;
  if (!deck.activeCueInput || !deck.randomLoop || deck.activeLoopId !== deck.randomLoop.id) return null;
  return {
    input: deck.activeCueInput,
    cue: { type: "random" },
    visual: { loopId: deck.randomLoop.id, retrigger: "cue-trigger" },
  };
}

function appendCueSegment(track, leftBars, widthBars, clipId, title) {
  const segment = document.createElement("span");
  segment.className = "cue-segment";
  segment.style.left = `${(leftBars / 16) * 100}%`;
  segment.style.width = `${(widthBars / 16) * 100}%`;
  segment.textContent = clipId.replace("clip-", "Clip ");
  segment.setAttribute("aria-label", title);
  track.append(segment);
}

function appendLoopWindow(track, leftBars, widthBars, alternate, title) {
  const window = document.createElement("span");
  window.className = `cue-loop-window${alternate ? " is-alternate" : ""}`;
  window.style.left = `${(leftBars / 16) * 100}%`;
  window.style.width = `${(widthBars / 16) * 100}%`;
  window.setAttribute("aria-label", title);
  track.append(window);
}

function renderCueLane(deck, deckNumber, scene, binding, visualLoop) {
  const lane = document.querySelector(`[data-cue-lane='${deckNumber}']`);
  if (!binding || !visualLoop || !deck.playing || !snapshot.phraseClock.playing) {
    lane.hidden = true;
    lane.querySelector(".cue-track").replaceChildren();
    return;
  }

  const loopBars = bars(visualLoop.length);
  const epochMs = nowEpochMs();
  const phraseBeat = phraseBeatAt(snapshot.phraseClock, epochMs);
  const deckBeat = beatAt(deck.clock, epochMs);
  const windows = visualLoopWindows({
    phraseBeat,
    deckBeat,
    loopAnchorBeat: deck.loopAnchorBeat,
    loopLengthBeats: musicalToBeats(visualLoop.length),
    loopStartPhraseBeat: phraseBeat - Math.max(0, deckBeat - deck.loopAnchorBeat),
  });
  lane.hidden = false;
  lane.setAttribute("aria-label", `Deck ${deckNumber}, Hot Cue ${cueLetter(binding.input)}, ${loopBars}-bar visual loop`);
  const track = lane.querySelector(".cue-track");
  track.replaceChildren();
  windows.forEach((window, windowIndex) => {
    appendLoopWindow(
      track,
      window.visibleStartBars,
      window.visibleEndBars - window.visibleStartBars,
      windowIndex % 2 === 1,
      `Visual loop from bar ${window.startBars + 1} to ${window.endBars + 1}`,
    );
    for (const event of visualLoop.events) {
      const eventAt = window.startBars + bars(event.at);
      const eventEnd = eventAt + bars(event.duration);
      const visibleStart = Math.max(0, eventAt);
      const visibleEnd = Math.min(16, eventEnd);
      if (visibleEnd <= visibleStart) continue;
      const mappedClipId = remapSceneClipId(scene, deck.clipOrder, event.clipId);
      const clip = scene.clips.find((candidate) => candidate.id === mappedClipId);
      appendCueSegment(
        track,
        visibleStart,
        visibleEnd - visibleStart,
        mappedClipId,
        `Deck ${deckNumber}, Hot Cue ${cueLetter(binding.input)}, ${clip?.label ?? mappedClipId}`,
      );
    }
  });
}

function renderCueDetail(deck, deckNumber, scene, binding, visualLoop) {
  const detail = document.querySelector(`[data-cue-detail='${deckNumber}']`);
  if (!binding || !visualLoop) {
    detail.hidden = true;
    detail.replaceChildren();
    return;
  }

  detail.hidden = false;
  detail.replaceChildren();
  const head = document.createElement("div");
  head.className = "cue-detail-head";
  const title = document.createElement("strong");
  title.textContent = `Hot Cue ${cueLetter(binding.input)}`;
  const summary = document.createElement("span");
  summary.textContent = `${cueKind(binding)} · ${bars(visualLoop.length)}-bar visual loop`;
  head.append(title, summary);
  detail.append(head);

  for (const event of visualLoop.events) {
    const row = document.createElement("div");
    row.className = "cue-event";
    const timing = document.createElement("b");
    timing.textContent = `${bars(event.at)} → ${bars(event.at) + bars(event.duration)} bars`;
    const description = document.createElement("span");
    const mappedClipId = remapSceneClipId(scene, deck.clipOrder, event.clipId);
    const clip = scene.clips.find((candidate) => candidate.id === mappedClipId);
    const filters = event.appearance.filters?.length ? event.appearance.filters.map((filter) => filter.type).join(", ") : "raw";
    const motion = event.appearance.motion ? " · slow pan/zoom" : "";
    description.textContent = `${mappedClipId.replace("clip-", "Clip ")} · ${clip?.label ?? "unknown"} · source ${event.source.startSeconds.toFixed(1)}s · ${event.source.loop ? "media loops" : "play once"} · ${filters}${motion}`;
    row.append(timing, description);
    detail.append(row);
  }
}

function renderCueUi(deck, deckNumber, scene) {
  const binding = activeCueBinding(scene, deck);
  const visualLoop = binding ? visualLoopForDeck(scene, deck, binding.visual.loopId) : null;
  renderCueDetail(deck, deckNumber, scene, binding, visualLoop);
  renderCueLane(deck, deckNumber, scene, binding, visualLoop);
}

function saveSceneQueue() {
  try {
    localStorage.setItem(sceneQueueStorageKey, JSON.stringify(sceneQueue));
  } catch {
    // The live queue remains available if persistence is blocked.
  }
}

let queueRenderSignature = "";
let draggedQueueItemId = null;

function queueSignature() {
  return JSON.stringify(sceneQueue);
}

function sceneOptions(selectedId, showUsage = false) {
  const fragment = document.createDocumentFragment();
  for (const scene of PLAYABLE_SCENES) {
    const option = document.createElement("option");
    option.value = scene.id;
    const usage = showUsage ? sceneQueue.usageFor(scene.id) : 0;
    option.textContent = usage > 0 ? `${scene.name} · ×${usage}` : scene.name;
    option.selected = scene.id === selectedId;
    fragment.append(option);
  }
  return fragment;
}

function mutateSceneQueue(mutation) {
  mutation();
  saveSceneQueue();
  queueRenderSignature = "";
  renderSceneQueue();
}

function renderSceneQueue() {
  const signature = queueSignature();
  if (signature === queueRenderSignature) return;
  queueRenderSignature = signature;
  const list = document.querySelector("#scene-queue");
  list.replaceChildren();

  sceneQueue.items.forEach((item, index) => {
    const row = document.createElement("li");
    row.className = "scene-queue-item";
    row.dataset.queueItem = item.id;
    row.draggable = true;
    row.tabIndex = 0;
    row.title = "Make this the next scene and continue from here";
    row.setAttribute("aria-current", index === sceneQueue.cursorIndex ? "step" : "false");
    row.classList.toggle("is-next", index === sceneQueue.cursorIndex);

    const handle = document.createElement("span");
    handle.className = "queue-handle";
    handle.textContent = "⠿";
    handle.title = "Drag to reorder";

    const position = document.createElement("span");
    position.className = "queue-position";
    position.textContent = String(index + 1).padStart(2, "0");

    const select = document.createElement("select");
    select.className = "queue-scene-select";
    select.setAttribute("aria-label", `Scene ${index + 1}`);
    select.append(sceneOptions(item.sceneId));
    select.addEventListener("change", () => mutateSceneQueue(() => sceneQueue.setScene(item.id, select.value)));

    const repeat = document.createElement("div");
    repeat.className = "queue-repeat-control";
    repeat.setAttribute("role", "group");
    repeat.setAttribute("aria-label", `Songs for ${sceneById(item.sceneId).name}`);

    const repeatDown = document.createElement("button");
    repeatDown.type = "button";
    repeatDown.className = "queue-repeat-step";
    repeatDown.textContent = "−";
    repeatDown.title = "Use for one fewer song";
    repeatDown.setAttribute("aria-label", `Decrease songs for ${sceneById(item.sceneId).name}`);
    repeatDown.disabled = item.repetitions <= 1;
    repeatDown.addEventListener("click", () => mutateSceneQueue(() => sceneQueue.setRepetitions(item.id, item.repetitions - 1)));

    const repeatValue = document.createElement("span");
    repeatValue.className = "queue-repeat-value";
    repeatValue.textContent = `×${item.repetitions}`;
    repeatValue.setAttribute("aria-label", `${item.repetitions} song${item.repetitions === 1 ? "" : "s"}`);

    const repeatUp = document.createElement("button");
    repeatUp.type = "button";
    repeatUp.className = "queue-repeat-step";
    repeatUp.textContent = "+";
    repeatUp.title = "Use for one more song";
    repeatUp.setAttribute("aria-label", `Increase songs for ${sceneById(item.sceneId).name}`);
    repeatUp.disabled = item.repetitions >= 8;
    repeatUp.addEventListener("click", () => mutateSceneQueue(() => sceneQueue.setRepetitions(item.id, item.repetitions + 1)));
    repeat.append(repeatDown, repeatValue, repeatUp);

    const progress = document.createElement("span");
    progress.className = "queue-progress";
    progress.textContent = index === sceneQueue.cursorIndex
      ? `next · ${sceneQueue.used}/${item.repetitions} used`
      : `${item.repetitions} song${item.repetitions === 1 ? "" : "s"}`;

    const up = document.createElement("button");
    up.type = "button";
    up.className = "queue-nudge queue-nudge-up";
    up.textContent = "↑";
    up.title = "Move up";
    up.disabled = index === 0;
    up.addEventListener("click", () => mutateSceneQueue(() => sceneQueue.move(item.id, index - 1)));

    const down = document.createElement("button");
    down.type = "button";
    down.className = "queue-nudge queue-nudge-down";
    down.textContent = "↓";
    down.title = "Move down";
    down.disabled = index === sceneQueue.items.length - 1;
    down.addEventListener("click", () => mutateSceneQueue(() => sceneQueue.move(item.id, index + 1)));

    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "queue-remove";
    remove.textContent = "×";
    remove.title = "Remove from queue";
    remove.disabled = sceneQueue.items.length === 1;
    remove.addEventListener("click", () => mutateSceneQueue(() => sceneQueue.remove(item.id)));

    row.addEventListener("click", (event) => {
      if (event.target.closest("button, select, .queue-handle")) return;
      mutateSceneQueue(() => sceneQueue.select(item.id));
    });
    row.addEventListener("keydown", (event) => {
      if (event.target !== row || !["Enter", " "].includes(event.key)) return;
      event.preventDefault();
      mutateSceneQueue(() => sceneQueue.select(item.id));
    });

    row.addEventListener("dragstart", (event) => {
      draggedQueueItemId = item.id;
      row.classList.add("is-dragging");
      event.dataTransfer.effectAllowed = "move";
      event.dataTransfer.setData("text/plain", item.id);
    });
    row.addEventListener("dragover", (event) => {
      if (!draggedQueueItemId || draggedQueueItemId === item.id) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = "move";
      row.classList.add("is-drop-target");
    });
    row.addEventListener("dragleave", () => row.classList.remove("is-drop-target"));
    row.addEventListener("drop", (event) => {
      event.preventDefault();
      row.classList.remove("is-drop-target");
      const movedId = draggedQueueItemId || event.dataTransfer.getData("text/plain");
      mutateSceneQueue(() => sceneQueue.move(movedId, index));
    });
    row.addEventListener("dragend", () => {
      draggedQueueItemId = null;
      document.querySelectorAll(".scene-queue-item").forEach((candidate) => candidate.classList.remove("is-dragging", "is-drop-target"));
    });

    row.append(handle, position, up, down, select, repeat, progress, remove);
    list.append(row);
  });

  const nextScene = sceneById(sceneQueue.next?.sceneId);
  document.querySelector("#scene-queue-status").textContent = `Next load: ${nextScene.name}`;
}

function renderState() {
  if (document.activeElement !== bpmInput) bpmInput.value = snapshot.linkClock.bpm.toFixed(2);
  document.querySelector("#crossfader").value = String(snapshot.crossfader * 100);
  const beatFx = snapshot.effects.beatFx;
  const beatFxDefinition = beatFxById(beatFx.selected);
  document.querySelector("#beatfx-select").value = beatFxDefinition.id;
  document.querySelector("#beatfx-target").value = ["master", "deck1", "deck2", "deck3", "deck4", "sampler"].includes(beatFx.target) ? beatFx.target : "sampler";
  document.querySelector("#beatfx-depth").value = String(beatFx.depth * 100);
  document.querySelector("#beatfx-depth-value").textContent = `${Math.round(beatFx.depth * 100)}%`;
  document.querySelector("#beatfx-beats").textContent = formatBeatMultiplier(beatFx.beatMultiplier);
  const beatFxToggle = document.querySelector("#beatfx-toggle");
  beatFxToggle.textContent = beatFx.enabled ? "FX on" : "FX off";
  beatFxToggle.setAttribute("aria-pressed", String(beatFx.enabled));
  const beatFxStatus = document.querySelector("#beatfx-status");
  beatFxStatus.textContent = beatFx.enabled ? `${beatFxDefinition.label} · ${beatFx.target.replace("deck", "D")}` : "Off";
  beatFxStatus.classList.toggle("is-active", beatFx.enabled);

  snapshot.decks.forEach((deck, index) => {
    const deckNumber = index + 1;
    const opacityPercent = Math.round(snapshot.opacities[index] * 100);
    const card = document.querySelector(`[data-deck-card='${deckNumber}']`);
    card.classList.toggle("is-playing", deck.playing);
    card.classList.toggle("is-loaded", deck.loaded);
    const state = !deck.loaded ? "empty" : deck.playing ? "playing" : deck.started ? "paused" : "loaded";
    document.querySelector(`#deck-${deckNumber}-state`).textContent = state;
    const playButton = document.querySelector(`[data-play-deck='${deckNumber}']`);
    const playAction = deck.playing ? "Pause" : "Play";
    playButton.textContent = deck.playing ? "⏸" : "▶";
    playButton.setAttribute("aria-label", `${playAction} deck ${deckNumber}`);
    playButton.title = `${playAction} deck ${deckNumber}`;
    const loadButton = document.querySelector(`[data-load-deck='${deckNumber}']`);
    const loadAction = deck.loaded ? "Reload" : "Load";
    loadButton.textContent = "↻";
    loadButton.setAttribute("aria-label", `${loadAction} deck ${deckNumber}`);
    loadButton.title = `${loadAction} deck ${deckNumber}`;
    document.querySelector(`[data-deck-opacity='${deckNumber}']`).textContent = `${opacityPercent}%`;
    document.querySelector(`#deck-${deckNumber}-level-value`).textContent = `${Math.round(deck.level * 100)}%`;
    document.querySelector(`[data-level-deck='${deckNumber}']`).value = String(deck.level * 100);
    document.querySelector(`[data-scene-deck='${deckNumber}']`).value = deck.sceneId;
    const scene = sceneById(deck.sceneId);
    const activeLoop = visualLoopForDeck(scene, deck);
    const mappedClipIds = [...new Set((activeLoop?.events ?? []).map((event) => remapSceneClipId(scene, deck.clipOrder, event.clipId)))];
    const loopSlot = activeLoop?.id === scene.defaultLoopId ? "Default" : activeLoop?.name.split(" · ")[0];
    const activeLoopReadout = document.querySelector(`[data-active-loop='${deckNumber}']`);
    if (mappedClipIds.length === 1) {
      const mappedClip = scene.clips.find((clip) => clip.id === mappedClipIds[0]);
      activeLoopReadout.textContent = `${loopSlot} · ${mappedClipIds[0].replace("clip-", "Clip ")} · ${mappedClip?.label ?? "unknown"}`;
    } else if (mappedClipIds.length > 1) {
      activeLoopReadout.textContent = `${activeLoop.name} · ${mappedClipIds.map((id) => id.replace("clip-", "Clip ")).join(" + ")}`;
    } else {
      activeLoopReadout.textContent = "—";
    }
    const cueButtons = [...document.querySelectorAll(`[data-cue-deck='${deckNumber}']`)];
    card.querySelector(".cue-grid").style.setProperty("--cue-count", String(cueButtons.length));
    cueButtons.forEach((button, cueIndex) => {
      const input = `hotCue${String.fromCharCode(65 + cueIndex)}`;
      const binding = scene.cueBindings.find((candidate) => candidate.input === input);
      button.hidden = false;
      button.textContent = cueLetter(input);
      if (!binding) {
        const hasRandomFallback = Boolean(deck.randomLoop);
        const active = hasRandomFallback && deck.activeCueInput === input && deck.activeLoopId === deck.randomLoop.id;
        button.setAttribute("aria-label", `Hot Cue ${cueLetter(input)}: ${hasRandomFallback ? "random visual loop" : "scene default visual loop"}`);
        button.classList.toggle("is-active", active);
        button.setAttribute("aria-pressed", String(active));
        return;
      }
      const visualLoop = visualLoopForDeck(scene, deck, binding.visual.loopId);
      button.setAttribute("aria-label", `Hot Cue ${cueLetter(binding.input)}: ${cueKind(binding)}, ${bars(visualLoop.length)}-bar visual loop`);
      button.classList.toggle("is-active", binding.input === deck.activeCueInput);
      button.setAttribute("aria-pressed", String(binding.input === deck.activeCueInput));
    });
    renderCueUi(deck, deckNumber, scene);
  });

  const [left, right] = snapshot.opacities.map((value) => Math.round(value * 100));
  document.querySelector("#deck-1-mix").style.width = `${left}%`;
  document.querySelector("#deck-2-mix").style.width = `${right}%`;
  document.querySelector("#deck-1-mix-readout").textContent = `${left}%`;
  document.querySelector("#deck-2-mix-readout").textContent = `${right}%`;
  renderSceneQueue();
}

document.querySelector("#scene-catalog-count").textContent = `${PLAYABLE_SCENES.length} playable now · ${SCENES.length - PLAYABLE_SCENES.length} authored scene contracts awaiting source media`;
document.querySelector("#scene-queue-add").addEventListener("click", () => {
  mutateSceneQueue(() => sceneQueue.add(PLAYABLE_SCENES[0].id));
});
document.querySelector("#scene-queue-restart").addEventListener("click", () => {
  mutateSceneQueue(() => {
    sceneQueue = new SceneQueue(PLAYABLE_SCENES.map((scene) => scene.id), {
      items: sceneQueue.items,
      cursorIndex: 0,
      used: 0,
    });
  });
});

bpmInput.addEventListener("change", (event) => {
  const bpm = Number(event.target.value);
  if (Number.isFinite(bpm) && bpm >= 20 && bpm <= 300) setBpm(bpm);
  else event.target.value = snapshot.linkClock.bpm.toFixed(2);
});
bpmInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter") event.currentTarget.blur();
});
metronomeButton.addEventListener("click", () => {
  metronome.toggle().catch(() => {
    metronomeButton.textContent = "Metronome unavailable";
    metronomeButton.setAttribute("aria-pressed", "false");
  });
});
document.querySelector("#crossfader").addEventListener("input", (event) => {
  snapshot.crossfader = Number(event.target.value) / 100;
  broadcastSnapshot();
});
document.querySelector("#beatfx-select").addEventListener("change", (event) => {
  snapshot.effects.beatFx.selected = beatFxById(event.target.value).id;
  broadcastSnapshot();
});
document.querySelector("#beatfx-target").addEventListener("change", (event) => {
  snapshot.effects.beatFx.target = event.target.value;
  broadcastSnapshot();
});
document.querySelector("#beatfx-toggle").addEventListener("click", () => {
  snapshot.effects.beatFx.enabled = !snapshot.effects.beatFx.enabled;
  broadcastSnapshot();
});
document.querySelector("#beatfx-down").addEventListener("click", () => {
  snapshot.effects.beatFx.beatMultiplier = stepBeatMultiplier(snapshot.effects.beatFx.beatMultiplier, -1);
  broadcastSnapshot();
});
document.querySelector("#beatfx-up").addEventListener("click", () => {
  snapshot.effects.beatFx.beatMultiplier = stepBeatMultiplier(snapshot.effects.beatFx.beatMultiplier, 1);
  broadcastSnapshot();
});
document.querySelector("#beatfx-depth").addEventListener("input", (event) => {
  snapshot.effects.beatFx.depth = Number(event.target.value) / 100;
  broadcastSnapshot();
});
document.querySelector("#open-output").addEventListener("click", () => {
  window.open("output.html", "video-sync-output", "popup,width=1280,height=720");
  setTimeout(broadcastSnapshot, 300);
});

document.querySelectorAll("[data-load-deck]").forEach((button) => {
  button.addEventListener("click", () => {
    loadDeck(Number(button.dataset.loadDeck));
    broadcastSnapshot();
  });
});
document.querySelectorAll("[data-play-deck]").forEach((button) => {
  button.addEventListener("click", () => toggleDeck(Number(button.dataset.playDeck)));
});
document.querySelectorAll("[data-level-deck]").forEach((input) => {
  input.addEventListener("input", () => {
    snapshot.decks[Number(input.dataset.levelDeck) - 1].level = Number(input.value) / 100;
    broadcastSnapshot();
  });
});
document.querySelectorAll("[data-scene-deck]").forEach((select) => {
  select.addEventListener("change", () => {
    const deck = snapshot.decks[Number(select.dataset.sceneDeck) - 1];
    deck.sceneId = select.value;
    const scene = sceneById(deck.sceneId);
    deck.clipOrder = authoredClipOrder(scene);
    deck.randomLoop = generateRandomLoop(scene);
    deck.generation += 1;
    deck.activeLoopId = scene.defaultLoopId;
    deck.activeCueInput = null;
    deck.cueAnchorLinkBeat = null;
    deck.loopAnchorBeat = deck.started ? beatAt(deck.clock, nowEpochMs()) : 0;
    deck.loopGeneration += 1;
    saveDeckRuntime();
    broadcastSnapshot();
  });
});
document.querySelectorAll("[data-cue-deck]").forEach((button) => {
  button.addEventListener("click", () => triggerCue(Number(button.dataset.cueDeck), Number(button.dataset.cue)));
});

channel.addEventListener("message", ({ data }) => {
  if (data?.type === "request-snapshot") broadcastSnapshot();
});

window.addEventListener("keydown", (event) => {
  if (event.target.matches("input, select")) return;
  if (event.key === "1") toggleDeck(1);
  if (event.key === "2") toggleDeck(2);
  const cueIndex = "abcdefgh".indexOf(event.key.toLowerCase());
  if (cueIndex >= 0) triggerCue(event.shiftKey ? 2 : 1, cueIndex);
});

const bridgeDrawer = document.querySelector("#bridge-drawer");
const bridgeDrawerBackdrop = document.querySelector("#bridge-drawer-backdrop");
const bridgeDrawerToggle = document.querySelector("#bridge-drawer-toggle");
const bridgeDrawerClose = document.querySelector("#bridge-drawer-close");
const bridgeStatus = document.querySelector("#bridge-status");
let bridgeMidiCount = 0;
let lastBridgeStatus = "";
let lastLinkFeedSignature = "";
let lastRekordboxFeedSignature = "";
let controllerRenderPending = false;
let lastContinuousRawFeedAt = 0;
let lastContinuousMappedFeedAt = 0;
let controllerTransportRelayAvailable = false;
let rekordboxTempoAvailable = false;

function updateBridgeToggleLabel(open = bridgeDrawer.classList.contains("is-open")) {
  const action = open ? "Close" : "Open";
  bridgeDrawerToggle.setAttribute("aria-label", `${action} live bridge event log (${lastBridgeStatus || "connecting"})`);
}

function setBridgeDrawerOpen(open) {
  bridgeDrawer.classList.toggle("is-open", open);
  bridgeDrawerBackdrop.classList.toggle("is-open", open);
  bridgeDrawer.setAttribute("aria-hidden", String(!open));
  bridgeDrawer.inert = !open;
  bridgeDrawerToggle.setAttribute("aria-expanded", String(open));
  document.body.classList.toggle("is-bridge-drawer-open", open);
  updateBridgeToggleLabel(open);
  if (open) requestAnimationFrame(() => bridgeDrawerClose.focus());
  else bridgeDrawerToggle.focus();
}

bridgeDrawerToggle.addEventListener("click", () => setBridgeDrawerOpen(!bridgeDrawer.classList.contains("is-open")));
bridgeDrawerClose.addEventListener("click", () => setBridgeDrawerOpen(false));
bridgeDrawerBackdrop.addEventListener("click", () => setBridgeDrawerOpen(false));
window.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && bridgeDrawer.classList.contains("is-open")) setBridgeDrawerOpen(false);
});

function appendBridgeEvent(label, kind = "system", epochMs = Date.now()) {
  const list = document.querySelector("#bridge-events");
  const wasNearBottom = list.scrollHeight - list.scrollTop - list.clientHeight < 24;
  list.querySelector(".is-placeholder")?.remove();
  const item = document.createElement("li");
  item.className = `bridge-event-${kind}`;
  const time = document.createElement("time");
  time.className = "bridge-event-time";
  time.dateTime = new Date(epochMs).toISOString();
  time.textContent = new Date(epochMs).toLocaleTimeString([], { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit", fractionalSecondDigits: 3 });
  const text = document.createElement("span");
  text.className = "bridge-event-label";
  text.textContent = label;
  item.append(time, text);
  list.append(item);
  while (list.children.length > 500) list.firstElementChild.remove();
  if (wasNearBottom) list.scrollTop = list.scrollHeight;
}

function bridgeEventLabel(message) {
  if (message.type === "midi.raw") return `raw · ${message.payload.kind} · [${message.payload.bytes.join(" ")}]`;
  if (["controller.control", "rekordbox.control"].includes(message.type)) {
    const scope = message.payload.deck > 0 ? `D${message.payload.deck}` : "FX";
    return `mapped · ${scope} · ${message.payload.event} · ${message.payload.value.toFixed(3)}`;
  }
  if (message.type === "bridge.ready") return `ready · ${message.payload.midiMode} · ${message.payload.midiPortName || message.payload.virtualMidiName}`;
  if (message.type === "bridge.self-test") return `self-test · ${message.payload.midi}`;
  return message.type;
}

function scheduleControllerRender() {
  if (controllerRenderPending) return;
  controllerRenderPending = true;
  requestAnimationFrame(() => {
    controllerRenderPending = false;
    broadcastSnapshot();
  });
}

function shouldAppendBridgeMessage(message) {
  const timestamp = message.emittedAtUnixMs ?? Date.now();
  if (message.type === "midi.raw" && message.payload.kind === "control-change") {
    if (timestamp - lastContinuousRawFeedAt < 100) return false;
    lastContinuousRawFeedAt = timestamp;
  }
  if (["controller.control", "rekordbox.control"].includes(message.type) &&
      ["mixer.crossfader", "deck.level", "beatfx.depth"].includes(message.payload.event)) {
    if (timestamp - lastContinuousMappedFeedAt < 100) return false;
    lastContinuousMappedFeedAt = timestamp;
  }
  return true;
}

function applyControllerMessage(payload) {
  const command = commandFromController(payload);
  if (!command) return;
  if (command.type === "load-deck" && command.deck <= snapshot.decks.length) {
    loadDeck(command.deck);
    broadcastSnapshot();
  } else if (command.type === "toggle-deck" && command.deck <= snapshot.decks.length) {
    if (controllerTransportRelayAvailable) return;
    toggleDeck(command.deck);
  } else if (command.type === "hot-cue" && command.deck <= snapshot.decks.length) {
    triggerCue(command.deck, command.cueIndex);
  } else if (command.type === "deck-level" && command.deck <= snapshot.decks.length) {
    snapshot.decks[command.deck - 1].level = command.value;
    scheduleControllerRender();
  } else if (command.type === "crossfader") {
    snapshot.crossfader = command.value;
    scheduleControllerRender();
  } else if (command.type === "beatfx-select") {
    snapshot.effects.beatFx.selected = beatFxById(command.effect).id;
    broadcastSnapshot();
  } else if (command.type === "beatfx-target") {
    snapshot.effects.beatFx.target = command.target;
    broadcastSnapshot();
  } else if (command.type === "beatfx-toggle") {
    snapshot.effects.beatFx.enabled = !snapshot.effects.beatFx.enabled;
    broadcastSnapshot();
  } else if (command.type === "beatfx-beat-step") {
    snapshot.effects.beatFx.beatMultiplier = stepBeatMultiplier(snapshot.effects.beatFx.beatMultiplier, command.direction);
    broadcastSnapshot();
  } else if (command.type === "beatfx-depth") {
    snapshot.effects.beatFx.depth = command.value;
    scheduleControllerRender();
  }
}

const bridgeEventsUrl = new URL("/api/bridge/events", window.location.href);
snapshot.decks.forEach((deck) => {
  if (deck.loaded) bridgeEventsUrl.searchParams.set(`deck${deck.id}`, deck.playing ? "1" : "0");
});
const bridgeSource = new EventSource(bridgeEventsUrl);
bridgeSource.addEventListener("controller-transport", ({ data }) => {
  const state = JSON.parse(data);
  controllerTransportRelayAvailable = true;
  for (const transport of transportEntriesForEvent(state)) {
    if (!transport.known || transport.deck > snapshot.decks.length) continue;
    setDeckPlaying(transport.deck, transport.playing);
  }
});
bridgeSource.addEventListener("bridge-status", ({ data }) => {
  const status = JSON.parse(data);
  bridgeStatus.textContent = status.state;
  bridgeStatus.classList.toggle("is-live", status.state === "running");
  bridgeStatus.classList.toggle("is-error", ["missing", "error", "exited"].includes(status.state));
  bridgeDrawerToggle.classList.toggle("is-live", status.state === "running");
  bridgeDrawerToggle.classList.toggle("is-error", ["missing", "error", "exited"].includes(status.state));
  bridgeStatus.title = status.detail ?? "Bridge status updated.";
  if (status.state !== lastBridgeStatus) {
    appendBridgeEvent(`status · ${status.state}`, ["missing", "error", "exited"].includes(status.state) ? "error" : "system");
    lastBridgeStatus = status.state;
    updateBridgeToggleLabel();
  }
});
bridgeSource.addEventListener("rekordbox-adapter-status", ({ data }) => {
  const status = JSON.parse(data);
  const target = document.querySelector("#bridge-rekordbox");
  if (status.state === "running" && rekordboxTempoAvailable) return;
  target.textContent = status.state;
  target.title = status.detail ?? "Rekordbox deck-state adapter status updated.";
});
bridgeSource.addEventListener("bridge-message", ({ data }) => {
  const message = JSON.parse(data);
  if (message.type === "rekordbox.deck-state") {
    const plan = rekordboxTempoPlan(message, snapshot.decks, snapshot.opacities);
    rekordboxTempoAvailable = Boolean(plan);
    const target = document.querySelector("#bridge-rekordbox");
    if (!plan) {
      target.textContent = "No loaded deck";
      return;
    }

    const epochMs = message.emittedAtUnixMs ?? nowEpochMs();
    for (const update of plan.decks) {
      const deck = snapshot.decks[update.deck - 1];
      if (deck) deck.clock = reanchorClock(deck.clock, epochMs, { bpm: update.bpm });
    }
    snapshot.linkClock = reanchorClock(snapshot.linkClock, epochMs, { bpm: plan.bpm });
    const anyPlaying = anyDeckPlaying();
    snapshot.phraseClock = syncPhraseClock(snapshot.phraseClock, {
      wasAnyPlaying: anyPlaying,
      isAnyPlaying: anyPlaying,
      epochMs,
      bpm: plan.bpm,
    });
    applyAutomaticCueCrossings(message);
    target.textContent = `D${plan.sourceDeck} · ${plan.bpm.toFixed(2)} BPM`;
    const signature = `${plan.sourceDeck}|${plan.bpm.toFixed(2)}|${plan.decks.map((entry) => `${entry.deck}:${entry.bpm.toFixed(2)}`).join(",")}`;
    if (signature !== lastRekordboxFeedSignature) {
      appendBridgeEvent(`Rekordbox · D${plan.sourceDeck} · ${plan.bpm.toFixed(2)} BPM`, "link", epochMs);
      lastRekordboxFeedSignature = signature;
    }
    broadcastSnapshot();
    return;
  }
  if (message.type === "link.clock") {
    const peerLabel = `${message.payload.peers} peer${message.payload.peers === 1 ? "" : "s"}`;
    document.querySelector("#bridge-link").textContent = `${message.payload.tempo.toFixed(2)} BPM · ${peerLabel}`;
    const signature = `${message.payload.tempo.toFixed(2)}|${message.payload.peers}|${message.payload.playing}`;
    if (signature !== lastLinkFeedSignature) {
      appendBridgeEvent(`Link · ${message.payload.tempo.toFixed(2)} BPM · ${peerLabel} · ${message.payload.playing ? "playing" : "stopped"}`, "link", message.emittedAtUnixMs);
      lastLinkFeedSignature = signature;
    }
    if (message.payload.peers > 0 && !rekordboxTempoAvailable) {
      const linkClock = clockFromLinkMessage(message);
      if (linkClock) {
        snapshot.linkClock = linkClock;
        const anyPlaying = anyDeckPlaying();
        snapshot.phraseClock = syncPhraseClock(snapshot.phraseClock, {
          wasAnyPlaying: anyPlaying,
          isAnyPlaying: anyPlaying,
          epochMs: message.emittedAtUnixMs,
          bpm: linkClock.bpm,
        });
        snapshot.decks = snapshot.decks.map((deck) => ({
          ...deck,
          clock: reanchorClock(deck.clock, message.emittedAtUnixMs, { bpm: linkClock.bpm }),
        }));
        broadcastSnapshot();
      }
    }
    return;
  }
  if (message.type === "midi.raw") {
    bridgeMidiCount += 1;
    document.querySelector("#bridge-midi").textContent = `${bridgeMidiCount} message${bridgeMidiCount === 1 ? "" : "s"}`;
  }
  if (["controller.control", "rekordbox.control"].includes(message.type)) applyControllerMessage(message.payload);
  if (["midi.raw", "controller.control", "rekordbox.control", "bridge.ready", "bridge.self-test"].includes(message.type) && shouldAppendBridgeMessage(message)) {
    const kind = message.type === "midi.raw" ? "midi" : ["controller.control", "rekordbox.control"].includes(message.type) ? "control" : "system";
    appendBridgeEvent(bridgeEventLabel(message), kind, message.emittedAtUnixMs);
  }
});
bridgeSource.addEventListener("error", () => {
  if (bridgeStatus.textContent === "running") return;
  bridgeStatus.textContent = "disconnected";
  bridgeStatus.classList.add("is-error");
  bridgeDrawerToggle.classList.remove("is-live");
  bridgeDrawerToggle.classList.add("is-error");
  if (lastBridgeStatus !== "disconnected") appendBridgeEvent("status · disconnected", "error");
  lastBridgeStatus = "disconnected";
  updateBridgeToggleLabel();
});

window.addEventListener("pagehide", () => {
  saveDeckRuntime();
  metronome.stop();
  bridgeSource.close();
});

renderState();
broadcastSnapshot();
