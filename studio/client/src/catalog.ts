import { SCENE_CATALOG } from "../../../poc/scene-catalog.mjs";
import { buildScene } from "../../../poc/scene-registry.mjs";
import { CLIP_COLORS, beatsFromMusical } from "./model";
import { firstAvailableLane } from "./loop-lanes";
import type { LoopEvent, RuntimeScene, SceneProject, VisualLoop } from "./types";

export const STUDIO_SCENES = SCENE_CATALOG.map(({ id, name, availability }) => ({ id, name, availability }));

export const DEFAULT_SCENE_ID = STUDIO_SCENES[0].id;

// Exact durations of the existing Metropolis MP4 extracts (ffprobe). The
// performance catalog rounds them to eight seconds, but clip-range editing
// should not extend beyond the media's final frame.
const METROPOLIS_DURATIONS = [
  7.983333, 8, 7.966667, 7.983333, 7.966667, 8,
  7.966667, 7.966667, 8, 8, 7.966667, 7.966667,
];

export function isStudioScene(id: string): boolean {
  return STUDIO_SCENES.some((scene) => scene.id === id);
}

const assetPath = (relativePath: string) => new URL(relativePath, "http://video-sync.local/poc/scene-registry.mjs").pathname;

export function catalogProject(id: string): SceneProject {
  const definition = SCENE_CATALOG.find((scene) => scene.id === id);
  if (!definition || !isStudioScene(id)) throw new Error(`Unknown Studio scene: ${id}`);
  const scene = definition.availability === "ready" ? buildScene(definition, assetPath) as unknown as RuntimeScene : null;
  const now = new Date().toISOString();
  if (!scene) return {
    projectVersion: 1,
    schemaVersion: 5,
    id: definition.id,
    name: definition.name,
    style: definition.style,
    source: definition.rights,
    ...(definition.sourcePage ? { sourcePage: definition.sourcePage } : {}),
    group: definition.group,
    previewBpm: 100,
    createdAt: now,
    updatedAt: now,
    sources: [],
    clips: [],
    visualLoops: [{ id: "song-default", name: "Default", length: { bars: 4 }, repeat: true, events: [] }],
    defaultLoopId: "song-default",
    advance: { afterSongs: 1 },
  };
  const sources: SceneProject["sources"] = scene.clips.map((clip, index) => ({
    id: `source-${clip.id}`,
    label: clip.label,
    file: clip.src,
    fileName: clip.src.split("/").at(-1) ?? `clip-${index + 1}.mp4`,
    durationSeconds: id === "metropolis-machine" ? METROPOLIS_DURATIONS[index] : clip.durationSeconds,
    ...(scene.sourcePage ? { originUrl: scene.sourcePage } : {}),
  }));
  const clips: SceneProject["clips"] = scene.clips.map((clip, index) => ({
    id: clip.id,
    sourceId: sources[index].id,
    label: clip.label,
    inSeconds: 0,
    outSeconds: sources[index].durationSeconds,
    color: CLIP_COLORS[index % CLIP_COLORS.length],
    defaultEndBehavior: "loop",
    ...(clip.subjectFocus ? { subjectFocus: clip.subjectFocus } : {}),
  }));
  const visualLoops: VisualLoop[] = scene.visualLoops.map((loop) => {
    const events: LoopEvent[] = loop.events.map((event) => {
      return {
        id: event.id,
        clipId: event.clipId,
        at: structuredClone(event.at),
        duration: structuredClone(event.duration),
        source: {
          offsetSeconds: Math.max(0, event.source.startSeconds),
          rate: event.source.rate ?? 1,
          endBehavior: event.source.loop ? "loop" : "hold",
        },
        appearance: structuredClone(event.appearance),
      };
    });
    // Assign overlay accents above their base even though the runtime arrays
    // usually list the base event first.
    for (const event of [...events].sort((left, right) => right.appearance.z - left.appearance.z
      || beatsFromMusical(left.at) - beatsFromMusical(right.at))) {
      const placed = events.filter((candidate) => candidate.lane !== undefined);
      event.lane = firstAvailableLane(placed, beatsFromMusical(event.at), beatsFromMusical(event.duration));
    }
    return {
      id: loop.id,
      name: loop.name,
      length: structuredClone(loop.length),
      repeat: true,
      events,
    };
  });
  return {
    projectVersion: 1,
    schemaVersion: 5,
    id: scene.id,
    name: scene.name,
    style: scene.style,
    source: scene.source,
    sourcePage: scene.sourcePage,
    group: scene.group,
    previewBpm: 100,
    createdAt: now,
    updatedAt: now,
    sources,
    clips,
    visualLoops,
    defaultLoopId: scene.defaultLoopId,
    randomLoop: structuredClone(scene.randomLoop),
    advance: structuredClone(scene.advance),
  };
}

// Older catalog projects used each loop's media start offset as the source
// clip's in-point. Expand only untouched, one-clip-per-source defaults; keep
// intentionally trimmed clips and each loop's absolute media position intact.
export function migrateLegacyDefaultClipRanges(project: SceneProject): { project: SceneProject; migrated: boolean } {
  if (!isStudioScene(project.id)) return { project, migrated: false };
  const definition = SCENE_CATALOG.find((scene) => scene.id === project.id);
  if (!definition || definition.availability !== "ready") return { project, migrated: false };
  const runtime = buildScene(definition, assetPath) as unknown as RuntimeScene;
  const originalById = new Map(runtime.clips.map((clip) => [clip.id, clip]));
  const expanded = structuredClone(project);
  let migrated = false;
  for (const clip of expanded.clips) {
    const original = originalById.get(clip.id);
    const oldStart = original?.startSeconds ?? 0;
    const source = expanded.sources.find((item) => item.id === clip.sourceId);
    if (!original || oldStart === 0 || !source
      || source.id !== `source-${clip.id}` || source.file !== original.src
      || expanded.clips.filter((item) => item.sourceId === source.id).length !== 1
      || Math.abs(clip.inSeconds - oldStart) > 0.001
      || Math.abs(clip.outSeconds - source.durationSeconds) > 0.001) continue;
    clip.inSeconds = 0;
    for (const loop of expanded.visualLoops) {
      for (const event of loop.events) {
        if (event.clipId === clip.id) event.source.offsetSeconds += oldStart;
      }
    }
    migrated = true;
  }
  return { project: migrated ? expanded : project, migrated };
}
