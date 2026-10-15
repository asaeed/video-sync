import { useCallback, useMemo, useState } from "react";
import { cloneProject, touchProject } from "./model";
import type { SceneProject } from "./types";

function describeChange(before: SceneProject, after: SceneProject): string {
  if (before.name !== after.name) return "Rename scene";
  if (before.previewBpm !== after.previewBpm) return "Change preview BPM";
  if (before.sources.length !== after.sources.length) return after.sources.length > before.sources.length ? "Import source" : "Remove source";
  if (before.clips.length !== after.clips.length) return after.clips.length > before.clips.length ? "Create clip" : "Delete clip";
  for (const clip of after.clips) {
    const previous = before.clips.find((item) => item.id === clip.id);
    if (!previous) continue;
    if (previous.label !== clip.label) return "Rename clip";
    if (previous.inSeconds !== clip.inSeconds || previous.outSeconds !== clip.outSeconds) return "Trim clip";
    if (previous.color !== clip.color) return "Change clip color";
    if (previous.defaultEndBehavior !== clip.defaultEndBehavior) return "Change clip ending";
  }
  if (before.visualLoops.length !== after.visualLoops.length) return after.visualLoops.length > before.visualLoops.length ? "Add video loop" : "Delete video loop";
  if (before.visualLoops.some((loop, index) => loop.id !== after.visualLoops[index].id)) return "Reorder hot cues";
  for (const loop of after.visualLoops) {
    const previous = before.visualLoops.find((item) => item.id === loop.id);
    if (!previous) continue;
    if (previous.name !== loop.name) return "Rename video loop";
    if (previous.events.length !== loop.events.length) return loop.events.length > previous.events.length ? "Add clip instance" : "Delete clip instance";
    if (JSON.stringify(previous.length) !== JSON.stringify(loop.length)) return "Change loop length";
    for (const event of loop.events) {
      const old = previous.events.find((item) => item.id === event.id);
      if (!old) continue;
      if (old.clipId !== event.clipId) return "Change instance clip";
      if (old.lane !== event.lane) return "Move instance lane";
      if (JSON.stringify(old.at) !== JSON.stringify(event.at)) return "Move clip instance";
      if (JSON.stringify(old.duration) !== JSON.stringify(event.duration)) return "Resize clip instance";
      if (old.source.offsetSeconds !== event.source.offsetSeconds) return "Change source offset";
      if (old.source.rate !== event.source.rate) return "Change playback speed";
      if (old.source.endBehavior !== event.source.endBehavior) return "Change clip ending";
      const oldMotion = old.appearance.motion;
      const motion = event.appearance.motion;
      if (Boolean(oldMotion) !== Boolean(motion)) return motion ? "Enable zoom & pan" : "Disable zoom & pan";
      if (oldMotion && motion) {
        const oldZoom = Math.round(Math.abs(oldMotion.end.scale - oldMotion.start.scale) * 100);
        const zoom = Math.round(Math.abs(motion.end.scale - motion.start.scale) * 100);
        if (oldZoom !== zoom) return `Zoom ${oldZoom}% → ${zoom}%`;
        if (oldMotion.speed !== motion.speed) return "Change motion speed";
        if (JSON.stringify(oldMotion.start.focus) !== JSON.stringify(motion.start.focus) || JSON.stringify(oldMotion.end.focus) !== JSON.stringify(motion.end.focus)) return "Move pan target";
      }
      if (old.appearance.opacity !== event.appearance.opacity) return "Change opacity";
      if (old.appearance.blendMode !== event.appearance.blendMode) return "Change blend mode";
    }
  }
  if (before.defaultLoopId !== after.defaultLoopId) return "Change default loop";
  return "Edit scene";
}

type History = {
  past: SceneProject[];
  present: SceneProject;
  future: SceneProject[];
};

export function useProjectHistory(initialProject: SceneProject) {
  const [history, setHistory] = useState<History>({ past: [], present: initialProject, future: [] });

  const replace = useCallback((project: SceneProject, clearHistory = true) => {
    setHistory((current) => ({
      past: clearHistory ? [] : [...current.past, current.present],
      present: project,
      future: [],
    }));
  }, []);

  const update = useCallback((mutate: (draft: SceneProject) => void) => {
    setHistory((current) => {
      const draft = cloneProject(current.present);
      mutate(draft);
      return {
        past: [...current.past.slice(-79), current.present],
        present: touchProject(draft),
        future: [],
      };
    });
  }, []);

  const undo = useCallback(() => {
    setHistory((current) => {
      const previous = current.past.at(-1);
      if (!previous) return current;
      return { past: current.past.slice(0, -1), present: previous, future: [current.present, ...current.future] };
    });
  }, []);

  const redo = useCallback(() => {
    setHistory((current) => {
      const next = current.future[0];
      if (!next) return current;
      return { past: [...current.past, current.present], present: next, future: current.future.slice(1) };
    });
  }, []);

  return useMemo(() => ({
    project: history.present,
    update,
    replace,
    undo,
    redo,
    canUndo: history.past.length > 0,
    canRedo: history.future.length > 0,
    undoDescription: history.past.length ? describeChange(history.past[history.past.length - 1], history.present) : "Nothing to undo",
    redoDescription: history.future.length ? describeChange(history.present, history.future[0]) : "Nothing to redo",
  }), [history, update, replace, undo, redo]);
}
