import { VisualEngine } from "./engine.mjs";
import { clockFromLinkMessage, clockFromRekordboxDeck, commandFromController, rekordboxTempoPlan, resolveHotCueRoute, transportEntriesForEvent } from "./bridge-controls.mjs";
import { BEAT_FX_CATALOG, beatFxById, formatBeatMultiplier, stepBeatMultiplier } from "./effects.mjs";
import { LinkMetronome } from "./metronome.mjs";
import { computeDeckOpacities, dominantDeck } from "./mix.mjs";
import { createPhraseClock, phraseBeatAt, syncPhraseClock, visualLoopWindows } from "./phrase-transport.mjs";
import { PLAYABLE_SCENES, SCENES } from "./scene-registry.mjs";
import { parseSavedSceneQueue, SceneQueue } from "./scene-queue.mjs";
import { authoredClipOrder, clipOrderForAssignment, normalizeClipOrder, remapSceneClipId } from "./scene-variation.mjs";
import { generateRandomLoop } from "./random-loop.mjs";
import { beatAt, SongCounter, nowEpochMs, reanchorClock, resyncClockAtQuantum } from "./scheduler.mjs";
import { musicalToBeats } from "./sequencer.mjs";
import { parseDeckRuntime } from "./transport-state.mjs";
import { parsePlayerState, serializePlayerState } from "./player-state.mjs";
import { crossedHotCues, detectedLoopWrap } from "./cue-crossings.mjs";
import { readSession, sessionBlob, SessionRecorder, SessionReplayer } from "./session-recorder.mjs";
import { inputReadiness, sceneMediaPlan } from "./preflight.mjs";

const channel = new BroadcastChannel("video-sync-poc-v4");
const songCounter = new SongCounter(2);
const sceneQueueStorageKey = "video-sync-scene-queue-v1";
const deckRuntimeStorageKey = "video-sync-deck-runtime-v1";
const playerStateStorageKey = "video-sync-player-state-v1";
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
    activeCueMetadata: null,
    hotCues: [],
    cueAnchorLinkBeat: null,
    loopAnchorBeat: 0,
    loopGeneration: 0,
    trackTitle: null,
    trackFingerprint: null,
    adapterSessionId: null,
    adapterLoadGeneration: null,
    pendingControllerLoadAt: null,
    pendingTrackFingerprint: null,
    clock: { bpm: 100, playing: false, anchorBeat: 0, anchorEpochMs: nowEpochMs() },
  };
}

