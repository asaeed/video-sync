import { compileTwoClipLoop, TWO_CLIP_RECIPE_TYPES } from "./loop-recipes.mjs";

const DEFAULT_LENGTHS = [{ bars: 1 }, { bars: 2 }, { bars: 4 }];

function unit(random) {
  const value = Number(random());
  return Number.isFinite(value) ? Math.min(0.999999999, Math.max(0, value)) : 0;
}

function pick(values, random) {
  return values[Math.floor(unit(random) * values.length)];
}

function beats(value = {}) {
  return (value.bars ?? 0) * 4 + (value.beats ?? 0);
}

function randomStartSeconds(clip, random) {
  const lastUsefulStart = Math.max(0, (clip.durationSeconds ?? 8) - 2);
  return Math.round(unit(random) * lastUsefulStart * 2) / 2;
}

function chooseDistinctClips(candidates, random) {
  const firstIndex = Math.floor(unit(random) * candidates.length);
  let secondIndex = Math.floor(unit(random) * (candidates.length - 1));
  if (secondIndex >= firstIndex) secondIndex += 1;
  return [candidates[firstIndex], candidates[secondIndex]];
}

function recipeOptions(type, length, random) {
  const totalBeats = beats(length);
  if (type === "sequence") return { switchAt: { beats: totalBeats / 2 } };
  if (type === "alternate") {
    const segments = [0.5, 1, 2, 4].filter((segment) => segment <= totalBeats / 2);
    return { segment: { beats: pick(segments, random) } };
  }
  if (type === "flash-overlay") {
    const intervals = [1, 2, 4].filter((interval) => interval < totalBeats);
    return {
      interval: { beats: pick(intervals, random) },
      flashDuration: { beats: pick([0.25, 0.5], random) },
    };
  }
  if (type === "call-response") {
    const responseBeats = pick([1, 2].filter((duration) => duration < totalBeats), random);
    return { switchAt: { beats: totalBeats - responseBeats } };
  }
  return {};
}

function recipeLabel(type) {
  return {
    sequence: "Sequence",
    alternate: "Alternate",
    "flash-overlay": "Flash overlay",
    "call-response": "Call/response",
    crossfade: "Crossfade",
  }[type];
}

export function generateRandomLoop(scene, random = Math.random) {
  const config = scene.randomLoop ?? {};
  const candidates = (config.candidateClipIds ?? scene.clips.map((clip) => clip.id))
    .map((clipId) => scene.clips.find((clip) => clip.id === clipId))
    .filter(Boolean);
  if (candidates.length < 2) throw new Error(`${scene.id}: random loop requires at least two clips`);

  const recipes = (config.recipes ?? TWO_CLIP_RECIPE_TYPES).filter((type) => TWO_CLIP_RECIPE_TYPES.includes(type));
  const lengths = config.lengths?.length ? config.lengths : DEFAULT_LENGTHS;
  if (!recipes.length || !lengths.length) throw new Error(`${scene.id}: random loop requires recipes and lengths`);

  const type = pick(recipes, random);
  const length = pick(lengths, random);
  const selected = chooseDistinctClips(candidates, random).map((clip) => ({
    ...clip,
    startSeconds: randomStartSeconds(clip, random),
  }));
  return compileTwoClipLoop({
    id: config.id ?? "random-loop",
    name: `Random · ${recipeLabel(type)} · ${selected.map((clip) => clip.id.replace("clip-", "Clip ")).join(" + ")}`,
    type,
    length: { ...length },
    clips: selected,
    fit: config.fit ?? scene.fit ?? selected[0].fit ?? "cover",
    ...recipeOptions(type, length, random),
  });
}
