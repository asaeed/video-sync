function normalizedCues(cues = []) {
  return cues.flatMap((cue) => {
    const cueIndex = Number(cue?.cueIndex);
    const timeSeconds = Number(cue?.timeSeconds);
    if (!Number.isInteger(cueIndex) || cueIndex < 0 || cueIndex > 7 || !(timeSeconds >= 0)) return [];
    return [{ cueIndex, timeSeconds }];
  }).sort((left, right) => left.timeSeconds - right.timeSeconds || left.cueIndex - right.cueIndex);
}

export function cueTimelineSignature(cues = []) {
  return normalizedCues(cues).map((cue) => `${cue.cueIndex}@${cue.timeSeconds.toFixed(3)}`).join("|");
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

  return normalizedCues(current.hotCues).flatMap((cue) => {
    if (!(cue.timeSeconds > previousPosition && cue.timeSeconds <= currentPosition)) return [];
    const fraction = (cue.timeSeconds - previousPosition) / positionAdvance;
    return [{
      ...cue,
      crossedAtEpochMs: previousEpochMs + fraction * (currentEpochMs - previousEpochMs),
      observedAtEpochMs: currentEpochMs,
    }];
  });
}
