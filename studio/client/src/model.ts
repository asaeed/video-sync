import type { CueBinding, LoopEvent, MusicalTime, RuntimeScene, SceneProject, SourceClip, VisualLoop } from "./types";
import { firstAvailableLane, laneOf } from "./loop-lanes";

export const CLIP_COLORS = ["#78c7dc", "#eab56f", "#d892d9", "#8ed09d", "#ee7f75", "#9d9bea", "#d4cf70", "#6fcdbd"];
export const CUE_LETTERS = ["A", "B", "C", "D", "E", "F", "G", "H"] as const;

export function beatsFromMusical(value: MusicalTime = {}): number {
  return (value.bars ?? 0) * 4 + (value.beats ?? 0);
}

export function musicalFromBeats(beats: number): MusicalTime {
  const safe = Math.max(0, Math.round(beats * 4) / 4);
  const bars = Math.floor(safe / 4);
  const remainder = safe - bars * 4;
  return {
    ...(bars > 0 ? { bars } : {}),
    ...(remainder > 0 || bars === 0 ? { beats: remainder } : {}),
  };
}

export function slugify(value: string): string {
  return value.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "untitled";
}

export function uniqueId(prefix: string, existingIds: string[]): string {
  let index = existingIds.length + 1;
  let candidate = `${prefix}-${index}`;
  while (existingIds.includes(candidate)) candidate = `${prefix}-${++index}`;
  return candidate;
}

export function emptyAppearance(z = 0): LoopEvent["appearance"] {
  return { z, opacity: 1, blendMode: "normal", fit: "cover", filters: [] };
}

export function makeClip(project: SceneProject, sourceId: string, inSeconds: number, outSeconds: number): SourceClip {
  const id = uniqueId("clip", project.clips.map((clip) => clip.id));
  return {
    id,
    sourceId,
    label: `Clip ${project.clips.length + 1}`,
    inSeconds,
    outSeconds,
    color: CLIP_COLORS[project.clips.length % CLIP_COLORS.length],
    defaultEndBehavior: "loop",
  };
}

export function makeLoop(project: SceneProject): VisualLoop {
  const id = uniqueId("loop", project.visualLoops.map((loop) => loop.id));
  return { id, name: `Loop ${project.visualLoops.length + 1}`, length: { bars: 4 }, repeat: true, events: [] };
}

export function makeEvent(project: SceneProject, loop: VisualLoop, clipId: string, atBeats = 0): LoopEvent {
  const clip = project.clips.find((candidate) => candidate.id === clipId);
  const duration = Math.min(4, Math.max(0.25, beatsFromMusical(loop.length) - atBeats));
  return {
    id: uniqueId("event", loop.events.map((event) => event.id)),
    clipId,
    lane: firstAvailableLane(loop.events, atBeats, duration),
    at: musicalFromBeats(atBeats),
    duration: musicalFromBeats(duration),
    source: { offsetSeconds: 0, rate: 1, endBehavior: clip?.defaultEndBehavior ?? "loop" },
    appearance: emptyAppearance(loop.events.reduce((highest, event) => Math.max(highest, event.appearance.z), -1) + 1),
  };
}

export function duplicateEventAfter(loop: VisualLoop, eventId: string): string | null {
  const originalIndex = loop.events.findIndex((event) => event.id === eventId);
  if (originalIndex < 0) return null;
  const original = loop.events[originalIndex];
  const originalEnd = beatsFromMusical(original.at) + beatsFromMusical(original.duration);
  const copy = structuredClone(original);
  copy.id = uniqueId("event", loop.events.map((event) => event.id));
  copy.at = musicalFromBeats(originalEnd);
  copy.lane = laneOf(original);
  loop.events.splice(originalIndex + 1, 0, copy);

  // Make room on this lane without disturbing instances on other lanes.
  let cursor = originalEnd + beatsFromMusical(copy.duration);
  const later = loop.events.filter((event) => event !== original && event !== copy
    && laneOf(event) === copy.lane && beatsFromMusical(event.at) >= originalEnd)
    .sort((left, right) => beatsFromMusical(left.at) - beatsFromMusical(right.at));
  for (const event of later) {
    const start = Math.max(cursor, beatsFromMusical(event.at));
    event.at = musicalFromBeats(start);
    cursor = start + beatsFromMusical(event.duration);
  }
  if (cursor > beatsFromMusical(loop.length)) loop.length = musicalFromBeats(Math.ceil(cursor / 4) * 4);
  return copy.id;
}

