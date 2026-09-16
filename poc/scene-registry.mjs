import { SCENE_CATALOG } from "./scene-catalog.mjs";
import { compileTwoClipLoop } from "./loop-recipes.mjs";
import { addAuthoredKenBurns, subjectFocusFor } from "./ken-burns-library.mjs";

const asset = (relativePath) => new URL(relativePath, import.meta.url).href;
const loopBars = [1, 2, 3, 4, 1, 2, 4, 8];
const defaultClipStarts = [0, 0.5, 1, 1.5];
const authoredRecipeTypes = ["sequence", "alternate", "flash-overlay", "call-response", "crossfade"];
const appearance = (fit) => ({ z: 0, opacity: 1, blendMode: "normal", fit, filters: [] });

function loopIdForClip(index) {
  return index === 0 ? "song-default" : `cue-${String.fromCharCode(96 + index)}-loop`;
}

function timelineEvent(scene, index) {
  const clip = scene.clips[index];
  const bars = loopBars[index] ?? 4;
  return {
    id: `${loopIdForClip(index)}-clip-${index + 1}`,
    at: { bars: 0 },
    duration: { bars },
    clipId: clip.id,
    source: { startSeconds: clip.startSeconds ?? 0, loop: true, rate: 1 },
    appearance: appearance(scene.fit),
  };
}

function metropolisVisualLoops(scene) {
  const recipe = (id, name, type, length, clipA, clipB, options = {}) => compileTwoClipLoop({
    id,
    name,
    type,
    length,
    clips: [scene.clips[clipA - 1], scene.clips[clipB - 1]],
    fit: scene.fit,
    ...options,
  });
  return [
    {
      id: "song-default",
      name: "Default · Clip 1",
      length: { bars: 1 },
      repeat: true,
      events: [timelineEvent(scene, 0)],
    },
    recipe("cue-a-loop", "Cue A · Sequence 2→3", "sequence", { bars: 2 }, 2, 3, { switchAt: { bars: 1 } }),
    recipe("cue-b-loop", "Cue B · Alternate 4↔5", "alternate", { bars: 3 }, 4, 5, { segment: { beats: 2 } }),
    recipe("cue-c-loop", "Cue C · Flash 7 over 6", "flash-overlay", { bars: 4 }, 6, 7, {
      interval: { beats: 2 },
      flashDuration: { beats: 0.25 },
    }),
    recipe("cue-d-loop", "Cue D · Call/response 8→9", "call-response", { bars: 1 }, 8, 9, { switchAt: { beats: 3 } }),
    recipe("cue-e-loop", "Cue E · Crossfade 10→11", "crossfade", { bars: 2 }, 10, 11),
    recipe("cue-f-loop", "Cue F · Sequence 12→2", "sequence", { bars: 4 }, 12, 2, { switchAt: { bars: 2 } }),
    recipe("cue-g-loop", "Cue G · Bar accents 4 over 3", "flash-overlay", { bars: 8 }, 3, 4, {
      interval: { bars: 1 },
      flashDuration: { beats: 0.25 },
      offset: { beats: 3 },
    }),
  ];
}

function recipeName(type) {
  return {
    sequence: "Sequence",
    alternate: "Alternate",
    "flash-overlay": "Flash",
    "call-response": "Call/response",
    crossfade: "Crossfade",
  }[type];
}

function recipeOptions(type, length, cueIndex, variant) {
  const totalBeats = (length.bars ?? 0) * 4 + (length.beats ?? 0);
  if (type === "sequence") return { switchAt: { beats: totalBeats / 2 } };
  if (type === "alternate") {
    const choices = [0.5, 1, 2, 4].filter((beats) => beats <= totalBeats / 2);
    return { segment: { beats: choices[(cueIndex + variant) % choices.length] } };
  }
  if (type === "flash-overlay") {
    const intervals = [1, 2, 4].filter((beats) => beats < totalBeats);
    return {
      interval: { beats: intervals[(cueIndex + variant) % intervals.length] },
      flashDuration: { beats: (cueIndex + variant) % 2 ? 0.25 : 0.5 },
      offset: { beats: (cueIndex + variant) % 3 === 0 ? 0.5 : 0 },
    };
  }
  if (type === "call-response") {
    const responseBeats = totalBeats > 4 && (cueIndex + variant) % 2 ? 2 : 1;
    return { switchAt: { beats: totalBeats - responseBeats } };
  }
  return {};
}

