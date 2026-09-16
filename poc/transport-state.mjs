const DEFAULT_MAX_AGE_MS = 12 * 60 * 60 * 1000;

function finite(value, fallback = 0) {
  return Number.isFinite(value) ? value : fallback;
}

function runtimeLoop(value) {
  if (!value || typeof value.id !== "string" || !value.length || !Array.isArray(value.events) || !value.events.length) return null;
  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    return null;
  }
}

export function serializeDeckRuntime(decks) {
  return JSON.stringify({
    v: 1,
    decks: decks.map((deck) => ({
      sceneId: deck.sceneId,
      generation: finite(deck.generation),
      loaded: Boolean(deck.loaded),
      playing: Boolean(deck.playing),
      started: Boolean(deck.started),
      counted: Boolean(deck.counted),
      clipOrder: Array.isArray(deck.clipOrder) ? [...deck.clipOrder] : [],
      randomLoop: runtimeLoop(deck.randomLoop),
      activeLoopId: deck.activeLoopId,
      activeCueInput: deck.activeCueInput ?? null,
      cueAnchorLinkBeat: Number.isFinite(deck.cueAnchorLinkBeat) ? deck.cueAnchorLinkBeat : null,
      loopAnchorBeat: finite(deck.loopAnchorBeat),
      loopGeneration: finite(deck.loopGeneration),
      clock: {
        bpm: finite(deck.clock?.bpm, 100),
        playing: Boolean(deck.playing),
        anchorBeat: finite(deck.clock?.anchorBeat),
        anchorEpochMs: finite(deck.clock?.anchorEpochMs, Date.now()),
      },
    })),
  });
}

export function parseDeckRuntime(raw, sceneIds, deckCount = 2) {
  try {
    const value = JSON.parse(raw);
    if (value?.v !== 1 || !Array.isArray(value.decks)) return null;
    const allowedScenes = new Set(sceneIds);
    return Array.from({ length: deckCount }, (_, index) => {
      const deck = value.decks[index];
      if (!deck || !allowedScenes.has(deck.sceneId) || typeof deck.activeLoopId !== "string") return null;
      const playing = Boolean(deck.playing);
      return {
        sceneId: deck.sceneId,
        generation: Math.max(0, finite(deck.generation)),
        loaded: Boolean(deck.loaded),
        playing,
        started: Boolean(deck.started) || playing,
        counted: Boolean(deck.counted),
        clipOrder: Array.isArray(deck.clipOrder)
          ? deck.clipOrder.filter((clipId) => typeof clipId === "string")
          : [],
        randomLoop: runtimeLoop(deck.randomLoop),
        activeLoopId: deck.activeLoopId,
        activeCueInput: typeof deck.activeCueInput === "string" ? deck.activeCueInput : null,
        cueAnchorLinkBeat: Number.isFinite(deck.cueAnchorLinkBeat) ? deck.cueAnchorLinkBeat : null,
        loopAnchorBeat: finite(deck.loopAnchorBeat),
        loopGeneration: Math.max(0, finite(deck.loopGeneration)),
        clock: {
          bpm: finite(deck.clock?.bpm, 100),
          playing,
          anchorBeat: finite(deck.clock?.anchorBeat),
          anchorEpochMs: finite(deck.clock?.anchorEpochMs, Date.now()),
        },
      };
    });
  } catch {
    return null;
  }
}

export class ControllerTransportTracker {
  constructor(deckCount = 2, saved = null, { now = Date.now(), maxAgeMs = DEFAULT_MAX_AGE_MS } = {}) {
    this.decks = Array.from({ length: deckCount }, (_, index) => ({
      deck: index + 1,
      known: false,
      playing: false,
      updatedAtUnixMs: null,
    }));
    if (!saved || saved.v !== 1 || now - finite(saved.savedAtUnixMs) > maxAgeMs) return;
    for (const candidate of saved.decks ?? []) {
      const deck = this.decks[candidate?.deck - 1];
      if (!deck || typeof candidate.known !== "boolean" || typeof candidate.playing !== "boolean") continue;
      deck.known = candidate.known;
      deck.playing = candidate.playing;
      deck.updatedAtUnixMs = Number.isFinite(candidate.updatedAtUnixMs) ? candidate.updatedAtUnixMs : null;
    }
  }

  observe(payload, updatedAtUnixMs = Date.now()) {
    const hotCue = /^hotcue\.[a-h]$/i.test(payload?.event);
    if (!payload?.active || (!["deck.play", "deck.load", "track.load"].includes(payload.event) && !hotCue)) return false;
    const deck = this.decks[Number(payload.deck) - 1];
    if (!deck) return false;
    deck.playing = payload.event === "deck.play"
      ? (deck.known ? !deck.playing : true)
      : hotCue;
    deck.known = true;
    deck.updatedAtUnixMs = updatedAtUnixMs;
    return true;
  }

  seed(deckNumber, playing, updatedAtUnixMs = Date.now()) {
    const deck = this.decks[Number(deckNumber) - 1];
    if (!deck || deck.known) return false;
    deck.known = true;
    deck.playing = Boolean(playing);
    deck.updatedAtUnixMs = updatedAtUnixMs;
    return true;
  }

  snapshot(savedAtUnixMs = Date.now()) {
    return {
      v: 1,
      savedAtUnixMs,
      decks: this.decks.map((deck) => ({ ...deck })),
    };
  }
}
