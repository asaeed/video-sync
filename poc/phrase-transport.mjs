import { beatAt, positiveModulo, reanchorClock } from "./scheduler.mjs";

export function createPhraseClock(bpm = 100, epochMs = Date.now()) {
  return {
    bpm,
    playing: false,
    anchorBeat: 0,
    anchorEpochMs: epochMs,
  };
}

export function syncPhraseClock(clock, {
  wasAnyPlaying,
  isAnyPlaying,
  epochMs,
  bpm = clock.bpm,
}) {
  if (!wasAnyPlaying && isAnyPlaying) {
    return {
      bpm,
      playing: true,
      anchorBeat: 0,
      anchorEpochMs: epochMs,
    };
  }
  if (wasAnyPlaying && !isAnyPlaying) {
    return reanchorClock(clock, epochMs, { bpm, playing: false });
  }
  if (clock.bpm !== bpm) return reanchorClock(clock, epochMs, { bpm });
  return { ...clock, playing: isAnyPlaying };
}

export function visualLoopWindows({
  phraseBeat,
  deckBeat,
  loopAnchorBeat,
  loopLengthBeats,
  loopStartPhraseBeat,
  phraseBars = 16,
  beatsPerBar = 4,
}) {
  if (!(loopLengthBeats > 0) || !(phraseBars > 0) || !(beatsPerBar > 0)) return [];
  const phraseLengthBeats = phraseBars * beatsPerBar;
  const phraseCycleStart = Math.floor(Math.max(0, phraseBeat) / phraseLengthBeats) * phraseLengthBeats;
  const phraseCycleEnd = phraseCycleStart + phraseLengthBeats;
  const loopPhase = positiveModulo(deckBeat - loopAnchorBeat, loopLengthBeats);
  const earliestLoopStart = Number.isFinite(loopStartPhraseBeat) ? loopStartPhraseBeat : -Infinity;
  let startBeat = phraseBeat - loopPhase;

  while (startBeat > phraseCycleStart) {
    const previousStart = startBeat - loopLengthBeats;
    if (previousStart < earliestLoopStart - 0.001) break;
    startBeat = previousStart;
  }
  while (startBeat + loopLengthBeats <= phraseCycleStart) startBeat += loopLengthBeats;

  const windows = [];
  for (; startBeat < phraseCycleEnd; startBeat += loopLengthBeats) {
    if (startBeat < earliestLoopStart - 0.001) continue;
    const startBars = (startBeat - phraseCycleStart) / beatsPerBar;
    const endBars = (startBeat + loopLengthBeats - phraseCycleStart) / beatsPerBar;
    const window = {
      startBars,
      endBars,
      visibleStartBars: Math.max(0, startBars),
      visibleEndBars: Math.min(phraseBars, endBars),
    };
    // Ignore sub-pixel boundary slivers caused by the phrase and deck clocks
    // being sampled a few milliseconds apart.
    if (window.visibleEndBars - window.visibleStartBars > 0.02) windows.push(window);
  }
  return windows;
}

export function phraseBeatAt(clock, epochMs) {
  return clock.playing ? Math.max(0, beatAt(clock, epochMs)) : 0;
}
