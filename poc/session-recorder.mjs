// A performance recording stores controller evidence and resolved visual state.
// Replaying the latter does not need Rekordbox, Link, or the controller.
import { reanchorClock } from "./scheduler.mjs";
const MAX_RECORDING_BYTES = 512 * 1024 * 1024;

function discreteVisualSignature(snapshot) {
  return JSON.stringify({
    decks: snapshot.decks.map((deck) => ({
      loaded: deck.loaded, playing: deck.playing, started: deck.started,
      sceneId: deck.sceneId, generation: deck.generation,
      activeLoopId: deck.activeLoopId, activeCueInput: deck.activeCueInput,
      loopGeneration: deck.loopGeneration, loopAnchorBeat: deck.loopAnchorBeat,
    })),
    effect: snapshot.effects?.beatFx && {
      enabled: snapshot.effects.beatFx.enabled, selected: snapshot.effects.beatFx.selected,
      target: snapshot.effects.beatFx.target, beatMultiplier: snapshot.effects.beatFx.beatMultiplier,
    },
  });
}

export function shiftedSnapshot(snapshot, offsetMs) {
  const copy = structuredClone(snapshot);
  for (const clock of [copy.linkClock, copy.phraseClock, ...copy.decks.map((deck) => deck.clock)]) {
    if (Number.isFinite(clock?.anchorEpochMs)) clock.anchorEpochMs += offsetMs;
  }
  return copy;
}

function frozenSnapshot(snapshot, epochMs) {
  const copy = structuredClone(snapshot);
  for (const key of ["linkClock", "phraseClock"]) {
    if (copy[key]) copy[key] = reanchorClock(copy[key], epochMs, { playing: false });
  }
  for (const deck of copy.decks) {
    deck.clock = reanchorClock(deck.clock, epochMs, { playing: false });
    deck.playing = false;
  }
  return copy;
}

export function validateSession(value) {
  if (value?.format !== "video-sync-session" || value.version !== 1 || !Array.isArray(value.events)) {
    throw new Error("Not a Video Sync session recording");
  }
  if (!value.events.length || value.events[0].type !== "snapshot") throw new Error("Recording has no initial visual state");
  let previous = -1;
  for (const event of value.events) {
    if (!Number.isFinite(event.atMs) || event.atMs < previous || !["snapshot", "bridge"].includes(event.type)) {
      throw new Error("Recording event order is invalid");
    }
    previous = event.atMs;
  }
  if (!Number.isFinite(value.startedAt) || !Number.isFinite(value.durationMs) || value.durationMs < previous) {
    throw new Error("Recording duration is invalid");
  }
  return value;
}

export class SessionRecorder {
  constructor(now = () => Date.now()) {
    this.now = now;
    this.session = null;
    this.lastSnapshotAt = -Infinity;
    this.lastSignature = null;
  }

  start(snapshot) {
    const startedAt = this.now();
    this.session = { format: "video-sync-session", version: 1, startedAt, events: [] };
    this.lastSnapshotAt = -Infinity;
    this.lastSignature = null;
    this.captureSnapshot(snapshot, true);
  }

  captureSnapshot(snapshot, force = false) {
    if (!this.session) return;
    const atMs = this.now() - this.session.startedAt;
    const signature = discreteVisualSignature(snapshot);
    // Fader/Link updates can be rapid; 30 Hz preserves motion without a huge file.
    if (!force && signature === this.lastSignature && atMs - this.lastSnapshotAt < 33) return;
    this.session.events.push({ type: "snapshot", atMs, value: structuredClone(snapshot) });
    this.lastSnapshotAt = atMs;
    this.lastSignature = signature;
  }

  captureBridge(message) {
    if (!this.session) return;
    this.session.events.push({ type: "bridge", atMs: this.now() - this.session.startedAt, value: message });
  }

  stop(snapshot) {
    if (!this.session) return null;
    this.captureSnapshot(snapshot, true);
    this.session.durationMs = this.now() - this.session.startedAt;
    const result = this.session;
    this.session = null;
    return result;
  }
}

export class SessionReplayer {
  constructor(session, onSnapshot, { now = () => Date.now(), setTimer = setTimeout, clearTimer = clearTimeout } = {}) {
    this.session = validateSession(session);
    this.playbackEvents = session.events.filter((event) => event.type === "snapshot");
    this.onSnapshot = onSnapshot;
    this.now = now;
    this.setTimer = setTimer;
    this.clearTimer = clearTimer;
    this.timer = null;
    this.index = 0;
    this.replayStartedAt = 0;
    this.active = false;
  }

  start() {
    if (this.active) return;
    this.active = true;
    this.index = 0;
    this.replayStartedAt = this.now();
    this.advance();
  }

  advance() {
    if (!this.active) return;
    const elapsed = this.now() - this.replayStartedAt;
    while (this.index < this.playbackEvents.length && this.playbackEvents[this.index].atMs <= elapsed) {
      const event = this.playbackEvents[this.index++];
      this.onSnapshot(shiftedSnapshot(event.value, this.replayStartedAt - this.session.startedAt));
    }
    if (this.index < this.playbackEvents.length) {
      const delay = Math.max(0, this.playbackEvents[this.index].atMs - elapsed);
      this.timer = this.setTimer(() => this.advance(), delay);
    } else {
      const last = this.playbackEvents.at(-1);
      if (last) {
        const shifted = shiftedSnapshot(last.value, this.replayStartedAt - this.session.startedAt);
        this.onSnapshot(frozenSnapshot(shifted, this.replayStartedAt + this.session.durationMs));
      }
      this.active = false;
      this.timer = null;
    }
  }

  stop() {
    this.active = false;
    if (this.timer !== null) this.clearTimer(this.timer);
    this.timer = null;
  }
}

export async function readSession(file) {
  if (file.size > MAX_RECORDING_BYTES) throw new Error("Recording exceeds the 512 MB import limit");
  const stream = file.name.endsWith(".gz") ? file.stream().pipeThrough(new DecompressionStream("gzip")) : file.stream();
  return validateSession(JSON.parse(await new Response(stream).text()));
}

export async function sessionBlob(session) {
  const raw = new Blob([JSON.stringify(session)], { type: "application/json" });
  if (typeof CompressionStream === "undefined") return { blob: raw, extension: "json" };
  const blob = await new Response(raw.stream().pipeThrough(new CompressionStream("gzip"))).blob();
  return { blob, extension: "json.gz" };
}
