const beats = (value = {}) => (value.bars ?? 0) * 4 + (value.beats ?? 0);
const at = (beat) => ({ beats: beat });
const duration = (beatCount) => ({ beats: beatCount });

function appearance(fit, z = 0, opacityEnvelope, blendMode = "normal") {
  return {
    z,
    opacity: 1,
    blendMode,
    fit,
    filters: [],
    ...(opacityEnvelope ? { opacityEnvelope } : {}),
  };
}

function event(loopId, suffix, clip, startBeat, durationBeats, fit, options = {}) {
  return {
    id: `${loopId}-${suffix}`,
    at: at(startBeat),
    duration: duration(durationBeats),
    clipId: clip.id,
    source: { startSeconds: clip.startSeconds ?? 0, loop: true, rate: 1 },
    appearance: appearance(fit, options.z ?? 0, options.opacityEnvelope, options.blendMode),
  };
}

function splitEvents(config, totalBeats, response = false) {
  const switchBeat = beats(config.switchAt ?? (response ? { beats: totalBeats - 1 } : { beats: totalBeats / 2 }));
  if (!(switchBeat > 0 && switchBeat < totalBeats)) throw new Error(`${config.id}: switchAt must fall inside the loop`);
  return [
    event(config.id, "a", config.clips[0], 0, switchBeat, config.fit),
    event(config.id, "b", config.clips[1], switchBeat, totalBeats - switchBeat, config.fit),
  ];
}

function alternateEvents(config, totalBeats) {
  const segmentBeats = beats(config.segment ?? { beats: 1 });
  if (!(segmentBeats > 0)) throw new Error(`${config.id}: segment must be positive`);
  const events = [];
  for (let cursor = 0, index = 0; cursor < totalBeats; cursor += segmentBeats, index += 1) {
    const clipIndex = index % 2;
    events.push(event(
      config.id,
      `${clipIndex === 0 ? "a" : "b"}-${index + 1}`,
      config.clips[clipIndex],
      cursor,
      Math.min(segmentBeats, totalBeats - cursor),
      config.fit,
    ));
  }
  return events;
}

function flashEvents(config, totalBeats) {
  const intervalBeats = beats(config.interval ?? { beats: 1 });
  const flashBeats = beats(config.flashDuration ?? { beats: 0.25 });
  const offsetBeats = beats(config.offset ?? { beats: 0 });
  if (!(intervalBeats > 0 && flashBeats > 0)) throw new Error(`${config.id}: flash interval and duration must be positive`);
  if (!(offsetBeats >= 0 && offsetBeats < totalBeats)) throw new Error(`${config.id}: flash offset must fall inside the loop`);
  const events = [event(config.id, "base", config.clips[0], 0, totalBeats, config.fit)];
  for (let cursor = offsetBeats, index = 1; cursor < totalBeats; cursor += intervalBeats, index += 1) {
    events.push(event(
      config.id,
      `flash-${index}`,
      config.clips[1],
      cursor,
      Math.min(flashBeats, totalBeats - cursor),
      config.fit,
      { z: 10 },
    ));
  }
  return events;
}

function crossfadeEvents(config, totalBeats) {
  return [
    event(config.id, "a", config.clips[0], 0, totalBeats, config.fit, {
      blendMode: "plus-lighter",
      opacityEnvelope: { from: 1, to: 0, curve: "linear" },
    }),
    event(config.id, "b", config.clips[1], 0, totalBeats, config.fit, {
      z: 1,
      blendMode: "plus-lighter",
      opacityEnvelope: { from: 0, to: 1, curve: "linear" },
    }),
  ];
}

export const TWO_CLIP_RECIPE_TYPES = ["sequence", "alternate", "flash-overlay", "call-response", "crossfade"];

export function compileTwoClipLoop(config) {
  if (!TWO_CLIP_RECIPE_TYPES.includes(config?.type)) throw new Error(`Unknown two-clip recipe: ${config?.type}`);
  if (!Array.isArray(config.clips) || config.clips.length !== 2 || config.clips.some((clip) => !clip?.id)) {
    throw new Error(`${config.id}: two clips are required`);
  }
  const totalBeats = beats(config.length);
  if (!(totalBeats > 0)) throw new Error(`${config.id}: loop length must be positive`);
  const normalized = { ...config, fit: config.fit ?? "cover" };
  let events;
  if (config.type === "sequence") events = splitEvents(normalized, totalBeats);
  if (config.type === "call-response") events = splitEvents(normalized, totalBeats, true);
  if (config.type === "alternate") events = alternateEvents(normalized, totalBeats);
  if (config.type === "flash-overlay") events = flashEvents(normalized, totalBeats);
  if (config.type === "crossfade") events = crossfadeEvents(normalized, totalBeats);
  return { id: config.id, name: config.name, length: config.length, repeat: true, events };
}