let replayScenes = null;
function sceneById(id) {
  return replayScenes?.get(id) ?? SCENES.find((scene) => scene.id === id) ?? SCENES[0];
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
const sessionRecorder = new SessionRecorder();
let sessionReplayer = null;
let liveSnapshotBeforeReplay = null;

let restoredPlayerState = null;
try {
  restoredPlayerState = parsePlayerState(localStorage.getItem(playerStateStorageKey), SCENES.map((scene) => scene.id));
} catch {
  // The live player still runs if browser storage is blocked.
}
try {
  const restored = restoredPlayerState?.decks
    ?? parseDeckRuntime(sessionStorage.getItem(deckRuntimeStorageKey), SCENES.map((scene) => scene.id));
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

if (restoredPlayerState) {
  snapshot.linkClock = restoredPlayerState.linkClock ?? snapshot.linkClock;
  snapshot.phraseClock = restoredPlayerState.phraseClock ?? snapshot.phraseClock;
  snapshot.crossfader = restoredPlayerState.crossfader;
  if (restoredPlayerState.beatFx) {
    snapshot.effects.beatFx = { ...restoredPlayerState.beatFx, selected: beatFxById(restoredPlayerState.beatFx.selected).id };
  }
  snapshot.songCount = restoredPlayerState.songCount;
  songCounter.total = snapshot.songCount;
  songCounter.decks.forEach((counter, index) => {
    const deck = snapshot.decks[index];
    counter.loadGeneration = deck.generation;
    counter.countedGeneration = deck.counted ? deck.generation : -1;
    counter.loaded = deck.loaded;
  });
}

if (snapshot.decks.some((deck) => deck.playing) && !restoredPlayerState?.phraseClock) {
  snapshot.phraseClock = syncPhraseClock(snapshot.phraseClock, {
    wasAnyPlaying: false,
    isAnyPlaying: true,
    epochMs: nowEpochMs(),
    bpm: snapshot.linkClock.bpm,
  });
}

let pendingPlayerSave = null;
function savePlayerStateNow() {
  if (pendingPlayerSave !== null) clearTimeout(pendingPlayerSave);
  pendingPlayerSave = null;
  try {
    localStorage.setItem(playerStateStorageKey, serializePlayerState(snapshot, {
      metronomeEnabled: metronome.enabled || metronomePendingResume,
      bridgeDrawerOpen: document.querySelector("#bridge-drawer")?.classList.contains("is-open") ?? false,
    }));
  } catch {
    // Storage failure should not affect live control.
  }
}

function saveDeckRuntime() {
  if (pendingPlayerSave !== null) return;
  pendingPlayerSave = setTimeout(savePlayerStateNow, 250);
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
}, sceneById);

const metronomeButton = document.querySelector("#metronome");
const bpmInput = document.querySelector("#bpm");
let metronomePendingResume = Boolean(restoredPlayerState?.metronomeEnabled);
const metronome = new LinkMetronome(() => snapshot.linkClock, (enabled) => {
  metronomePendingResume = false;
  metronomeButton.textContent = enabled ? "Metronome on" : "Metronome off";
  metronomeButton.setAttribute("aria-pressed", String(enabled));
  saveDeckRuntime();
});
if (metronomePendingResume) metronomeButton.textContent = "Resume metronome";

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
  sessionRecorder.captureSnapshot(snapshot);
  engine.applySnapshot(snapshot);
  channel.postMessage({ type: "snapshot", snapshot });
  renderState();
  saveDeckRuntime();
}

function paintReplaySnapshot(next) {
  snapshot = next;
  engine.applySnapshot(snapshot);
  channel.postMessage({ type: "snapshot", snapshot });
  renderState();
}

function stopSessionReplay() {
  if (!sessionReplayer) return;
  sessionReplayer.stop();
  sessionReplayer = null;
  replayScenes = null;
  engine.setSceneResolver(sceneById);
  channel.postMessage({ type: "scene-overrides", scenes: null });
  document.body.classList.remove("is-session-replaying");
  renderPreflightInput();
  document.querySelector("#session-stop").disabled = true;
  document.querySelector("#session-record").disabled = false;
  if (liveSnapshotBeforeReplay) {
    snapshot = liveSnapshotBeforeReplay;
    liveSnapshotBeforeReplay = null;
    broadcastSnapshot();
  }
}