function expandedVisualLoops(scene) {
  const variant = [...scene.id].reduce((total, character) => total + character.charCodeAt(0), 0) % authoredRecipeTypes.length;
  const palette = scene.clips.slice(1);
  const offset = (variant * 2) % palette.length;
  const rotated = [...palette.slice(offset), ...palette.slice(0, offset)];
  const pairIndexes = [[0, 1], [2, 3], [4, 5], [6, 7], [8, 9], [10, 0], [1, 2]];
  const loops = [{
    id: "song-default",
    name: "Default · Clip 1",
    length: { bars: 1 },
    repeat: true,
    events: [timelineEvent(scene, 0)],
  }];

  for (let cueIndex = 1; cueIndex <= 7; cueIndex += 1) {
    const [firstIndex, secondIndex] = pairIndexes[cueIndex - 1];
    const clips = [rotated[firstIndex % rotated.length], rotated[secondIndex % rotated.length]];
    const type = authoredRecipeTypes[(cueIndex - 1 + variant) % authoredRecipeTypes.length];
    const length = { bars: loopBars[cueIndex] };
    const cue = String.fromCharCode(64 + cueIndex);
    loops.push(compileTwoClipLoop({
      id: loopIdForClip(cueIndex),
      name: `Cue ${cue} · ${recipeName(type)}`,
      type,
      length,
      clips,
      fit: scene.fit,
      ...recipeOptions(type, length, cueIndex, variant),
    }));
  }
  return loops;
}

function buildScene(definition) {
  const clipTuples = definition.clips ?? definition.labels.map((label, index) => [
    label,
    `../assets/scenes/${definition.id}/clip-${index + 1}.mp4`,
    defaultClipStarts[index % defaultClipStarts.length],
  ]);
  const scene = {
    schemaVersion: 4,
    id: definition.id,
    name: definition.name,
    style: definition.style,
    source: definition.rights,
    sourcePage: definition.sourcePage,
    availability: definition.availability,
    group: definition.group,
    fit: definition.fit,
    clips: clipTuples.map(([label, path, startSeconds], index) => ({
      id: `clip-${index + 1}`,
      label,
      src: asset(path),
      durationSeconds: definition.durationSeconds ?? 8,
      startSeconds,
      ...(definition.availability === "ready" ? { subjectFocus: subjectFocusFor(definition.id, `clip-${index + 1}`) } : {}),
    })),
    advance: { afterSongs: 1 },
  };
  const authoredLoops = scene.id === "metropolis-machine" ? metropolisVisualLoops(scene) : expandedVisualLoops(scene);
  scene.visualLoops = addAuthoredKenBurns(scene, authoredLoops);
  scene.defaultLoopId = "song-default";
  scene.cueBindings = scene.clips.slice(1, 8).map((clip, zeroBasedCueIndex) => {
    const cueIndex = zeroBasedCueIndex + 1;
    const input = `hotCue${String.fromCharCode(64 + cueIndex)}`;
    const isJump = cueIndex === 3;
    return {
      input,
      cue: isJump ? { type: "jump" } : { type: "loop", length: { bars: loopBars[cueIndex] } },
      visual: { loopId: loopIdForClip(cueIndex), retrigger: isJump ? "cue-trigger" : "audio-loop-cycle" },
    };
  });
  scene.randomLoop = {
    id: "random-loop",
    recipes: ["sequence", "alternate", "flash-overlay", "call-response", "crossfade"],
    lengths: [{ bars: 1 }, { bars: 2 }, { bars: 4 }],
    candidateClipIds: scene.clips.map((clip) => clip.id),
    fit: scene.fit,
  };
  delete scene.fit;
  return scene;
}

export const SCENES = SCENE_CATALOG.map(buildScene);
export const PLAYABLE_SCENES = SCENES.filter((scene) => scene.availability === "ready");

export function sceneById(id) {
  return SCENES.find((candidate) => candidate.id === id) ?? PLAYABLE_SCENES[0] ?? SCENES[0];
}