export function sampleProject(): SceneProject {
  const now = new Date().toISOString();
  const cues = CUE_LETTERS.map((letter, index): CueBinding => ({
    input: `hotCue${letter}`,
    loopId: index === 0 ? "cue-a-loop" : null,
    cueType: index === 2 ? "jump" : "loop",
  }));
  return {
    projectVersion: 1,
    schemaVersion: 5,
    id: "metropolis-study",
    name: "Metropolis Study",
    previewBpm: 100,
    createdAt: now,
    updatedAt: now,
    sources: [{
      id: "metropolis-robot-source",
      label: "Robot reveal source",
      file: "/assets/scenes/metropolis/robot-reveal.mp4",
      fileName: "robot-reveal.mp4",
      durationSeconds: 8,
      width: 1280,
      height: 720,
    }],
    clips: [
      { id: "clip-1", sourceId: "metropolis-robot-source", label: "Rings ignite", inSeconds: 0, outSeconds: 2.4, color: CLIP_COLORS[0], defaultEndBehavior: "loop", subjectFocus: { x: 0.44, y: 0.45 } },
      { id: "clip-2", sourceId: "metropolis-robot-source", label: "Robot appears", inSeconds: 2.4, outSeconds: 5.1, color: CLIP_COLORS[1], defaultEndBehavior: "loop", subjectFocus: { x: 0.48, y: 0.45 } },
      { id: "clip-3", sourceId: "metropolis-robot-source", label: "Transformation peak", inSeconds: 5.1, outSeconds: 7.9, color: CLIP_COLORS[2], defaultEndBehavior: "loop", subjectFocus: { x: 0.5, y: 0.44 } },
    ],
    visualLoops: [
      {
        id: "song-default",
        name: "Default",
        length: { bars: 1 },
        repeat: true,
        events: [{
          id: "default-clip-1",
          clipId: "clip-1",
          at: { beats: 0 },
          duration: { bars: 1 },
          source: { offsetSeconds: 0, rate: 1, endBehavior: "loop" },
          appearance: emptyAppearance(0),
        }],
      },
      {
        id: "cue-a-loop",
        name: "Cue A · Sequence",
        length: { bars: 2 },
        repeat: true,
        events: [
          { id: "cue-a-clip-2", clipId: "clip-2", at: { beats: 0 }, duration: { beats: 4 }, source: { offsetSeconds: 0, rate: 1, endBehavior: "loop" }, appearance: emptyAppearance(0) },
          { id: "cue-a-clip-3", clipId: "clip-3", at: { beats: 4 }, duration: { beats: 4 }, source: { offsetSeconds: 0, rate: 1, endBehavior: "loop" }, appearance: emptyAppearance(0) },
        ],
      },
    ],
    defaultLoopId: "song-default",
    cueBindings: cues,
  };
}

export function compileRuntimeScene(project: SceneProject): RuntimeScene {
  const sources = new Map(project.sources.map((source) => [source.id, source]));
  const clips = project.clips.flatMap((clip) => {
    const source = sources.get(clip.sourceId);
    if (!source) return [];
    return [{
      id: clip.id,
      label: clip.label,
      src: source.file,
      durationSeconds: source.durationSeconds,
      startSeconds: clip.inSeconds,
      ...(clip.subjectFocus ? { subjectFocus: clip.subjectFocus } : {}),
    }];
  });
  const loopsById = new Map(project.visualLoops.map((loop) => [loop.id, loop]));
  return {
    schemaVersion: 4,
    id: project.id,
    name: project.name,
    availability: "ready",
    ...(project.style ? { style: project.style } : {}),
    ...(project.source ? { source: project.source } : {}),
    ...(project.sourcePage ? { sourcePage: project.sourcePage } : {}),
    ...(project.group ? { group: project.group } : {}),
    lanePriority: "top",
    clips,
    visualLoops: project.visualLoops.map((loop) => ({
      id: loop.id,
      name: loop.name,
      length: loop.length,
      repeat: true,
      ...(loop.compositing === "layers" ? { compositing: "layers" as const } : {}),
      events: loop.events.flatMap((event) => {
        const clip = project.clips.find((candidate) => candidate.id === event.clipId);
        if (!clip || !sources.has(clip.sourceId)) return [];
        const startSeconds = Math.min(clip.outSeconds, clip.inSeconds + Math.max(0, event.source.offsetSeconds));
        return [{
          id: event.id,
          at: event.at,
          duration: event.duration,
          clipId: event.clipId,
          lane: laneOf(event),
          source: {
            startSeconds,
            endSeconds: clip.outSeconds,
            loop: event.source.endBehavior === "loop",
            rate: event.source.rate,
          },
          appearance: event.appearance,
        }];
      }),
    })),
    defaultLoopId: project.defaultLoopId,
    cueBindings: project.cueBindings.flatMap((binding) => {
      const loop = binding.loopId ? loopsById.get(binding.loopId) : null;
      if (!loop) return [];
      const cue = binding.cueType === "jump" ? { type: "jump" as const } : { type: "loop" as const, length: loop.length };
      return [{
        input: binding.input,
        cue,
        visual: {
          loopId: loop.id,
          retrigger: binding.cueType === "jump" ? "cue-trigger" as const : "audio-loop-cycle" as const,
        },
      }];
    }),
    randomLoop: {
      id: "random-loop",
      recipes: project.randomLoop?.recipes ?? ["sequence", "alternate", "flash-overlay", "call-response", "crossfade"],
      lengths: project.randomLoop?.lengths ?? [{ bars: 1 }, { bars: 2 }, { bars: 4 }],
      candidateClipIds: clips.map((clip) => clip.id),
      fit: project.randomLoop?.fit ?? "cover",
    },
    advance: project.advance ?? { afterSongs: 1 },
  };
}

export function cloneProject(project: SceneProject): SceneProject {
  return structuredClone(project);
}

export function touchProject(project: SceneProject): SceneProject {
  return { ...project, updatedAt: new Date().toISOString() };
}