const sessionRecordButton = document.querySelector("#session-record");
const sessionStopButton = document.querySelector("#session-stop");
const sessionFileInput = document.querySelector("#session-file");
sessionRecordButton.addEventListener("click", () => {
  if (sessionReplayer) return;
  sessionRecorder.start(snapshot);
  sessionRecordButton.classList.add("is-recording");
  sessionRecordButton.textContent = "● Recording";
  sessionRecordButton.disabled = true;
  sessionStopButton.disabled = false;
});
sessionStopButton.addEventListener("click", async () => {
  if (sessionReplayer) { stopSessionReplay(); return; }
  const recording = sessionRecorder.stop(snapshot);
  sessionRecordButton.classList.remove("is-recording");
  sessionRecordButton.textContent = "● Record";
  sessionRecordButton.disabled = false;
  sessionStopButton.disabled = true;
  if (!recording) return;
  const usedSceneIds = new Set(recording.events.filter((event) => event.type === "snapshot")
    .flatMap((event) => event.value.decks.filter((deck) => deck.loaded).map((deck) => deck.sceneId)));
  recording.scenes = SCENES.filter((scene) => usedSceneIds.has(scene.id));
  const { blob, extension } = await sessionBlob(recording);
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `video-sync-session-${new Date(recording.startedAt).toISOString().replace(/[:.]/g, "-")}.${extension}`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
});
sessionFileInput.addEventListener("change", async () => {
  const file = sessionFileInput.files?.[0];
  sessionFileInput.value = "";
  if (!file) return;
  try {
    const recording = await readSession(file);
    if (sessionRecorder.session) sessionStopButton.click();
    stopSessionReplay();
    liveSnapshotBeforeReplay = structuredClone(snapshot);
    replayScenes = new Map((recording.scenes ?? []).map((scene) => [scene.id, scene]));
    engine.setSceneResolver(sceneById);
    channel.postMessage({ type: "scene-overrides", scenes: [...replayScenes.values()] });
    sessionReplayer = new SessionReplayer(recording, paintReplaySnapshot);
    document.body.classList.add("is-session-replaying");
    renderPreflightInput();
    sessionRecordButton.disabled = true;
    sessionStopButton.disabled = false;
    sessionReplayer.start();
  } catch (error) {
    window.alert(error instanceof Error ? error.message : "Could not open recording");
  }
});

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

function loadDeck(deckNumber, options = {}) {
  const wasAnyPlaying = anyDeckPlaying();
  const deck = snapshot.decks[deckNumber - 1];
  const epochMs = Number.isFinite(options.epochMs) ? options.epochMs : nowEpochMs();
  const source = options.source ?? "manual";
  if (source === "controller") {
    deck.pendingControllerLoadAt = epochMs;
    deck.pendingTrackFingerprint = deck.trackFingerprint;
  }
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
  deck.activeCueMetadata = null;
  deck.hotCues = [];
  deck.cueAnchorLinkBeat = null;
  deck.loopAnchorBeat = 0;
  deck.loopGeneration += 1;
  deck.trackTitle = options.trackTitle ?? null;
  deck.trackFingerprint = options.trackFingerprint ?? null;
  deck.adapterSessionId = options.adapterSessionId ?? deck.adapterSessionId;
  deck.adapterLoadGeneration = Number.isFinite(options.adapterLoadGeneration) ? options.adapterLoadGeneration : null;
  deck.clock = { bpm: snapshot.linkClock.bpm, playing: false, anchorBeat: 0, anchorEpochMs: epochMs };
  if (!options.deferPhrase) updatePhraseTransport(wasAnyPlaying, epochMs);
  saveDeckRuntime();
  return deck;
}

function toggleDeck(deckNumber) {
  const wasAnyPlaying = anyDeckPlaying();
  const deck = snapshot.decks[deckNumber - 1];
  if (!deck.loaded) loadDeck(deckNumber, { deferPhrase: true });
  const now = nowEpochMs();
  deck.playing = !deck.playing;
  deck.started ||= deck.playing;
  deck.clock = reanchorClock(deck.clock, now, { playing: deck.playing });
  if (deck.playing) qualifySong(deckNumber, "play");
  updatePhraseTransport(wasAnyPlaying, now);
  saveDeckRuntime();
  broadcastSnapshot();
}

function setDeckPlaying(deckNumber, playing, options = {}) {
  const wasAnyPlaying = anyDeckPlaying();
  const deck = snapshot.decks[deckNumber - 1];
  const wasLoaded = deck.loaded;
  if (!wasLoaded) loadDeck(deckNumber, { deferPhrase: true, epochMs: options.epochMs });
  const nextPlaying = Boolean(playing);
  if (deck.playing === nextPlaying) {
    if (!wasLoaded && !options.deferBroadcast) broadcastSnapshot();
    return;
  }
  const epochMs = Number.isFinite(options.epochMs) ? options.epochMs : nowEpochMs();
  deck.playing = nextPlaying;
  deck.started ||= nextPlaying;
  deck.clock = reanchorClock(deck.clock, epochMs, { playing: nextPlaying });
  if (nextPlaying) qualifySong(deckNumber, "play");
  if (!options.deferPhrase) updatePhraseTransport(wasAnyPlaying, epochMs);
  saveDeckRuntime();
  if (!options.deferBroadcast) broadcastSnapshot();
}

