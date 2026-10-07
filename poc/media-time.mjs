export function mediaTimeForMusicalOffset(source, elapsedBeats, bpm, durationSeconds) {
  const startSeconds = Math.max(0, Number(source?.startSeconds) || 0);
  const rate = Number(source?.rate) > 0 ? Number(source.rate) : 1;
  const secondsPerBeat = Number(bpm) > 0 ? 60 / Number(bpm) : 0;
  const advanceSeconds = Math.max(0, Number(elapsedBeats) || 0) * secondsPerBeat * rate;
  if (!Number.isFinite(durationSeconds)) return startSeconds + advanceSeconds;
  const mediaLastFrame = Math.max(0, durationSeconds - 0.04);
  const configuredEnd = Number(source?.endSeconds);
  const lastFrame = Number.isFinite(configuredEnd)
    ? Math.max(startSeconds, Math.min(mediaLastFrame, configuredEnd - 0.04))
    : mediaLastFrame;
  if (source?.loop && lastFrame > startSeconds) {
    const span = lastFrame - startSeconds;
    return startSeconds + (advanceSeconds % span);
  }
  return Math.min(startSeconds + advanceSeconds, lastFrame);
}
