import { parseDeckRuntime, serializeDeckRuntime } from "./transport-state.mjs";

const clamp01 = (value, fallback) => Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : fallback;
const clock = (value) => value && Number.isFinite(value.bpm) && value.bpm >= 20 && value.bpm <= 300
  && Number.isFinite(value.anchorBeat) && Number.isFinite(value.anchorEpochMs)
  ? { bpm: value.bpm, playing: Boolean(value.playing), anchorBeat: value.anchorBeat, anchorEpochMs: value.anchorEpochMs }
  : null;

export function serializePlayerState(snapshot, { metronomeEnabled = false, bridgeDrawerOpen = false } = {}) {
  return JSON.stringify({
    ...JSON.parse(serializeDeckRuntime(snapshot.decks)),
    linkClock: snapshot.linkClock,
    phraseClock: snapshot.phraseClock,
    crossfader: snapshot.crossfader,
    beatFx: snapshot.effects.beatFx,
    songCount: snapshot.songCount,
    metronomeEnabled,
    bridgeDrawerOpen,
  });
}

export function parsePlayerState(raw, sceneIds, deckCount = 2) {
  try {
    const value = JSON.parse(raw);
    const decks = parseDeckRuntime(raw, sceneIds, deckCount);
    if (!decks) return null;
    const beatFx = value.beatFx && typeof value.beatFx === "object" ? value.beatFx : null;
    return {
      decks,
      linkClock: clock(value.linkClock),
      phraseClock: clock(value.phraseClock),
      crossfader: clamp01(value.crossfader, 0.5),
      beatFx: beatFx ? {
        selected: typeof beatFx.selected === "string" ? beatFx.selected : "delay",
        enabled: Boolean(beatFx.enabled),
        target: typeof beatFx.target === "string" ? beatFx.target : "master",
        depth: clamp01(beatFx.depth, 0.5),
        beatMultiplier: Number.isFinite(beatFx.beatMultiplier) && beatFx.beatMultiplier > 0 ? beatFx.beatMultiplier : 1,
      } : null,
      songCount: Number.isInteger(value.songCount) && value.songCount >= 0 ? value.songCount : 0,
      metronomeEnabled: Boolean(value.metronomeEnabled),
      bridgeDrawerOpen: Boolean(value.bridgeDrawerOpen),
    };
  } catch {
    return null;
  }
}