function ensureDeckPlaying(deckNumber, reason) {
  const wasAnyPlaying = anyDeckPlaying();
  const deck = snapshot.decks[deckNumber - 1];
  if (!deck.loaded) loadDeck(deckNumber, { deferPhrase: true });
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
const cueMetadataBasisByDeck = new Map();

function reportCueMetadataAvailability(deckState, epochMs) {
  const deckNumber = Number(deckState.deck);
  if (!Number.isInteger(deckNumber) || !deckState.loaded) {
    cueMetadataBasisByDeck.delete(deckNumber);
    return;
  }
  const basis = deckState.hotCueMetadataBasis;
  if (!basis || cueMetadataBasisByDeck.get(deckNumber) === basis) return;
  cueMetadataBasisByDeck.set(deckNumber, basis);
  if (basis === "unavailable") {
    appendBridgeEvent(`cue data · D${deckNumber} · unavailable · show PAD / Hot Cue in Rekordbox`, "error", epochMs);
  } else if (basis === "cached") {
    appendBridgeEvent(`cue data · D${deckNumber} · PAD hidden · using cached timeline`, "system", epochMs);
  } else {
    appendBridgeEvent(`cue data · D${deckNumber} · live`, "system", epochMs);
  }
}

function triggerCue(deckNumber, cueIndex, options = {}) {
  const deck = snapshot.decks[deckNumber - 1];
  if (!deck.loaded) loadDeck(deckNumber, { deferPhrase: true });
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
  const observedCue = options.cue ?? deck.hotCues.find((cue) => cue.cueIndex === cueIndex) ?? null;
  const authoredLengthBeats = route.binding?.cue?.type === "loop" ? musicalToBeats(route.binding.cue.length) : null;
  deck.activeCueMetadata = observedCue ? { ...observedCue } : {
    cueIndex,
    kind: route.binding?.cue?.type === "loop" ? "loop" : "cue",
    ...(authoredLengthBeats ? { lengthBeats: authoredLengthBeats } : {}),
    metadataBasis: "scene-contract-fallback",
  };
  deck.cueAnchorLinkBeat = route.binding ? beatAt(snapshot.linkClock, anchorEpochMs) : null;
  deck.loopAnchorBeat = beatAt(deck.clock, anchorEpochMs);
  deck.loopGeneration += 1;
  saveDeckRuntime();
  if (!options.deferBroadcast) broadcastSnapshot();
}

function applyAutomaticCueCrossings(message) {
  const epochMs = message.emittedAtUnixMs ?? nowEpochMs();
  for (const deckState of message.payload?.decks ?? []) {
    const deckNumber = Number(deckState.deck);
    reportCueMetadataAvailability(deckState, epochMs);
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
    deck.hotCues = current.hotCues;
    if (deck.activeCueInput) {
      const activeCueIndex = deck.activeCueInput.charCodeAt(deck.activeCueInput.length - 1) - 65;
      const currentActiveCue = current.hotCues.find((cue) => cue.cueIndex === activeCueIndex) ?? deck.activeCueMetadata;
      const wrap = detectedLoopWrap(previous, current, {
        playing: deck.playing,
        activeCue: currentActiveCue,
        bpm: deckState.bpm,
      });
      if (wrap) {
        deck.activeCueMetadata = currentActiveCue;
        deck.loopAnchorBeat = beatAt(deck.clock, wrap.wrappedAtEpochMs);
        deck.loopGeneration += 1;
        appendBridgeEvent(
          `loop wrap · D${deckNumber} · ${String.fromCharCode(65 + activeCueIndex)} · ${(wrap.observedAtEpochMs - wrap.wrappedAtEpochMs).toFixed(0)} ms compensated`,
          "control",
          epochMs,
        );
      }
    }
    // Let the normal cue router handle every visible Rekordbox cue. Built-in
    // scenes leave H unbound for a deck-local random loop; Studio publications
    // can bind H explicitly. Filtering to authored bindings here made an
    // unbound orange loop marker disappear during passive playback even though
    // pressing that cue manually worked.
    const crossing = crossedHotCues(previous, current, { playing: deck.playing }).at(-1);
    if (!crossing) continue;
    triggerCue(deckNumber, crossing.cueIndex, {
      automatic: true,
      anchorEpochMs: crossing.crossedAtEpochMs,
      cue: crossing,
      deferBroadcast: true,
    });
    appendBridgeEvent(
      `auto cue · D${deckNumber} · ${String.fromCharCode(65 + crossing.cueIndex)} · ${(crossing.observedAtEpochMs - crossing.crossedAtEpochMs).toFixed(0)} ms compensated`,
      "control",
      epochMs,
    );
  }
}

const controllerLoadDeduplicationMs = 5000;

function reconcileObservedTrackLoad(deckState, adapterSessionId, epochMs) {
  const deckNumber = Number(deckState.deck);
  const deck = snapshot.decks[deckNumber - 1];
  if (!deck) return;
  const fingerprint = typeof deckState.trackFingerprint === "string" ? deckState.trackFingerprint : null;
  const title = typeof deckState.trackTitle === "string" ? deckState.trackTitle : null;
  const adapterGeneration = Number(deckState.loadGeneration);
  const sameAdapterSession = Boolean(adapterSessionId && deck.adapterSessionId === adapterSessionId);
  const generationChanged = sameAdapterSession && Number.isFinite(adapterGeneration) &&
    Number.isFinite(deck.adapterLoadGeneration) && adapterGeneration !== deck.adapterLoadGeneration;
  const fingerprintChanged = Boolean(fingerprint && deck.trackFingerprint && fingerprint !== deck.trackFingerprint);
  const newlyObservedLoad = Boolean(deckState.loaded && !deck.loaded);
  const recentControllerLoad = Number.isFinite(deck.pendingControllerLoadAt) &&
    epochMs - deck.pendingControllerLoadAt <= controllerLoadDeduplicationMs;
  const shouldClaimScene = deckState.loaded && (newlyObservedLoad || fingerprintChanged || generationChanged);

  if (shouldClaimScene && !recentControllerLoad) {
    loadDeck(deckNumber, {
      source: "rekordbox",
      epochMs,
      deferPhrase: true,
      trackFingerprint: fingerprint,
      trackTitle: title,
      adapterSessionId,
      adapterLoadGeneration: Number.isFinite(adapterGeneration) ? adapterGeneration : null,
    });
  } else if (deckState.loaded) {
    deck.loaded = true;
    deck.trackFingerprint = fingerprint ?? deck.trackFingerprint;
    deck.trackTitle = title ?? deck.trackTitle;
  } else {
    deck.loaded = false;
    deck.playing = false;
    deck.started = false;
  }

  if (recentControllerLoad && (generationChanged || (fingerprint && fingerprint !== deck.pendingTrackFingerprint))) {
    deck.pendingControllerLoadAt = null;
    deck.pendingTrackFingerprint = null;
  }
  deck.adapterSessionId = adapterSessionId ?? deck.adapterSessionId;
  deck.adapterLoadGeneration = Number.isFinite(adapterGeneration) ? adapterGeneration : deck.adapterLoadGeneration;
  deck.hotCues = Array.isArray(deckState.hotCues) ? deckState.hotCues : [];
}

function applyRekordboxDeckState(message, plan) {
  const epochMs = message.emittedAtUnixMs ?? nowEpochMs();
  const adapterSessionId = message.payload?.adapterSessionId ?? null;
  const wasAnyPlaying = anyDeckPlaying();

  for (const observation of message.payload?.decks ?? []) {
    reconcileObservedTrackLoad(observation, adapterSessionId, epochMs);
  }
  for (const update of plan.decks) {
    const deck = snapshot.decks[update.deck - 1];
    if (!deck || !update.loaded) continue;
    const wasPlaying = deck.playing;
    if (update.transportKnown) {
      deck.playing = Boolean(update.playing);
      deck.started ||= deck.playing;
      if (!wasPlaying && deck.playing) qualifySong(update.deck, "observed-playhead");
    }
    deck.clock = clockFromRekordboxDeck(update, deck.clock, epochMs);
  }

  const sourceDeckState = plan.decks.find((deck) => deck.deck === plan.sourceDeck);
  if (sourceDeckState) snapshot.linkClock = clockFromRekordboxDeck(sourceDeckState, snapshot.linkClock, epochMs);
  const isAnyPlaying = anyDeckPlaying();
  const firstObservedStart = !wasAnyPlaying && isAnyPlaying
    ? Math.min(epochMs, ...plan.decks
      .filter((deck) => deck.transportKnown && deck.playing && Number.isFinite(deck.transportChangedAtUnixMs))
      .map((deck) => deck.transportChangedAtUnixMs))
    : epochMs;
  snapshot.phraseClock = syncPhraseClock(snapshot.phraseClock, {
    wasAnyPlaying,
    isAnyPlaying,
    epochMs: Number.isFinite(firstObservedStart) ? firstObservedStart : epochMs,
    bpm: plan.bpm,
  });
  applyAutomaticCueCrossings(message);
  saveDeckRuntime();
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

function cueKind(binding, deck = null) {
  const cueIndex = binding.input.charCodeAt(binding.input.length - 1) - 65;
  const observed = deck?.hotCues?.find((cue) => cue.cueIndex === cueIndex);
  if (observed?.kind === "loop") {
    if (Number.isFinite(observed.lengthBeats)) return `${observed.lengthBeats}-beat audio loop`;
    if (Number.isFinite(observed.endTimeSeconds)) return `${(observed.endTimeSeconds - observed.timeSeconds).toFixed(1)}s audio loop`;
    return "audio loop";
  }
  if (observed?.kind === "cue") return "jump cue";
  if (binding.cue.type === "loop") return `${bars(binding.cue.length)}-bar audio loop`;
  if (binding.cue.type === "auto") return "hot cue";
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
  summary.textContent = `${cueKind(binding, deck)} · ${bars(visualLoop.length)}-bar visual loop`;
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
      button.setAttribute("aria-label", `Hot Cue ${cueLetter(binding.input)}: ${cueKind(binding, deck)}, ${bars(visualLoop.length)}-bar visual loop`);
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
  if (document.querySelector("#bridge-drawer").classList.contains("is-open") && preflightMediaKey() !== lastPreflightMediaKey) {
    void refreshPreflightMedia();
  }
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
  metronomePendingResume = false;
  metronome.toggle().catch(() => {
    metronomeButton.textContent = "Metronome unavailable";
    metronomeButton.setAttribute("aria-pressed", "false");
  });
});
document.querySelector("#resync-phase").addEventListener("click", () => {
  const epochMs = nowEpochMs();
  snapshot.linkClock = resyncClockAtQuantum(snapshot.linkClock, epochMs, 4).clock;
  for (const deck of snapshot.decks) {
    if (!deck.playing) continue;
    const result = resyncClockAtQuantum(deck.clock, epochMs, 4);
    deck.clock = result.clock;
    deck.loopAnchorBeat += result.beatDelta;
  }
  saveDeckRuntime();
  appendBridgeEvent("manual phase · bar downbeat", "control", epochMs);
  broadcastSnapshot();
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
  if (data?.type === "request-snapshot") {
    if (sessionReplayer) {
      channel.postMessage({ type: "scene-overrides", scenes: [...(replayScenes?.values() ?? [])] });
      channel.postMessage({ type: "snapshot", snapshot });
    }
    else broadcastSnapshot();
  }
});

window.addEventListener("keydown", (event) => {
  if (sessionReplayer) return;
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
const preflightSignals = { rekordbox: 0, controller: 0, link: 0, midi: 0 };
let mediaCheckRevision = 0;
let lastPreflightMediaKey = "";

function preflightMediaKey() {
  return `${sessionReplayer ? "replay" : "live"}:${snapshot.decks.filter((deck) => deck.loaded).map((deck) => `${deck.id}:${deck.sceneId}`).join("|")}:${sceneQueue.next?.sceneId ?? "none"}`;
}

function renderPreflightInput() {
  const readiness = inputReadiness({
    replaying: Boolean(sessionReplayer),
    bridgeState: lastBridgeStatus || "connecting",
    signals: preflightSignals,
  });
  document.querySelector("#preflight-mode").textContent = readiness.mode;
  document.querySelector("#preflight-input-detail").textContent = readiness.detail;
  document.querySelector(".preflight-input").dataset.tone = readiness.tone;
}

function markPreflightSignal(kind) {
  preflightSignals[kind] = Date.now();
  renderPreflightInput();
}

async function refreshPreflightMedia() {
  const revision = ++mediaCheckRevision;
  lastPreflightMediaKey = preflightMediaKey();
  const status = document.querySelector("#preflight-media-status");
  const list = document.querySelector("#preflight-media-list");
  const assignments = [
    ...snapshot.decks.filter((deck) => deck.loaded).map((deck) => ({ label: `Deck ${deck.id}`, scene: sceneById(deck.sceneId) })),
    { label: "Next load", scene: sceneById(sceneQueue.next?.sceneId) },
  ];
  const plans = assignments.map(({ label, scene }) => ({ label, scene, media: sceneMediaPlan(scene, window.location.href) }));
  status.textContent = "Checking…";
  status.classList.remove("is-warning");
  list.replaceChildren();
  const localUrls = [...new Set(plans.flatMap(({ media }) => media.localUrls))];
  const checks = await Promise.all(localUrls.map(async (url) => {
    try { return [url, (await fetch(url, { method: "HEAD", cache: "no-store" })).ok]; }
    catch { return [url, false]; }
  }));
  if (revision !== mediaCheckRevision) return;
  const available = new Map(checks);
  let needsConnection = false;
  let missingFiles = false;
  for (const { label, scene, media } of plans) {
    const missing = media.missingUrls.length + media.localUrls.filter((url) => !available.get(url)).length;
    const remote = media.remoteUrls.length;
    needsConnection ||= remote > 0;
    missingFiles ||= missing > 0;
    const row = document.createElement("li");
    const name = document.createElement("span");
    name.textContent = `${label} · ${scene.name}`;
    const state = document.createElement("strong");
    state.textContent = missing ? `${missing} missing` : remote ? `${remote} online · ${media.localUrls.length} local` : `${media.localUrls.length} local · ready`;
    state.classList.toggle("is-warning", Boolean(missing || remote));
    row.append(name, state);
    list.append(row);
  }
  status.textContent = missingFiles ? "Missing media" : needsConnection ? "Connection needed" : "Ready offline";
  status.classList.toggle("is-warning", missingFiles || needsConnection);
}

document.querySelector("#preflight-refresh").addEventListener("click", () => void refreshPreflightMedia());
window.setInterval(() => { if (bridgeDrawer.classList.contains("is-open")) renderPreflightInput(); }, 1000);

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
  saveDeckRuntime();
  if (open) {
    renderPreflightInput();
    void refreshPreflightMedia();
    requestAnimationFrame(() => bridgeDrawerClose.focus());
  }
  else bridgeDrawerToggle.focus();
}

if (restoredPlayerState?.bridgeDrawerOpen) setBridgeDrawerOpen(true);

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
    loadDeck(command.deck, { source: "controller" });
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
  if (sessionReplayer) return;
  const state = JSON.parse(data);
  sessionRecorder.captureBridge({ type: "controller-transport", payload: state });
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
  renderPreflightInput();
});
bridgeSource.addEventListener("rekordbox-adapter-status", ({ data }) => {
  const status = JSON.parse(data);
  const target = document.querySelector("#bridge-rekordbox");
  if (status.state === "running" && rekordboxTempoAvailable) return;
  target.textContent = status.state;
  target.title = status.detail ?? "Rekordbox deck-state adapter status updated.";
});
bridgeSource.addEventListener("bridge-message", ({ data }) => {
  if (sessionReplayer) return;
  const message = JSON.parse(data);
  sessionRecorder.captureBridge(message);
  if (message.type === "rekordbox.deck-state") {
    markPreflightSignal("rekordbox");
    const plan = rekordboxTempoPlan(message, snapshot.decks, snapshot.opacities);
    rekordboxTempoAvailable = Boolean(plan);
    const target = document.querySelector("#bridge-rekordbox");
    if (!plan) {
      const epochMs = message.emittedAtUnixMs ?? nowEpochMs();
      const wasAnyPlaying = anyDeckPlaying();
      for (const update of message.payload?.decks ?? []) {
        reconcileObservedTrackLoad(update, message.payload?.adapterSessionId, epochMs);
      }
      snapshot.phraseClock = syncPhraseClock(snapshot.phraseClock, {
        wasAnyPlaying,
        isAnyPlaying: anyDeckPlaying(),
        epochMs,
        bpm: snapshot.linkClock.bpm,
      });
      saveDeckRuntime();
      target.textContent = "No loaded deck";
      broadcastSnapshot();
      return;
    }

    const epochMs = message.emittedAtUnixMs ?? nowEpochMs();
    applyRekordboxDeckState(message, plan);
    target.textContent = `D${plan.sourceDeck} · ${plan.bpm.toFixed(2)} BPM`;
    const signature = `${plan.sourceDeck}|${plan.bpm.toFixed(2)}|${plan.decks.map((entry) => `${entry.deck}:${entry.bpm.toFixed(2)}:${entry.transportKnown ? (entry.playing ? "play" : "pause") : "unknown"}:${entry.trackFingerprint ?? "no-track-key"}`).join(",")}`;
    if (signature !== lastRekordboxFeedSignature) {
      const source = plan.decks.find((entry) => entry.deck === plan.sourceDeck);
      const transport = source?.transportKnown ? (source.playing ? "playing" : "paused") : "transport pending";
      const phase = source?.phaseConfidence && source.phaseConfidence !== "none" ? ` · phase ${source.phaseConfidence}` : "";
      appendBridgeEvent(`Rekordbox · D${plan.sourceDeck} · ${plan.bpm.toFixed(2)} BPM · ${transport}${phase}`, "link", epochMs);
      lastRekordboxFeedSignature = signature;
    }
    broadcastSnapshot();
    return;
  }
  if (message.type === "link.clock") {
    if (message.payload.peers > 0) markPreflightSignal("link");
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
    markPreflightSignal("midi");
    bridgeMidiCount += 1;
    document.querySelector("#bridge-midi").textContent = `${bridgeMidiCount} message${bridgeMidiCount === 1 ? "" : "s"}`;
  }
  if (["controller.control", "rekordbox.control"].includes(message.type)) {
    markPreflightSignal("controller");
    applyControllerMessage(message.payload);
  }
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
  renderPreflightInput();
});

window.addEventListener("pagehide", () => {
  stopSessionReplay();
  savePlayerStateNow();
  metronome.stop();
  bridgeSource.close();
});

renderState();
broadcastSnapshot();
