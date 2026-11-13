import { normalizeHotCues } from "./rekordbox-state.mjs";

export function cueTimelineSignature(cues = []) {
  return normalizeHotCues(cues).map((cue) => [
    `${cue.cueIndex}@${cue.timeSeconds.toFixed(3)}`,
    cue.kind,
    Number.isFinite(cue.endTimeSeconds) ? cue.endTimeSeconds.toFixed(3) : "-",
    Number.isFinite(cue.lengthBeats) ? cue.lengthBeats.toFixed(3) : "-",
  ].join(":")).join("|");
}

function canCompareCueTimelines(previous, current) {
  return Boolean(previous?.loaded && current?.loaded && previous.trackKey && previous.trackKey === current.trackKey
    && ["visible", "cached"].includes(previous.hotCueMetadataBasis) && current.hotCueMetadataBasis === "visible"
    && current.epochMs > previous.epochMs);
}

export function deletedHotCues(previous, current) {
  if (!canCompareCueTimelines(previous, current)) return [];
  const remaining = new Set(normalizeHotCues(current.hotCues).map((cue) => cue.cueIndex));
  return normalizeHotCues(previous.hotCues).filter((cue) => !remaining.has(cue.cueIndex));
}

// A visible timeline edit is separate from passing an existing cue timestamp.
// Compare only observations of the same load with an established cue baseline.
export function assignedHotCues(previous, current, { bpm = null } = {}) {
  if (!canCompareCueTimelines(previous, current) || !Number.isFinite(current.positionSeconds)) return [];
  const before = new Map(normalizeHotCues(previous.hotCues).map((cue) => [cue.cueIndex, cue]));
  return normalizeHotCues(current.hotCues).flatMap((cue) => {
    const old = before.get(cue.cueIndex);
    if (old && Math.abs(old.timeSeconds - cue.timeSeconds) < 0.035) return [];
    // Rekordbox sometimes exposes only an anonymous timestamp. A saved loop
    // still starts at that timestamp, even when its kind is unavailable.
    const elapsedBeats = cue.kind === "cue" || !(bpm > 0)
      ? 0 : Math.max(0, current.positionSeconds - cue.timeSeconds) * bpm / 60;
    return [{ ...cue, elapsedBeats }];
  });
}

export function crossedHotCues(previous, current, { playing = false } = {}) {
  if (!playing || !previous || !current) return [];
  const previousPosition = Number(previous.positionSeconds);
  const currentPosition = Number(current.positionSeconds);
  const previousEpochMs = Number(previous.epochMs);
  const currentEpochMs = Number(current.epochMs);
  if (![previousPosition, currentPosition, previousEpochMs, currentEpochMs].every(Number.isFinite)) return [];
  if (currentEpochMs <= previousEpochMs || currentPosition <= previousPosition) return [];
  if (cueTimelineSignature(previous.hotCues) !== cueTimelineSignature(current.hotCues)) return [];

  const observedSeconds = (currentEpochMs - previousEpochMs) / 1000;
  const positionAdvance = currentPosition - previousPosition;
  const maximumContinuousAdvance = Math.max(2.5, observedSeconds * 1.75 + 0.5);
  if (positionAdvance > maximumContinuousAdvance) return [];

  return normalizeHotCues(current.hotCues).flatMap((cue) => {
    if (!(cue.timeSeconds > previousPosition && cue.timeSeconds <= currentPosition)) return [];
    const fraction = (cue.timeSeconds - previousPosition) / positionAdvance;
    return [{
      ...cue,
      crossedAtEpochMs: previousEpochMs + fraction * (currentEpochMs - previousEpochMs),
      observedAtEpochMs: currentEpochMs,
    }];
  });
}

export function detectedLoopWrap(previous, current, { playing = false, activeCue = null, bpm = null } = {}) {
  if (!playing || !previous || !current || activeCue?.kind !== "loop") return null;
  const previousPosition = Number(previous.positionSeconds);
  const currentPosition = Number(current.positionSeconds);
  const previousEpochMs = Number(previous.epochMs);
  const currentEpochMs = Number(current.epochMs);
  const loopStart = Number(activeCue.timeSeconds);
  if (![previousPosition, currentPosition, previousEpochMs, currentEpochMs, loopStart].every(Number.isFinite)) return null;
  if (currentEpochMs <= previousEpochMs || currentPosition >= previousPosition) return null;

  let loopEnd = Number(activeCue.endTimeSeconds);
  if (!Number.isFinite(loopEnd)) {
    const lengthBeats = Number(activeCue.lengthBeats);
    const tempo = Number(bpm);
    if (lengthBeats > 0 && tempo > 0) loopEnd = loopStart + lengthBeats * 60 / tempo;
  }
  if (!(loopEnd > loopStart)) return null;

  const duration = loopEnd - loopStart;
  const tolerance = Math.min(0.75, Math.max(0.2, duration * 0.2));
  if (previousPosition < loopEnd - tolerance || previousPosition > loopEnd + tolerance) return null;
  if (currentPosition < loopStart - 0.1 || currentPosition > loopStart + tolerance) return null;

  const tailSeconds = Math.max(0, loopEnd - previousPosition);
  const headSeconds = Math.max(0, currentPosition - loopStart);
  const traversedSeconds = tailSeconds + headSeconds;
  const fraction = traversedSeconds > 0 ? tailSeconds / traversedSeconds : 0.5;
  return {
    cueIndex: activeCue.cueIndex,
    wrappedAtEpochMs: previousEpochMs + fraction * (currentEpochMs - previousEpochMs),
    observedAtEpochMs: currentEpochMs,
    loopStartSeconds: loopStart,
    loopEndSeconds: loopEnd,
  };
}
