import { BEATS_PER_BAR, positiveModulo } from "./scheduler.mjs";

export function musicalToBeats(value = {}) {
  return (value.bars ?? 0) * BEATS_PER_BAR + (value.beats ?? 0);
}

export function resolveVisualLoop(scene, activeLoopId, beat, options = {}) {
  const visualLoop = scene.visualLoops.find((candidate) => candidate.id === activeLoopId)
    ?? scene.visualLoops.find((candidate) => candidate.id === scene.defaultLoopId)
    ?? scene.visualLoops[0];
  if (!visualLoop) return [];

  const generation = options.loopGeneration ?? 0;
  if (!options.started) {
    const firstEvent = [...visualLoop.events]
      .sort((left, right) => musicalToBeats(left.at) - musicalToBeats(right.at))[0];
    return firstEvent ? [toInstance(visualLoop, firstEvent, `preview:${generation}:${firstEvent.id}`, 0, 0)] : [];
  }

  const lengthBeats = musicalToBeats(visualLoop.length);
  if (!(lengthBeats > 0)) return [];
  const relativeBeat = beat - (options.loopAnchorBeat ?? 0);
  const loopBeat = positiveModulo(relativeBeat, lengthBeats);

  return visualLoop.events.flatMap((event) => {
    const startBeat = musicalToBeats(event.at);
    const durationBeats = musicalToBeats(event.duration);
    const elapsed = positiveModulo(loopBeat - startBeat, lengthBeats);
    if (!(durationBeats >= lengthBeats || elapsed < durationBeats)) return [];
    const occurrence = Math.floor((relativeBeat - startBeat) / lengthBeats);
    const progress = Math.min(1, Math.max(0, elapsed / durationBeats));
    return [toInstance(visualLoop, event, `${generation}:${occurrence}:${event.id}`, progress, loopBeat / lengthBeats, elapsed)];
  }).sort((left, right) => left.z - right.z);
}

function appearanceOpacity(event, progress) {
  const baseOpacity = event.appearance.opacity;
  const envelope = event.appearance.opacityEnvelope;
  if (!envelope) return baseOpacity;
  const envelopeOpacity = envelope.from + (envelope.to - envelope.from) * progress;
  return baseOpacity * envelopeOpacity;
}

function toInstance(visualLoop, event, occurrenceKey, progress, loopProgress, elapsedBeats = 0) {
  return {
    loopId: visualLoop.id,
    eventId: event.id,
    nodeKey: `${visualLoop.id}:${event.id}`,
    occurrenceKey,
    clipId: event.clipId,
    source: event.source,
    z: event.appearance.z,
    opacity: appearanceOpacity(event, progress),
    progress,
    loopProgress,
    elapsedBeats,
    blendMode: event.appearance.blendMode,
    fit: event.appearance.fit,
    filters: event.appearance.filters ?? [],
    motion: event.appearance.motion ?? null,
  };
}

export function filtersToCss(filters = []) {
  if (!filters.length) return "none";
  return filters.map((filter) => {
    if (filter.type === "grayscale") return `grayscale(${filter.amount})`;
    if (filter.type === "invert") return `invert(${filter.amount})`;
    if (filter.type === "contrast") return `contrast(${filter.amount})`;
    if (filter.type === "hue-rotate") return `hue-rotate(${filter.degrees}deg)`;
    return "";
  }).filter(Boolean).join(" ") || "none";
}
