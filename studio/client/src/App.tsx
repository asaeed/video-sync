import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { exportScenePackage, importScenePackage, listProjects, loadProject, prepareClips, publishProject, saveProject, uploadSource, type PreparedClipMedia, type PreparationProgress } from "./api";
import {
  beatsFromMusical,
  CLIP_COLORS,
  cloneProject,
  compileRuntimeScene,
  CUE_LETTERS,
  duplicateEventAfter,
  makeClip,
  makeEvent,
  makeLoop,
  musicalFromBeats,
  slugify,
  uniqueId,
} from "./model";
import type { LoopEvent, MediaSource, SceneProject, SourceClip, VisualLoop, Workspace } from "./types";
import { useProjectHistory } from "./useProjectHistory";
import { canPlaceWithinLoop, eventPlacement, laneOf, normalizeProjectLanes } from "./loop-lanes";
import { catalogProject, DEFAULT_SCENE_ID, isStudioScene, migrateLegacyDefaultClipRanges, STUDIO_SCENES } from "./catalog";
import { readStudioSession, writeStudioSession, type StudioDraft } from "./session";
import { PanelResizeHandle, useBottomPanelLayout, useThreePanelLayout } from "./panel-layout";
import { VisualEngine } from "../../../poc/engine.mjs";

const clamp = (value: number, minimum: number, maximum: number) => Math.min(maximum, Math.max(minimum, value));
const milliseconds = (value: number) => Math.round(value * 1000) / 1000;
const seconds = (value: number) => `${value.toFixed(2)}s`;
const parseClipTime = (raw: string): number | null => {
  const parts = raw.trim().split(":");
  if (parts.length < 1 || parts.length > 3 || !parts.slice(0, -1).every((part) => /^\d+$/.test(part)) || !/^(?:\d+(?:\.\d*)?|\.\d+)$/.test(parts.at(-1) ?? "")) return null;
  const values = parts.map(Number);
  if (parts.length > 1 && values.at(-1)! >= 60) return null;
  if (parts.length === 3 && values[1] >= 60) return null;
  return parts.length === 3 ? values[0] * 3600 + values[1] * 60 + values[2] : parts.length === 2 ? values[0] * 60 + values[1] : values[0];
};
const SOURCE_WINDOW_SECONDS = 10;
const sourceTimecode = (value: number) => {
  const tenths = Math.round(value * 10);
  const whole = Math.floor(tenths / 10);
  const hours = Math.floor(whole / 3600);
  const minutes = Math.floor((whole % 3600) / 60);
  const remaining = `${String(whole % 60).padStart(2, "0")}.${tenths % 10}`;
  return hours ? `${hours}:${String(minutes).padStart(2, "0")}:${remaining}` : `${minutes}:${remaining}`;
};
const eventStart = (event: LoopEvent) => beatsFromMusical(event.at);
const eventDuration = (event: LoopEvent) => beatsFromMusical(event.duration);

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="field"><span>{label}</span>{children}</label>;
}

function SteppedNumberField({ id, label, value, min, max, inputStep, onChange }: { id: string; label: string; value: number; min: number; max?: number; inputStep: number; onChange: (value: number) => void }) {
  const stepBy = (delta: number) => onChange(clamp(value + delta, min, max ?? Infinity));
  return <div className="field stepped-number-field">
    <label htmlFor={id}><span>{label}</span></label>
    <div className="number-stepper">
      <input id={id} type="number" min={min} max={max} step={inputStep} value={value} onChange={(event) => onChange(Number(event.target.value))} />
      <div className="number-stepper-controls">
        <button type="button" aria-label={`Increase ${label} by 1`} title={`Increase ${label} by 1`} disabled={max !== undefined && value >= max} onClick={() => stepBy(1)}><svg viewBox="0 0 12 12" aria-hidden="true"><path d="m2.5 7.5 3.5-3.5 3.5 3.5" /></svg></button>
        <button type="button" aria-label={`Decrease ${label} by 1`} title={`Decrease ${label} by 1`} disabled={value <= min} onClick={() => stepBy(-1)}><svg viewBox="0 0 12 12" aria-hidden="true"><path d="m2.5 4.5 3.5 3.5 3.5-3.5" /></svg></button>
      </div>
    </div>
  </div>;
}

function IconButton({ title, children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return <button className="icon-button" title={title} aria-label={title} {...props}>{children}</button>;
}

const shortcutTargetIsEditable = (target: EventTarget | null) =>
  target instanceof Element && Boolean(target.closest("input, textarea, select, [contenteditable], [role='textbox']"));

function useSpaceTransportShortcut(enabled: boolean, toggle: () => void) {
  const toggleRef = useRef(toggle);
  toggleRef.current = toggle;
  useEffect(() => {
    if (!enabled) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.code !== "Space" && event.key !== " ") return;
      if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
      if (shortcutTargetIsEditable(event.target) || document.querySelector("dialog[open]")) return;
      event.preventDefault();
      event.stopPropagation();
      if (!event.repeat) toggleRef.current();
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [enabled]);
}

function HistoryControls({ canUndo, canRedo, undoDescription, redoDescription, onUndo, onRedo }: {
  canUndo: boolean;
  canRedo: boolean;
  undoDescription: string;
  redoDescription: string;
  onUndo: () => void;
  onRedo: () => void;
}) {
  return <div className="history-toolbar" aria-label="Edit history">
    <button type="button" className="history-button" aria-label={`Undo: ${undoDescription}`} title={`Undo: ${undoDescription}`} disabled={!canUndo} onClick={onUndo}>
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M9 14 4 9l5-5M4 9h10a6 6 0 1 1 0 12h-3" /></svg><span><strong>Undo</strong><small>{undoDescription}</small></span>
    </button>
    <button type="button" className="history-button" aria-label={`Redo: ${redoDescription}`} title={`Redo: ${redoDescription}`} disabled={!canRedo} onClick={onRedo}>
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m15 14 5-5-5-5m5 5H10a6 6 0 1 0 0 12h3" /></svg><span><strong>Redo</strong><small>{redoDescription}</small></span>
    </button>
  </div>;
}

function SceneChooser({ currentId, currentName, savedProjects, onSelect, onClose }: {
  currentId: string;
  currentName: string;
  savedProjects: Array<{ id: string; name: string; updatedAt: string }>;
  onSelect: (id: string) => void;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [query, setQuery] = useState("");
  useEffect(() => {
    dialog.current?.showModal();
    return () => dialog.current?.close();
  }, []);
  const scenes = [
    ...STUDIO_SCENES.map((scene) => ({ id: scene.id, name: scene.id === currentId ? currentName : savedProjects.find((saved) => saved.id === scene.id)?.name ?? scene.name, saved: savedProjects.some((saved) => saved.id === scene.id), availability: scene.availability })),
    ...savedProjects.filter((saved) => !isStudioScene(saved.id)).map((saved) => ({ id: saved.id, name: saved.id === currentId ? currentName : saved.name, saved: true, availability: "saved" })),
  ].filter((scene) => scene.name.toLowerCase().includes(query.trim().toLowerCase()));
  return <dialog ref={dialog} className="scene-dialog" aria-labelledby="scene-dialog-title" onClose={onClose} onCancel={onClose} onKeyDown={(event) => { if (event.key === "Escape") { event.preventDefault(); onClose(); } }}>
    <div className="scene-dialog-heading"><div><span className="eyebrow">Scene Studio</span><h2 id="scene-dialog-title">Select scene</h2></div><IconButton title="Close scene picker" onClick={onClose}>×</IconButton></div>
    <input autoFocus type="search" aria-label="Search scenes" placeholder="Search scenes…" value={query} onChange={(event) => setQuery(event.target.value)} />
    <div className="scene-dialog-list">{scenes.map((scene) => <button key={scene.id} type="button" data-scene-id={scene.id} className={scene.id === currentId ? "selected" : ""} onClick={() => onSelect(scene.id)}><strong>{scene.name}</strong><small>{scene.id === currentId ? "Current scene" : scene.saved ? "Saved scene" : scene.availability === "source-needed" ? "Needs source video · editable starter" : "12 video clips · 8 loops"}</small></button>)}{scenes.length === 0 && <p className="empty">No matching scenes.</p>}</div>
  </dialog>;
}

function PreparationModal({ progress, onDismiss }: { progress: PreparationProgress; onDismiss: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    dialog.current?.showModal();
    return () => { if (dialog.current?.open) dialog.current.close(); };
  }, []);
  const checking = progress.reused === undefined;
  const percent = checking ? 0 : progress.total > 0 ? Math.round(progress.completed / progress.total * 100) : 100;
  return <dialog ref={dialog} className="preparation-dialog" aria-labelledby="preparation-title" onCancel={(event) => { event.preventDefault(); onDismiss(); }}>
    <span className="eyebrow">Scene Studio · Loop Builder</span>
    <h2 id="preparation-title">Preparing clips</h2>
    <p>Only new or edited cuts are rendered. Unchanged clips are reused, and source videos stay untouched.</p>
    <div className="preparation-progress-label"><strong>{checking ? "Checking existing clips…" : progress.total === 0 ? "No new cuts needed" : `${progress.completed} of ${progress.total} new or changed cuts`}</strong><span>{checking ? "" : `${percent}%`}</span></div>
    <div className="preparation-progress" role="progressbar" aria-label="Clip preparation" aria-valuemin={0} aria-valuemax={Math.max(progress.total, 1)} aria-valuenow={progress.total === 0 && !checking ? 1 : progress.completed}><span style={{ width: `${percent}%` }} /></div>
    <div className="preparation-current" aria-live="polite">{checking ? "Comparing clips with prepared media…" : `${progress.reused} already prepared${progress.current ? ` · Cutting ${progress.current}` : progress.total > 0 ? " · Finalizing…" : ""}`}</div>
    <button type="button" onClick={onDismiss}>Continue in background</button>
  </dialog>;
}

type ClipConfirmation = { title: string; message: string; confirmLabel: string; destructive?: boolean; approve: () => void };

function ClipConfirmationModal({ confirmation, onCancel, onApprove }: { confirmation: ClipConfirmation; onCancel: () => void; onApprove: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    dialog.current?.showModal();
    return () => { if (dialog.current?.open) dialog.current.close(); };
  }, []);
  return <dialog ref={dialog} className="clip-confirmation-dialog" aria-labelledby="clip-confirmation-title" onCancel={(event) => { event.preventDefault(); onCancel(); }}>
    <span className="eyebrow">Sources & Clips</span>
    <h2 id="clip-confirmation-title">{confirmation.title}</h2>
    <p>{confirmation.message}</p>
    <div className="clip-confirmation-actions"><button type="button" autoFocus onClick={onCancel}>Cancel</button><button type="button" className={confirmation.destructive ? "danger" : "primary"} onClick={onApprove}>{confirmation.confirmLabel}</button></div>
  </dialog>;
}

function ClipTimeInput({ label, value, min, max, onCommit, onSet }: { label: string; value: number; min: number; max: number; onCommit: (value: number) => void; onSet: () => void }) {
  const [draft, setDraft] = useState(value.toFixed(3));
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const skipBlur = useRef(false);
  useEffect(() => { if (!editing && !error) setDraft(value.toFixed(3)); }, [value, editing, error]);
  const commit = (raw: string) => {
    const parsed = parseClipTime(raw);
    if (parsed === null) setError("Enter seconds or a timecode like 1:05:47.000.");
    else if (parsed < min || parsed > max) setError(`${label} must be between ${min.toFixed(3)} and ${max.toFixed(3)} seconds.`);
    else { setError(null); onCommit(milliseconds(parsed)); }
    setEditing(false);
  };
  return <div className="field clip-time-field"><span>{label}</span><div className="clip-time-control"><input aria-label={label} aria-invalid={Boolean(error)} aria-describedby={error ? `clip-${label.toLowerCase()}-error` : undefined} type="text" inputMode="decimal" value={draft} onFocus={() => { setEditing(true); setError(null); }} onChange={(event) => setDraft(event.target.value)} onBlur={() => { if (skipBlur.current) { skipBlur.current = false; return; } commit(draft); }} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); skipBlur.current = true; commit(event.currentTarget.value); event.currentTarget.blur(); } if (event.key === "Escape") { skipBlur.current = true; setDraft(value.toFixed(3)); setError(null); setEditing(false); event.currentTarget.blur(); } }} /><button type="button" aria-label={`Set ${label.toLowerCase()}`} title={`Set ${label.toLowerCase()} at playhead`} onClick={() => { setError(null); onSet(); }}>Set</button></div>{error && <small id={`clip-${label.toLowerCase()}-error`} className="clip-time-error" role="alert">{error}</small>}</div>;
}

function readVideoMetadata(file: File): Promise<Pick<MediaSource, "durationSeconds" | "width" | "height">> {
  return new Promise((resolve, reject) => {
    const video = document.createElement("video");
    const url = URL.createObjectURL(file);
    video.preload = "metadata";
    video.onloadedmetadata = () => {
      resolve({ durationSeconds: video.duration, width: video.videoWidth, height: video.videoHeight });
      URL.revokeObjectURL(url);
    };
    video.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("The selected file could not be read as video"));
    };
    video.src = url;
  });
}

function SourceTimeline({
  source,
  clips,
  selectedClipId,
  playhead,
  pendingClipStart,
  jumpRequest,
  onSeek,
  onSelect,
  onSelectAt,
  onChange,
  onConfirmRangeEdit,
  onDragStart,
  onDragEnd,
}: {
  source: MediaSource;
  clips: SourceClip[];
  selectedClipId: string | null;
  playhead: number;
  pendingClipStart: number | null;
  jumpRequest: { sourceId: string; id: number; time: number } | null;
  onSeek: (time: number) => void;
  onSelect: (id: string) => void;
  onSelectAt: (id: string, time: number) => void;
  onChange: (id: string, input: Partial<SourceClip>) => void;
  onConfirmRangeEdit: (id: string, onApproved: () => void) => boolean;
  onDragStart: () => void;
  onDragEnd: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const overviewRef = useRef<HTMLDivElement>(null);
  const duration = Math.max(0.1, source.durationSeconds);
  const windowDuration = Math.min(SOURCE_WINDOW_SECONDS, duration);
  const [pinnedWindowStart, setPinnedWindowStart] = useState<number | null>(null);
  const [previewTime, setPreviewTime] = useState<number | null>(null);
  const [animatedWindowStart, setAnimatedWindowStart] = useState<number | null>(null);
  const jumpFrameRef = useRef<number | null>(null);
  const handledJumpIdRef = useRef(jumpRequest?.id ?? 0);
  const playheadRef = useRef(playhead);
  playheadRef.current = playhead;
  const followWindowStart = clamp(playhead - windowDuration * 0.5, 0, duration - windowDuration);
  const previewWindowStart = previewTime === null ? null : clamp(previewTime - windowDuration * 0.5, 0, duration - windowDuration);
  const windowStart = pinnedWindowStart ?? previewWindowStart ?? animatedWindowStart ?? followWindowStart;
  const windowEnd = windowStart + windowDuration;
  const tickStep = windowDuration <= 2 ? 0.5 : windowDuration <= 5 ? 1 : 2;
  const ticks = Array.from({ length: Math.ceil(windowDuration / tickStep) + 2 }, (_, index) => (Math.ceil(windowStart / tickStep) + index) * tickStep)
    .filter((time) => time <= windowEnd + 0.001 && time <= duration + 0.001);
  const timeFromPointer = (clientX: number) => {
    const rect = ref.current!.getBoundingClientRect();
    return milliseconds(clamp(windowStart + ((clientX - rect.left) / rect.width) * windowDuration, 0, duration));
  };
  const timeFromOverview = (clientX: number) => {
    const rect = overviewRef.current!.getBoundingClientRect();
    return milliseconds(clamp(((clientX - rect.left) / rect.width) * duration, 0, duration));
  };
  const pendingStart = pendingClipStart === null ? null : Math.min(pendingClipStart, playhead);
  const pendingEnd = pendingClipStart === null ? null : Math.max(pendingClipStart, playhead);
  const stopWindowAnimation = () => {
    if (jumpFrameRef.current !== null) cancelAnimationFrame(jumpFrameRef.current);
    jumpFrameRef.current = null;
    setAnimatedWindowStart(null);
  };
  useEffect(() => () => {
    if (jumpFrameRef.current !== null) cancelAnimationFrame(jumpFrameRef.current);
  }, []);
  const animateMicroSeek = (time: number) => {
    if (jumpFrameRef.current !== null) cancelAnimationFrame(jumpFrameRef.current);
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setAnimatedWindowStart(null);
      onSeek(time);
      return;
    }
    const from = windowStart;
    const oldPlayhead = playhead;
    const started = performance.now();
    setAnimatedWindowStart(from);
    onSeek(time);
    const animate = (now: number) => {
      const progress = Math.min(1, (now - started) / 190);
      const eased = 1 - (1 - progress) ** 3;
      const targetTime = playheadRef.current === oldPlayhead ? time : playheadRef.current;
      const target = clamp(targetTime - windowDuration * 0.5, 0, duration - windowDuration);
      setAnimatedWindowStart(from + (target - from) * eased);
      if (progress < 1) jumpFrameRef.current = requestAnimationFrame(animate);
      else {
        jumpFrameRef.current = null;
        setAnimatedWindowStart(null);
      }
    };
    jumpFrameRef.current = requestAnimationFrame(animate);
  };
  useEffect(() => {
    if (!jumpRequest || jumpRequest.sourceId !== source.id || jumpRequest.id === handledJumpIdRef.current) return;
    handledJumpIdRef.current = jumpRequest.id;
    animateMicroSeek(jumpRequest.time);
  }, [jumpRequest, source.id]);
  const scrubOverview = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    const startX = event.clientX;
    let moved = false;
    const move = (moveEvent: PointerEvent) => {
      if (!moved && Math.abs(moveEvent.clientX - startX) < 4) return;
      if (!moved) {
        moved = true;
        stopWindowAnimation();
        onDragStart();
      }
      setPreviewTime(timeFromOverview(moveEvent.clientX));
    };
    const up = (upEvent: PointerEvent) => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
      if (moved) {
        setPreviewTime(null);
        if (upEvent.type !== "pointercancel") onSeek(timeFromOverview(upEvent.clientX));
        onDragEnd();
      } else if (upEvent.type !== "pointercancel") onSeek(timeFromOverview(startX));
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up, { once: true });
    window.addEventListener("pointercancel", up, { once: true });
  };
  const drag = (event: React.PointerEvent, clip: SourceClip, mode: "move" | "in" | "out") => {
    event.preventDefault();
    event.stopPropagation();
    onSelect(clip.id);
    setPinnedWindowStart(windowStart);
    stopWindowAnimation();
    const startX = event.clientX;
    let moved = false;
    let blocked = false;
    let deferred: Partial<SourceClip> | null = null;
    const original = { inSeconds: clip.inSeconds, outSeconds: clip.outSeconds };
    const pixels = ref.current!.getBoundingClientRect().width;
    const candidateAt = (clientX: number): Partial<SourceClip> => {
      const delta = ((clientX - startX) / pixels) * windowDuration;
      if (mode === "move") {
        const length = original.outSeconds - original.inSeconds;
        const nextIn = milliseconds(clamp(original.inSeconds + delta, 0, duration - length));
        return { inSeconds: nextIn, outSeconds: milliseconds(nextIn + length) };
      }
      if (mode === "in") return { inSeconds: milliseconds(clamp(original.inSeconds + delta, 0, original.outSeconds - 0.08)) };
      return { outSeconds: milliseconds(clamp(original.outSeconds + delta, original.inSeconds + 0.08, duration)) };
    };
    const move = (moveEvent: PointerEvent) => {
      if (!moved && Math.abs(moveEvent.clientX - startX) < 4) return;
      const candidate = candidateAt(moveEvent.clientX);
      if (!blocked && !moved && Object.entries(candidate).every(([key, value]) => original[key as keyof typeof original] === value)) return;
      if (blocked) { deferred = candidate; return; }
      if (!moved) {
        deferred = candidate;
        if (!onConfirmRangeEdit(clip.id, () => { if (deferred) onChange(clip.id, deferred); })) { blocked = true; return; }
        moved = true;
        stopWindowAnimation();
        onDragStart();
      }
      onChange(clip.id, candidate);
    };
    const up = (upEvent: PointerEvent) => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
      setPinnedWindowStart(null);
      if (blocked && upEvent.type !== "pointercancel") deferred = candidateAt(upEvent.clientX);
      if (moved) onDragEnd();
      if (mode === "move" && !moved && !blocked && upEvent.type !== "pointercancel") onSelectAt(clip.id, clip.inSeconds);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up, { once: true });
    window.addEventListener("pointercancel", up, { once: true });
  };
  const scrubOrPan = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.target !== event.currentTarget) return;
    event.preventDefault();
    const startX = event.clientX;
    const startTime = playhead;
    const width = ref.current!.getBoundingClientRect().width;
    let moved = false;
    const move = (moveEvent: PointerEvent) => {
      if (!moved && Math.abs(moveEvent.clientX - startX) < 4) return;
      if (!moved) {
        moved = true;
        onDragStart();
      }
      onSeek(milliseconds(clamp(startTime - (moveEvent.clientX - startX) / width * windowDuration, 0, duration)));
    };
    const up = (upEvent: PointerEvent) => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
      if (moved) onDragEnd();
      if (!moved && upEvent.type !== "pointercancel") animateMicroSeek(timeFromPointer(startX));
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up, { once: true });
    window.addEventListener("pointercancel", up, { once: true });
  };

  return (
    <div className="source-timeline-wrap">
      <div className="source-overview-labels"><span>Full source</span><span>{sourceTimecode(duration)}</span></div>
      <div
        ref={overviewRef}
        className="source-overview"
        data-testid="source-overview"
        role="slider"
        tabIndex={0}
        aria-label="Full source timeline"
        aria-valuemin={0}
        aria-valuemax={duration}
        aria-valuenow={previewTime ?? playhead}
        aria-valuetext={sourceTimecode(previewTime ?? playhead)}
        onPointerDown={scrubOverview}
      >
        <div className="source-overview-window" style={{ left: `${windowStart / duration * 100}%`, width: `${windowDuration / duration * 100}%` }} />
        {pendingStart !== null && pendingEnd !== null && <div className="source-overview-pending" style={{ left: `${pendingStart / duration * 100}%`, width: `${(pendingEnd - pendingStart) / duration * 100}%` }} />}
        {clips.map((clip) => <div key={clip.id} className={`source-overview-clip ${selectedClipId === clip.id ? "selected" : ""}`} data-clip-id={clip.id} style={{ left: `${clip.inSeconds / duration * 100}%`, width: `${(clip.outSeconds - clip.inSeconds) / duration * 100}%`, background: clip.color }} />)}
        {pendingClipStart !== null && <div className="source-overview-anchor" style={{ left: `${pendingClipStart / duration * 100}%` }} />}
        {previewTime !== null && <div className="source-overview-preview" style={{ left: `${previewTime / duration * 100}%` }} />}
        <div className="source-overview-playhead" style={{ left: `${playhead / duration * 100}%` }} />
      </div>
      <div className="time-ruler">
        {ticks.map((time) => <span key={time} className={time >= windowEnd - 0.001 ? "end" : ""} style={{ left: `${(time - windowStart) / windowDuration * 100}%` }}>{sourceTimecode(time)}</span>)}
      </div>
      <div
        className="source-timeline"
        ref={ref}
        data-testid="source-timeline"
        data-window-start={windowStart.toFixed(3)}
        data-window-end={windowEnd.toFixed(3)}
        data-window-animating={animatedWindowStart !== null}
        data-window-previewing={previewTime !== null}
        onPointerDown={scrubOrPan}
      >
        {ticks.map((time) => <i key={time} className="source-time-line" style={{ left: `${(time - windowStart) / windowDuration * 100}%` }} />)}
        {pendingStart !== null && pendingEnd !== null && pendingEnd > windowStart && pendingStart < windowEnd && <div className="source-pending-range" style={{ left: `${(Math.max(pendingStart, windowStart) - windowStart) / windowDuration * 100}%`, width: `${(Math.min(pendingEnd, windowEnd) - Math.max(pendingStart, windowStart)) / windowDuration * 100}%` }} />}
        {clips.filter((clip) => clip.outSeconds > windowStart && clip.inSeconds < windowEnd).map((clip) => (
          <button
            key={clip.id}
            data-clip-id={clip.id}
            className={`clip-range ${selectedClipId === clip.id ? "selected" : ""}`}
            style={{ left: `${(Math.max(clip.inSeconds, windowStart) - windowStart) / windowDuration * 100}%`, width: `${(Math.min(clip.outSeconds, windowEnd) - Math.max(clip.inSeconds, windowStart)) / windowDuration * 100}%`, background: clip.color }}
            onPointerDown={(event) => drag(event, clip, "move")}
            onClick={(event) => { if (event.detail === 0) onSelectAt(clip.id, clip.inSeconds); }}
            title={`${clip.label}: ${seconds(clip.inSeconds)}–${seconds(clip.outSeconds)}`}
          >
            {clip.inSeconds >= windowStart && <span className="range-handle left" onPointerDown={(event) => drag(event, clip, "in")} />}
            <span className="range-label">{clip.label}</span>
            {clip.outSeconds <= windowEnd && <span className="range-handle right" onPointerDown={(event) => drag(event, clip, "out")} />}
          </button>
        ))}
        {pendingClipStart !== null && pendingClipStart >= windowStart && pendingClipStart <= windowEnd && <div className="source-pending-anchor" style={{ left: `${(pendingClipStart - windowStart) / windowDuration * 100}%` }} />}
        <div className={`source-playhead${previewTime !== null ? " preview" : ""}`} style={{ left: `${((previewTime ?? playhead) - windowStart) / windowDuration * 100}%` }} />
      </div>
    </div>
  );
}

function SourcesWorkspace({
  project,
  update,
  selectedSourceId,
  setSelectedSourceId,
  selectedClipId,
  setSelectedClipId,
  sourceMuted,
  setSourceMuted,
  auditionLoop,
  setAuditionLoop,
  sourcePlayheads,
  onPlayheadChange,
  onImport,
}: {
  project: SceneProject;
  update: (mutate: (draft: SceneProject) => void) => void;
  selectedSourceId: string | null;
  setSelectedSourceId: (id: string) => void;
  selectedClipId: string | null;
  setSelectedClipId: (id: string | null) => void;
  sourceMuted: boolean;
  setSourceMuted: (value: boolean) => void;
  auditionLoop: boolean;
  setAuditionLoop: (value: boolean) => void;
  sourcePlayheads: Record<string, number>;
  onPlayheadChange: (sourceId: string, time: number) => void;
  onImport: (file: File) => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [playhead, setPlayhead] = useState(0);
  const loopPlaybackKeyRef = useRef("");
  const [loopClipId, setLoopClipId] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);
  const [videoLoading, setVideoLoading] = useState(false);
  const loadingTimerRef = useRef<number | null>(null);
  const resumeAfterTimelineDrag = useRef(false);
  const jumpIdRef = useRef(0);
  const [jumpRequest, setJumpRequest] = useState<{ sourceId: string; id: number; time: number } | null>(null);
  const [pendingClipStart, setPendingClipStart] = useState<number | null>(null);
  const [markHint, setMarkHint] = useState("");
  const [clipConfirmation, setClipConfirmation] = useState<ClipConfirmation | null>(null);
  const columns = useThreePanelLayout();
  const vertical = useBottomPanelLayout("sources");
  const source = project.sources.find((candidate) => candidate.id === selectedSourceId) ?? project.sources[0];
  const clips = project.clips.filter((clip) => clip.sourceId === source?.id);
  const selectedClip = clips.find((clip) => clip.id === selectedClipId) ?? null;
  const loopClip = clips.find((clip) => clip.id === loopClipId);
  const updatePlayhead = (time: number) => {
    setPlayhead(time);
    if (source) onPlayheadChange(source.id, time);
  };
  const approvedRangeEdits = useRef(new Set<string>());
  useEffect(() => { approvedRangeEdits.current.clear(); }, [project.id]);
  const loopUses = (id: string) => project.visualLoops.filter((loop) => loop.events.some((event) => event.clipId === id));
  const confirmRangeEdit = (id: string, onApproved: () => void) => {
    const usedBy = loopUses(id);
    if (!usedBy.length || approvedRangeEdits.current.has(id)) return true;
    const clip = project.clips.find((item) => item.id === id);
    setClipConfirmation({
      title: "Change clip cut?",
      message: `“${clip?.label ?? id}” is used in ${usedBy.length} video loop${usedBy.length === 1 ? "" : "s"}. Changing its in or out point will re-cut this clip and may change those loops when you next open Loop Builder. Unchanged clips will be reused.`,
      confirmLabel: "Change cut",
      approve: () => { approvedRangeEdits.current.add(id); onApproved(); },
    });
    return false;
  };

  const showVideoLoading = () => {
    if (loadingTimerRef.current !== null || videoLoading) return;
    loadingTimerRef.current = window.setTimeout(() => {
      loadingTimerRef.current = null;
      setVideoLoading(true);
    }, 150);
  };
  const clearVideoLoading = () => {
    if (loadingTimerRef.current !== null) window.clearTimeout(loadingTimerRef.current);
    loadingTimerRef.current = null;
    setVideoLoading(false);
  };

  useEffect(() => () => {
    if (loadingTimerRef.current !== null) window.clearTimeout(loadingTimerRef.current);
  }, []);

  useEffect(() => {
    setPendingClipStart(null);
    setMarkHint("");
  }, [project.id, source?.id]);

  useEffect(() => {
    setPlaying(false);
    if (loadingTimerRef.current !== null) window.clearTimeout(loadingTimerRef.current);
    loadingTimerRef.current = null;
    setVideoLoading(false);
    const firstClip = project.clips.find((clip) => clip.sourceId === source?.id);
    setLoopClipId(selectedClip?.id ?? firstClip?.id ?? null);
    const remembered = source ? sourcePlayheads[source.id] : undefined;
    const inPoint = source && Number.isFinite(remembered) ? clamp(remembered!, 0, source.durationSeconds) : firstClip?.inSeconds ?? 0;
    updatePlayhead(inPoint);
    if (videoRef.current) {
      videoRef.current.pause();
      videoRef.current.currentTime = inPoint;
    }
  }, [project.id, source?.id]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    let frame = 0;
    const paint = () => {
      updatePlayhead(video.currentTime);
      if (!video.paused && !video.ended) frame = requestAnimationFrame(paint);
    };
    const start = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(paint);
    };
    const stop = () => {
      cancelAnimationFrame(frame);
      updatePlayhead(video.currentTime);
    };
    const sync = () => updatePlayhead(video.currentTime);
    video.addEventListener("play", start);
    video.addEventListener("pause", stop);
    video.addEventListener("seeked", sync);
    if (!video.paused) start();
    return () => {
      cancelAnimationFrame(frame);
      video.removeEventListener("play", start);
      video.removeEventListener("pause", stop);
      video.removeEventListener("seeked", sync);
    };
  }, [source?.id]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !auditionLoop || !loopClip || loopClip.sourceId !== source?.id) {
      if (!auditionLoop) loopPlaybackKeyRef.current = "";
      return;
    }
    const playbackKey = `${source?.id}:${loopClip.id}`;
    const startOnSelection = loopPlaybackKeyRef.current !== "" && loopPlaybackKeyRef.current !== playbackKey;
    loopPlaybackKeyRef.current = playbackKey;
    let frame = 0;
    let previousTime = video.currentTime;
    const keepInsideRange = () => {
      if (video.paused) return;
      if (previousTime < loopClip.outSeconds - 0.02 && video.currentTime >= loopClip.outSeconds - 0.02) {
        video.currentTime = loopClip.inSeconds;
      }
      previousTime = video.currentTime;
      frame = requestAnimationFrame(keepInsideRange);
    };
    const start = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(keepInsideRange);
    };
    video.addEventListener("play", start);
    if (video.paused && startOnSelection) void video.play();
    else start();
    return () => {
      cancelAnimationFrame(frame);
      video.removeEventListener("play", start);
    };
  }, [auditionLoop, loopClip?.id, loopClip?.inSeconds, loopClip?.outSeconds, source?.id]);

  const changeClip = (id: string, input: Partial<SourceClip>) => {
    const existing = project.clips.find((candidate) => candidate.id === id);
    if (!existing || Object.entries(input).every(([key, value]) => existing[key as keyof SourceClip] === value)) return;
    const apply = () => update((draft) => {
      const clip = draft.clips.find((candidate) => candidate.id === id);
      if (clip) Object.assign(clip, input);
    });
    const rangeChanged = (input.inSeconds !== undefined && input.inSeconds !== existing.inSeconds) || (input.outSeconds !== undefined && input.outSeconds !== existing.outSeconds);
    if (rangeChanged && !confirmRangeEdit(id, apply)) return;
    apply();
  };
  const deleteClip = (clip: SourceClip) => {
    const uses = loopUses(clip.id);
    const instances = uses.reduce((count, loop) => count + loop.events.filter((event) => event.clipId === clip.id).length, 0);
    const remove = () => {
      update((draft) => {
        draft.clips = draft.clips.filter((item) => item.id !== clip.id);
        for (const loop of draft.visualLoops) loop.events = loop.events.filter((event) => event.clipId !== clip.id);
      });
      setSelectedClipId(null);
    };
    if (!instances) { remove(); return; }
    setClipConfirmation({
      title: "Delete clip and loop instances?",
      message: `“${clip.label}” is used in ${uses.length} video loop${uses.length === 1 ? "" : "s"}. Deleting it also removes ${instances} timeline instance${instances === 1 ? "" : "s"}. The original source video will remain.`,
      confirmLabel: "Delete clip",
      destructive: true,
      approve: remove,
    });
  };
  const markClipBoundary = () => {
    if (!source) return;
    const at = milliseconds(clamp(videoRef.current?.currentTime ?? playhead, 0, source.durationSeconds));
    if (pendingClipStart === null) {
      setPendingClipStart(at);
      setMarkHint("");
      return;
    }
    if (at === pendingClipStart) {
      setPendingClipStart(null);
      setMarkHint("");
      return;
    }
    const start = Math.min(pendingClipStart, at);
    const end = Math.max(pendingClipStart, at);
    if (end - start < 0.08) {
      setMarkHint("Choose the other edge at least 0.08s away.");
      return;
    }
    const clip = makeClip(project, source.id, start, end);
    update((draft) => draft.clips.push(clip));
    setSelectedClipId(clip.id);
    if (auditionLoop) setLoopClipId(clip.id);
    setPendingClipStart(null);
    setMarkHint("");
  };
  const seek = (time: number) => {
    updatePlayhead(time);
    if (videoRef.current) videoRef.current.currentTime = time;
  };
  const seekSource = (time: number) => {
    setSelectedClipId(null);
    setLoopClipId(null);
    loopPlaybackKeyRef.current = "";
    setAuditionLoop(false);
    seek(time);
  };
  const startTimelineDrag = () => {
    const video = videoRef.current;
    resumeAfterTimelineDrag.current = Boolean(video && !video.paused);
    video?.pause();
  };
  const endTimelineDrag = () => {
    if (resumeAfterTimelineDrag.current) void videoRef.current?.play();
    resumeAfterTimelineDrag.current = false;
  };
  const jumpSource = (seconds: number) => {
    if (!source) return;
    const currentTime = videoRef.current?.currentTime;
    setJumpRequest({ sourceId: source.id, id: ++jumpIdRef.current, time: clamp((Number.isFinite(currentTime) ? currentTime! : 0) + seconds, 0, source.durationSeconds) });
  };
  useEffect(() => {
    if (!source) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
      if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
      if (shortcutTargetIsEditable(event.target)) return;
      if (event.target instanceof Element && event.target.closest("[role='separator']")) return;
      if (document.querySelector("dialog[open]")) return;
      event.preventDefault();
      event.stopPropagation();
      jumpSource(event.key === "ArrowRight" ? SOURCE_WINDOW_SECONDS : -SOURCE_WINDOW_SECONDS);
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [source?.id, source?.durationSeconds]);
  const selectClipAt = (id: string, time: number) => {
    setSelectedClipId(id);
    setLoopClipId(id);
    setAuditionLoop(true);
    seek(time);
    void videoRef.current?.play();
  };
  const togglePlayback = () => {
    const video = videoRef.current;
    if (!video) return;
    if (!video.paused) {
      video.pause();
      return;
    }
    if (auditionLoop && loopClip && (video.currentTime < loopClip.inSeconds || video.currentTime >= loopClip.outSeconds - 0.02)) seek(loopClip.inSeconds);
    void video.play();
  };
  useSpaceTransportShortcut(Boolean(source), togglePlayback);
  const toggleAudition = () => {
    const video = videoRef.current;
    if (!video) return;
    if (auditionLoop) {
      loopPlaybackKeyRef.current = "";
      setAuditionLoop(false);
      setLoopClipId(null);
      return;
    }
    if (!selectedClip || selectedClip.sourceId !== source?.id) return;
    setLoopClipId(selectedClip.id);
    setAuditionLoop(true);
  };

  return (
    <div ref={columns.ref} className="workspace-grid sources-workspace resizable-workspace" style={columns.style}>
      <aside className="panel source-list">
        <div className="panel-heading"><div><span className="eyebrow">Media</span><h2>Sources</h2></div><label className="button compact">＋ Import<input type="file" accept="video/*" hidden onChange={(event) => event.target.files?.[0] && onImport(event.target.files[0])} /></label></div>
        <div className="stack-list">
          {project.sources.map((item) => {
            const clipCount = project.clips.filter((clip) => clip.sourceId === item.id).length;
            return <button key={item.id} className={`list-card ${source?.id === item.id ? "selected" : ""}`} onClick={() => { setSelectedSourceId(item.id); setSelectedClipId(project.clips.find((clip) => clip.sourceId === item.id)?.id ?? null); }}><strong>{item.label}</strong><span className="source-clip-count">{clipCount} {clipCount === 1 ? "clip" : "clips"}</span><span className="source-duration">{seconds(item.durationSeconds)}{item.width && item.height ? ` · ${item.width}×${item.height}` : ""}</span></button>;
          })}
          {project.sources.length === 0 && <p className="empty">Import a long source video to begin.</p>}
        </div>
        {source?.originUrl && <div className="source-origin"><span>{source.file.startsWith("http") ? "Streaming source · connection required; not included in offline exports." : source.file.startsWith("/api/studio/projects/") ? "Source stored locally in this Studio project." : "These are existing edited extracts; the full film is not stored here."}</span><a href={source.originUrl} target="_blank" rel="noreferrer">{source.file.startsWith("http") || source.file.startsWith("/api/studio/projects/") ? "Source page" : "Original film page"} ↗</a></div>}
      </aside>

      <PanelResizeHandle name="Resize Sources panel" axis="x" value={columns.leftWidth} onChange={columns.setLeft} />
      <main ref={vertical.ref} className="panel source-editor" style={vertical.style}>
        <div className="panel-heading"><div><span className="eyebrow">Sources & Clips</span><h2>{source?.label ?? "No source selected"}</h2></div></div>
        <div className="source-preview">
          {source ? <video
            ref={videoRef}
            src={source.file}
            muted={sourceMuted}
            onClick={togglePlayback}
            onPlay={() => setPlaying(true)}
            onPlaying={clearVideoLoading}
            onPause={(event) => {
              setPlaying(false);
              if (!event.currentTarget.seeking && event.currentTarget.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) clearVideoLoading();
            }}
            onLoadStart={showVideoLoading}
            onSeeking={showVideoLoading}
            onSeeked={(event) => {
              if (event.currentTarget.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) clearVideoLoading();
            }}
            onWaiting={showVideoLoading}
            onStalled={(event) => {
              if (event.currentTarget.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) showVideoLoading();
            }}
            onCanPlay={(event) => {
              if (!event.currentTarget.seeking) clearVideoLoading();
            }}
            onError={clearVideoLoading}
            onEnded={(event) => {
              setPlaying(false);
              if (auditionLoop && loopClip) {
                event.currentTarget.currentTime = loopClip.inSeconds;
                void event.currentTarget.play();
              }
            }}
            onTimeUpdate={(event) => {
              if (event.currentTarget.paused) updatePlayhead(event.currentTarget.currentTime);
            }}
            onLoadedMetadata={(event) => {
              if (source.durationSeconds <= 0 && Number.isFinite(event.currentTarget.duration)) update((draft) => {
                const target = draft.sources.find((candidate) => candidate.id === source.id);
                if (target) target.durationSeconds = event.currentTarget.duration;
              });
            }}
          /> : <div className="empty-preview">Import a video source</div>}
          {source && videoLoading && <div className="source-loading" role="status" aria-label="Video loading"><span className="source-loading-ring" /></div>}
        </div>
        <PanelResizeHandle name="Resize source preview and timelines" axis="y" direction={-1} value={vertical.bottomHeight} onChange={vertical.setBottom} />
        <div className="source-bottom">
        {source && <>
          <div className="transport-row">
            <div className="transport-jumps">
              <button type="button" aria-label="Back 10 seconds" disabled={playhead <= 0} onClick={() => jumpSource(-SOURCE_WINDOW_SECONDS)}>−10s</button>
              <button type="button" aria-label="Forward 10 seconds" disabled={playhead >= source.durationSeconds} onClick={() => jumpSource(SOURCE_WINDOW_SECONDS)}>+10s</button>
            </div>
            <div className="transport-center">
              <button className={`transport-icon ${playing ? "active" : ""}`} aria-label={playing ? "Pause" : "Play"} title={playing ? "Pause" : "Play"} aria-pressed={playing} onClick={togglePlayback}><svg className="playback-glyph" viewBox="0 0 24 24" aria-hidden="true">{playing ? <path d="M6 4h4.5v16H6zM13.5 4H18v16h-4.5z" /> : <path d="M7 4.6c0-.8.9-1.3 1.6-.8l11 7.4c.6.4.6 1.2 0 1.6l-11 7.4c-.7.5-1.6 0-1.6-.8z" />}</svg></button>
              <button className={`transport-icon ${auditionLoop ? "active" : ""}`} aria-label={auditionLoop ? "Stop audition" : "Loop audition"} title={auditionLoop ? "Stop audition" : "Loop audition"} aria-pressed={auditionLoop} disabled={!selectedClip && !auditionLoop} onClick={toggleAudition}><svg className="loop-glyph" viewBox="0 0 24 24" aria-hidden="true"><path className="loop-arc" d="M8.3 4.2a9 9 0 0 1 11.5 11.4" /><path className="loop-arc" d="M15.7 19.8A9 9 0 0 1 4.2 8.4" /><path className="loop-arrowhead" d="M9.4.5v9.4L2.3 5.3z" /><path className="loop-arrowhead" d="M14.6 23.5v-9.4l7.1 4.6z" /></svg></button>
              <button className={`transport-icon ${pendingClipStart !== null ? "active recording" : ""}`} aria-label={pendingClipStart !== null ? "Finish clip" : "Mark new clip"} title={pendingClipStart !== null ? "Finish clip at playhead, or click again without moving to cancel" : "Mark first edge of new clip"} aria-pressed={pendingClipStart !== null} onClick={markClipBoundary}><svg viewBox="0 0 24 24" aria-hidden="true">{pendingClipStart !== null ? <circle cx="12" cy="12" r="7" /> : <path d="M12 4v16M4 12h16" />}</svg></button>
            </div>
            <div className="transport-right">
              {pendingClipStart !== null && <span className="clip-mark-status" role="status">{markHint || `First edge ${sourceTimecode(pendingClipStart)} · seek, then +`}</span>}
              <span className="transport-time" aria-label="Current source time">{sourceTimecode(playhead)}</span>
              <button type="button" className="transport-icon source-mute" aria-label={sourceMuted ? "Unmute source" : "Mute source"} title={sourceMuted ? "Unmute source" : "Mute source"} aria-pressed={sourceMuted} onClick={() => setSourceMuted(!sourceMuted)}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9v6h4l5 4V5L8 9z" />{sourceMuted ? <path d="m17 9 5 6m0-6-5 6" /> : <path d="M17 9a5 5 0 0 1 0 6m3-9a9 9 0 0 1 0 12" />}</svg></button>
            </div>
          </div>
          <SourceTimeline key={source.id} source={source} clips={clips} selectedClipId={selectedClip?.id ?? null} playhead={playhead} pendingClipStart={pendingClipStart} jumpRequest={jumpRequest} onSeek={seekSource} onSelect={setSelectedClipId} onSelectAt={selectClipAt} onChange={changeClip} onConfirmRangeEdit={confirmRangeEdit} onDragStart={startTimelineDrag} onDragEnd={endTimelineDrag} />
        </>}
        </div>
      </main>

      <PanelResizeHandle name="Resize Clip bin and inspector" axis="x" direction={-1} value={columns.rightWidth} onChange={columns.setRight} />
      <aside className="panel inspector">
        <div className="panel-heading"><div><h2>Clip bin</h2></div></div>
        <div className="clip-bin">
          {clips.map((clip) => <button key={clip.id} className={`clip-card ${selectedClipId === clip.id ? "selected" : ""}`} style={{ borderLeftColor: clip.color }} onClick={() => selectClipAt(clip.id, clip.inSeconds)}><strong>{clip.label}</strong><span>{sourceTimecode(clip.inSeconds)} · {(clip.outSeconds - clip.inSeconds).toFixed(2)} sec</span></button>)}
        </div>
        {selectedClip && <div className="inspector-fields">
          <h3>Clip settings</h3>
          <Field label="Name"><input value={selectedClip.label} onChange={(event) => changeClip(selectedClip.id, { label: event.target.value })} /></Field>
          <div className="field-row clip-boundary-row">
            <ClipTimeInput key={`${selectedClip.id}-in`} label="In" value={selectedClip.inSeconds} min={0} max={Math.max(0, selectedClip.outSeconds - 0.001)} onCommit={(value) => changeClip(selectedClip.id, { inSeconds: value })} onSet={() => changeClip(selectedClip.id, { inSeconds: Math.min(videoRef.current?.currentTime ?? playhead, selectedClip.outSeconds - 0.08) })} />
            <ClipTimeInput key={`${selectedClip.id}-out`} label="Out" value={selectedClip.outSeconds} min={selectedClip.inSeconds + 0.001} max={source?.durationSeconds ?? selectedClip.outSeconds} onCommit={(value) => changeClip(selectedClip.id, { outSeconds: value })} onSet={() => changeClip(selectedClip.id, { outSeconds: Math.max(videoRef.current?.currentTime ?? playhead, selectedClip.inSeconds + 0.08) })} />
          </div>
          <Field label="End behavior"><select value={selectedClip.defaultEndBehavior} onChange={(event) => changeClip(selectedClip.id, { defaultEndBehavior: event.target.value as "loop" | "hold" })}><option value="loop">Loop source range</option><option value="hold">Hold last frame</option></select></Field>
          <Field label="Color"><div className="color-row">{CLIP_COLORS.map((color) => <button key={color} aria-label={`Use ${color}`} className={selectedClip.color === color ? "selected" : ""} style={{ background: color }} onClick={() => changeClip(selectedClip.id, { color })} />)}</div></Field>
          <button className="danger" onClick={() => deleteClip(selectedClip)}>Delete clip</button>
        </div>}
      </aside>
      {clipConfirmation && <ClipConfirmationModal confirmation={clipConfirmation} onCancel={() => setClipConfirmation(null)} onApprove={() => { setClipConfirmation(null); clipConfirmation.approve(); }} />}
    </div>
  );
}

function LoopPreview({ project, loop, preparedMedia = {}, selectedEventId, onMotionTargetChange, seekRef, onBeatChange, initialBeat = 0, spaceShortcut = false }: { project: SceneProject; loop: VisualLoop | undefined; preparedMedia?: PreparedClipMedia; selectedEventId?: string | null; onMotionTargetChange?: (focus: { x: number; y: number }) => void; seekRef?: React.MutableRefObject<((beat: number) => void) | null>; onBeatChange?: (beat: number, length: number) => void; initialBeat?: number; spaceShortcut?: boolean }) {
  const length = Math.max(0.25, beatsFromMusical(loop?.length));
  const restoredBeat = Number.isFinite(initialBeat) ? clamp(initialBeat, 0, length - 0.001) : 0;
  const [playing, setPlaying] = useState(false);
  const [videoLoading, setVideoLoading] = useState(false);
  const [beat, setBeat] = useState(restoredBeat);
  const [seekRevision, setSeekRevision] = useState(0);
  const anchor = useRef({ at: performance.now(), beat: restoredBeat });
  const previousBpm = useRef(project.previewBpm);
  const onBeatChangeRef = useRef(onBeatChange);
  onBeatChangeRef.current = onBeatChange;
  const previewRef = useRef<HTMLDivElement>(null);
  const engineRef = useRef<VisualEngine | null>(null);
  const runtimeScene = useMemo(() => {
    const compiled = compileRuntimeScene(project, preparedMedia);
    return loop ? { ...compiled, visualLoops: compiled.visualLoops.filter((item) => item.id === loop.id), defaultLoopId: loop.id } : compiled;
  }, [project, loop?.id, preparedMedia]);
  const sceneRef = useRef(runtimeScene);
  sceneRef.current = runtimeScene;

  useEffect(() => {
    const stage = previewRef.current;
    if (!stage) return;
    let loadingTimer: number | null = null;
    let loadingShown = false;
    const engine = new VisualEngine(stage, (metrics) => {
      if (metrics.mediaPending) {
        if (!loadingShown && loadingTimer === null) loadingTimer = window.setTimeout(() => {
          loadingTimer = null;
          loadingShown = true;
          setVideoLoading(true);
        }, 150);
      } else {
        if (loadingTimer !== null) window.clearTimeout(loadingTimer);
        loadingTimer = null;
        if (loadingShown) {
          loadingShown = false;
          setVideoLoading(false);
        }
      }
    }, () => sceneRef.current);
    engineRef.current = engine;
    return () => {
      if (loadingTimer !== null) window.clearTimeout(loadingTimer);
      engine.destroy();
      engineRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!engineRef.current || !loop) return;
    if (previousBpm.current !== project.previewBpm) {
      const now = performance.now();
      const currentBeat = playing ? (anchor.current.beat + (now - anchor.current.at) / 1000 * previousBpm.current / 60) % length : anchor.current.beat;
      anchor.current = { at: now, beat: currentBeat };
      setBeat(currentBeat);
      previousBpm.current = project.previewBpm;
    }
    const clock = { bpm: project.previewBpm, playing, anchorBeat: anchor.current.beat, anchorEpochMs: performance.timeOrigin + anchor.current.at };
    engineRef.current.applySnapshot({
      linkClock: clock,
      decks: [{
        id: 1, loaded: true, playing, started: true, sceneId: project.id,
        generation: 0, clipOrder: project.clips.map((clip) => clip.id),
        randomLoop: null, activeLoopId: loop.id, loopAnchorBeat: 0, loopGeneration: seekRevision, clock,
      }],
      opacities: [1, 0],
      effects: { beatFx: { selected: "delay", enabled: false, target: "master", depth: 0.5, beatMultiplier: 1 } },
    });
  }, [runtimeScene, project.previewBpm, project.id, project.clips, loop, playing, seekRevision]);

  useEffect(() => {
    if (!playing) return;
    let frame = 0;
    const tick = (now: number) => {
      const position = (anchor.current.beat + (now - anchor.current.at) / 1000 * project.previewBpm / 60) % length;
      setBeat(position);
      onBeatChangeRef.current?.(position, length);
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [playing, project.previewBpm, length]);
  const setTransport = () => {
    if (playing) {
      const now = performance.now();
      const position = (anchor.current.beat + (now - anchor.current.at) / 1000 * project.previewBpm / 60) % length;
      anchor.current = { at: now, beat: position };
      setBeat(position);
      onBeatChangeRef.current?.(position, length);
      setPlaying(false);
    }
    else { anchor.current = { at: performance.now(), beat }; setPlaying(true); }
  };
  useSpaceTransportShortcut(spaceShortcut, setTransport);
  const seekBeat = useCallback((position: number) => {
    const next = clamp(position, 0, Math.max(0, length - 0.001));
    setBeat(next);
    anchor.current = { at: performance.now(), beat: next };
    onBeatChangeRef.current?.(next, length);
    setSeekRevision((revision) => revision + 1);
  }, [length]);
  useEffect(() => {
    if (seekRef) seekRef.current = seekBeat;
    onBeatChangeRef.current?.(anchor.current.beat, length);
    return () => { if (seekRef) seekRef.current = null; };
  }, [seekRef, seekBeat, length]);
  const scrubAt = (clientX: number, element: HTMLDivElement) => {
    const rect = element.getBoundingClientRect();
    seekBeat((clientX - rect.left) / rect.width * length);
  };
  const selectedMotion = loop?.events.find((event) => event.id === selectedEventId)?.appearance.motion;
  const target = selectedMotion && (selectedMotion.start.scale > selectedMotion.end.scale ? selectedMotion.start.focus : selectedMotion.end.focus);
  const updateTarget = (clientX: number, clientY: number) => {
    if (!target || !onMotionTargetChange || !previewRef.current) return;
    const rect = previewRef.current.getBoundingClientRect();
    onMotionTargetChange({
      x: clamp((clientX - rect.left) / rect.width, 0, 1),
      y: clamp((clientY - rect.top) / rect.height, 0, 1),
    });
  };
  const dragTarget = (pointer: React.PointerEvent) => {
    pointer.preventDefault();
    pointer.stopPropagation();
    updateTarget(pointer.clientX, pointer.clientY);
    const move = (event: PointerEvent) => updateTarget(event.clientX, event.clientY);
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up, { once: true });
  };
  return <div className="loop-preview-wrap">
    <div className="loop-preview-shell"><div ref={previewRef} className={`loop-preview ${target ? "has-motion-target" : ""}`} aria-label="16:9 projector framing preview" onPointerDown={(event) => target && updateTarget(event.clientX, event.clientY)} onClick={() => { if (!target) setTransport(); }}>{(!loop || loop.events.length === 0) && <div className="empty-preview">Drop clips onto the loop timeline</div>}{target && <button className="motion-target" type="button" aria-label="Pan and zoom target" title="Drag the pan and zoom target" style={{ left: `${target.x * 100}%`, top: `${target.y * 100}%` }} onPointerDown={dragTarget}><span /></button>}{videoLoading && <div className="source-loading loop-loading" role="status" aria-label="Loop video loading"><span className="source-loading-ring" /></div>}</div></div>
    <div className="preview-transport"><div><button aria-label={playing ? "Pause preview" : "Play preview"} onClick={setTransport}>{playing ? "❚❚" : "▶"}</button><button aria-label="Reset preview" onClick={() => { setPlaying(false); seekBeat(0); }}>↺</button></div><strong>Bar {Math.floor(beat / 4) + 1} · Beat {(beat % 4 + 1).toFixed(2)}</strong></div>
    <div className="preview-scrub" data-testid="preview-scrub" role="slider" tabIndex={0} aria-label="Video timeline" aria-valuemin={0} aria-valuemax={length} aria-valuenow={beat} onPointerDown={(event) => { event.currentTarget.setPointerCapture(event.pointerId); scrubAt(event.clientX, event.currentTarget); }} onPointerMove={(event) => { if (event.buttons) scrubAt(event.clientX, event.currentTarget); }} onKeyDown={(event) => { if (event.key === "ArrowLeft" || event.key === "ArrowRight") { event.preventDefault(); seekBeat(beat + (event.key === "ArrowRight" ? 0.25 : -0.25)); } }}>
      {Array.from({ length: Math.ceil(length / 4) + 1 }, (_, bar) => <i key={bar} style={{ left: `${Math.min(100, bar * 4 / length * 100)}%` }} />)}
      <span className="preview-scrub-progress" style={{ width: `${beat / length * 100}%` }} />
      <span className="preview-scrub-head" style={{ left: `${beat / length * 100}%` }} />
    </div>
  </div>;
}

function LoopTimeline({ project, loop, selectedEventId, onSelect, onSeek, playheadRef, update, reorderLane, placementError, setPlacementError }: { project: SceneProject; loop: VisualLoop; selectedEventId: string | null; onSelect: (id: string) => void; onSeek: (beat: number) => void; playheadRef: React.RefObject<HTMLSpanElement | null>; update: (mutate: (draft: SceneProject) => void) => void; reorderLane: (from: number, to: number) => void; placementError: string; setPlacementError: (value: string) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const scrubPointer = useRef<number | null>(null);
  const [dragPreview, setDragPreview] = useState<{ id: string; placement: ReturnType<typeof eventPlacement>; valid: boolean } | null>(null);
  const [draggedLane, setDraggedLane] = useState<number | null>(null);
  const totalBeats = Math.max(1, beatsFromMusical(loop.length));
  const laneCount = Math.max(4, ...loop.events.map((event) => laneOf(event) + 2));
  const rowHeight = 46;
  const snap = (beats: number) => Math.round(beats * 4) / 4;
  const laneAt = (clientY: number) => {
    const top = ref.current!.getBoundingClientRect().top;
    return clamp(Math.floor((clientY - top - 8) / rowHeight), 0, laneCount - 1);
  };
  const commitPlacement = (id: string, placement: ReturnType<typeof eventPlacement>) => update((draft) => {
    const target = draft.visualLoops.find((item) => item.id === loop.id)?.events.find((event) => event.id === id);
    if (target) {
      target.at = musicalFromBeats(placement.at);
      target.duration = musicalFromBeats(placement.duration);
      target.lane = placement.lane;
    }
  });
  const drag = (pointer: React.PointerEvent, event: LoopEvent, mode: "move" | "start" | "end") => {
    pointer.preventDefault();
    pointer.stopPropagation();
    if (pointer.target instanceof HTMLElement) pointer.target.closest("button")?.focus();
    onSelect(event.id);
    const initialX = pointer.clientX;
    const initialY = pointer.clientY;
    const initial = eventPlacement(event);
    const width = ref.current!.getBoundingClientRect().width;
    const candidateAt = (next: PointerEvent) => {
      const delta = snap(((next.clientX - initialX) / width) * totalBeats);
      const candidate = { ...initial };
      if (mode === "move") {
        candidate.at = clamp(initial.at + delta, 0, totalBeats - initial.duration);
        candidate.lane = clamp(initial.lane + Math.round((next.clientY - initialY) / rowHeight), 0, laneCount - 1);
      }
      if (mode === "start") {
        candidate.at = clamp(initial.at + delta, 0, initial.at + initial.duration - 0.25);
        candidate.duration = initial.duration + initial.at - candidate.at;
      }
      if (mode === "end") candidate.duration = clamp(initial.duration + delta, 0.25, totalBeats - initial.at);
      return candidate;
    };
    const move = (next: PointerEvent) => {
      const placement = candidateAt(next);
      setDragPreview({ id: event.id, placement, valid: canPlaceWithinLoop(loop, event.id, placement) });
    };
    const up = (next: PointerEvent) => {
      const placement = candidateAt(next);
      if (canPlaceWithinLoop(loop, event.id, placement)) {
        if (placement.at !== initial.at || placement.duration !== initial.duration || placement.lane !== initial.lane) commitPlacement(event.id, placement);
        setPlacementError("");
      } else setPlacementError("Instances cannot overlap on the same lane.");
      setDragPreview(null);
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", cancel);
    };
    const cancel = () => {
      setDragPreview(null);
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", cancel);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", cancel);
  };
  const addClip = (clipId: string, clientX?: number, clientY?: number) => {
    const rect = ref.current!.getBoundingClientRect();
    const at = clientX === undefined ? 0 : snap(clamp((clientX - rect.left) / rect.width * totalBeats, 0, totalBeats - 0.25));
    const created = makeEvent(project, loop, clipId, at);
    if (clientY !== undefined) created.lane = laneAt(clientY);
    if (!canPlaceWithinLoop(loop, null, eventPlacement(created))) {
      setPlacementError("Instances cannot overlap on the same lane.");
      return;
    }
    update((draft) => draft.visualLoops.find((item) => item.id === loop.id)?.events.push(created));
    onSelect(created.id);
    setPlacementError("");
  };
  const seekAtPointer = (clientX: number) => {
    const rect = ref.current!.getBoundingClientRect();
    onSeek(clamp((clientX - rect.left) / rect.width * totalBeats, 0, totalBeats - 0.001));
  };
  const endScrub = (event: React.PointerEvent<HTMLDivElement>) => {
    if (scrubPointer.current !== event.pointerId) return;
    scrubPointer.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  };

  return <div className="loop-timeline-shell">
    <div className="beat-ruler">{Array.from({ length: Math.ceil(totalBeats / 4) }, (_, bar) => <span key={bar} style={{ left: `${bar * 4 / totalBeats * 100}%` }}>Bar {bar + 1}</span>)}{placementError && <span className="placement-error" role="status">{placementError}</span>}</div>
    <div className="loop-lane-rail" style={{ height: `${20 + laneCount * rowHeight}px` }}>
      {Array.from({ length: laneCount }, (_, lane) => <button key={lane} type="button" draggable data-lane-order={lane} className={`loop-lane-handle ${draggedLane === lane ? "dragging" : ""}`} style={{ top: `${8 + lane * rowHeight}px`, height: `${rowHeight}px` }} aria-label={`Drag lane ${lane + 1} to reorder`} title={`Drag lane ${lane + 1} to reorder`} onDragStart={(event) => { event.dataTransfer.effectAllowed = "move"; event.dataTransfer.setData("application/x-video-sync-lane", String(lane)); setDraggedLane(lane); }} onDragOver={(event) => { if (event.dataTransfer.types.includes("application/x-video-sync-lane")) event.preventDefault(); }} onDrop={(event) => { event.preventDefault(); event.stopPropagation(); const from = Number(event.dataTransfer.getData("application/x-video-sync-lane")); reorderLane(from, lane); setDraggedLane(null); }} onDragEnd={() => setDraggedLane(null)}><span className="grip-dots" aria-hidden="true">{Array.from({ length: 6 }, (_, dot) => <i key={dot} />)}</span><small>{lane + 1}</small></button>)}
    </div>
    <div ref={ref} className="loop-timeline" data-testid="loop-timeline" style={{ height: `${20 + laneCount * rowHeight}px` }} onPointerDown={(event) => { if (event.button !== 0 || (event.target instanceof Element && event.target.closest(".loop-event"))) return; event.preventDefault(); scrubPointer.current = event.pointerId; event.currentTarget.setPointerCapture(event.pointerId); seekAtPointer(event.clientX); }} onPointerMove={(event) => { if (scrubPointer.current === event.pointerId && (event.buttons & 1)) seekAtPointer(event.clientX); }} onPointerUp={(event) => { if (scrubPointer.current === event.pointerId) seekAtPointer(event.clientX); endScrub(event); }} onPointerCancel={endScrub} onLostPointerCapture={() => { scrubPointer.current = null; }} onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); const clipId = event.dataTransfer.getData("application/x-video-sync-clip"); if (clipId) addClip(clipId, event.clientX, event.clientY); }}>
      {Array.from({ length: Math.ceil(totalBeats) + 1 }, (_, index) => <i key={index} className={index % 4 === 0 ? "bar-line" : "beat-line"} style={{ left: `${index / totalBeats * 100}%` }} />)}
      {Array.from({ length: laneCount }, (_, lane) => <div key={lane} className="loop-lane" style={{ top: `${8 + lane * rowHeight}px`, height: `${rowHeight}px` }} />)}
      <span ref={playheadRef} className="loop-playhead" aria-hidden="true" />
      {loop.events.map((event) => {
        const clip = project.clips.find((candidate) => candidate.id === event.clipId);
        const placement = dragPreview?.id === event.id ? dragPreview.placement : eventPlacement(event);
        return <button key={event.id} data-event-id={event.id} data-lane={placement.lane} className={`loop-event ${selectedEventId === event.id ? "selected" : ""} ${dragPreview?.id === event.id && !dragPreview.valid ? "invalid" : ""}`} style={{ left: `${placement.at / totalBeats * 100}%`, width: `${placement.duration / totalBeats * 100}%`, top: `${12 + placement.lane * rowHeight}px`, background: clip?.color }} onPointerDown={(pointer) => drag(pointer, event, "move")} onClick={() => onSelect(event.id)}><span className="range-handle left" onPointerDown={(pointer) => drag(pointer, event, "start")} /><span>{clip?.label ?? event.clipId}</span><span className="range-handle right" onPointerDown={(pointer) => drag(pointer, event, "end")} /></button>;
      })}
    </div>
  </div>;
}

function LoopsWorkspace({ project, update, preparedMedia, preparing, selectedLoopId, setSelectedLoopId, selectedEventId, setSelectedEventId, initialBeat, onPreviewBeatChange }: { project: SceneProject; update: (mutate: (draft: SceneProject) => void) => void; preparedMedia: PreparedClipMedia; preparing: boolean; selectedLoopId: string; setSelectedLoopId: (id: string) => void; selectedEventId: string | null; setSelectedEventId: (id: string | null) => void; initialBeat: number; onPreviewBeatChange: (beat: number) => void }) {
  const loop = project.visualLoops.find((candidate) => candidate.id === selectedLoopId) ?? project.visualLoops[0];
  const selectedEvent = loop?.events.find((event) => event.id === selectedEventId) ?? null;
  const selectedClip = project.clips.find((clip) => clip.id === selectedEvent?.clipId);
  const [placementError, setPlacementError] = useState("");
  const [draggedLoopId, setDraggedLoopId] = useState<string | null>(null);
  const previewSeekRef = useRef<((beat: number) => void) | null>(null);
  const timelinePlayheadRef = useRef<HTMLSpanElement>(null);
  const columns = useThreePanelLayout();
  const vertical = useBottomPanelLayout("loops");
  const laneCount = loop ? Math.max(4, ...loop.events.map((event) => laneOf(event) + 2)) : 4;
  const reorderLane = (from: number, to: number) => {
    if (!loop || from === to || from < 0 || to < 0 || from >= laneCount || to >= laneCount) return;
    const order = Array.from({ length: laneCount }, (_, lane) => lane);
    order.splice(to, 0, ...order.splice(from, 1));
    update((draft) => {
      const target = draft.visualLoops.find((item) => item.id === loop.id);
      for (const event of target?.events ?? []) event.lane = order.indexOf(laneOf(event));
    });
    setPlacementError("");
  };
  const duplicateInstance = (eventId: string) => {
    if (!loop) return;
    const nextId = uniqueId("event", loop.events.map((event) => event.id));
    update((draft) => {
      const target = draft.visualLoops.find((item) => item.id === loop.id);
      if (target) duplicateEventAfter(target, eventId);
    });
    setSelectedEventId(nextId);
    setPlacementError("");
  };
  const changeLoop = (input: Partial<VisualLoop>) => update((draft) => {
    const target = draft.visualLoops.find((item) => item.id === loop.id);
    if (target) Object.assign(target, input);
  });
  const changeEvent = (input: Partial<LoopEvent>) => {
    if (!loop || !selectedEvent) return;
    if (!canPlaceWithinLoop(loop, selectedEvent.id, eventPlacement({ ...selectedEvent, ...input }))) {
      setPlacementError("Instances cannot overlap on the same lane.");
      return;
    }
    setPlacementError("");
    update((draft) => {
      const target = draft.visualLoops.find((item) => item.id === loop.id)?.events.find((event) => event.id === selectedEventId);
      if (target) Object.assign(target, input);
    });
  };
  const deleteSelectedEvent = () => {
    if (!loop || !selectedEventId) return;
    update((draft) => {
      const target = draft.visualLoops.find((item) => item.id === loop.id);
      if (target) target.events = target.events.filter((event) => event.id !== selectedEventId);
    });
    setSelectedEventId(null);
    setPlacementError("");
  };
  useEffect(() => {
    const handleDelete = (event: KeyboardEvent) => {
      if (!selectedEventId || !["Delete", "Backspace"].includes(event.key) || event.metaKey || event.ctrlKey || event.altKey) return;
      if (event.target instanceof Element && event.target.closest("input, textarea, select, [contenteditable='true']")) return;
      event.preventDefault();
      deleteSelectedEvent();
    };
    window.addEventListener("keydown", handleDelete);
    return () => window.removeEventListener("keydown", handleDelete);
  }, [selectedEventId, loop?.id]);
  const changeMotionFocus = (focus: { x: number; y: number }) => {
    const motion = selectedEvent?.appearance.motion;
    if (!selectedEvent || !motion) return;
    const zoomedKeyframe = motion.start.scale > motion.end.scale ? "start" : "end";
    changeEvent({
      appearance: {
        ...selectedEvent.appearance,
        motion: { ...motion, focusSource: undefined, [zoomedKeyframe]: { ...motion[zoomedKeyframe], focus } },
      },
    });
  };
  const changeMotionZoom = (percent: number) => {
    const motion = selectedEvent?.appearance.motion;
    if (!selectedEvent || !motion) return;
    const zoomedKeyframe = motion.start.scale > motion.end.scale ? "start" : "end";
    const scale = 1 + percent / 100;
    changeEvent({
      appearance: {
        ...selectedEvent.appearance,
        motion: {
          ...motion,
          start: { ...motion.start, scale: zoomedKeyframe === "start" ? scale : 1 },
          end: { ...motion.end, scale: zoomedKeyframe === "end" ? scale : 1 },
        },
      },
    });
  };
  const toggleMotion = (enabled: boolean) => {
    if (!selectedEvent) return;
    const focus = selectedClip?.subjectFocus ?? { x: 0.5, y: 0.45 };
    changeEvent({
      appearance: {
        ...selectedEvent.appearance,
        motion: enabled ? {
          type: "ken-burns",
          progress: "event",
          easing: "ease-in-out",
          speed: 1,
          start: { scale: 1, focus: { x: 0.5, y: 0.5 } },
          end: { scale: 1.18, focus },
        } : undefined,
      },
    });
  };
  const addLoop = () => {
    const created = makeLoop(project);
    update((draft) => draft.visualLoops.push(created));
    setSelectedLoopId(created.id);
    setSelectedEventId(null);
  };
  const reorderLoop = (fromId: string, toId: string) => {
    if (!fromId || fromId === toId) return;
    update((draft) => {
      const from = draft.visualLoops.findIndex((item) => item.id === fromId);
      const to = draft.visualLoops.findIndex((item) => item.id === toId);
      if (from < 0 || to < 0) return;
      draft.visualLoops.splice(to, 0, ...draft.visualLoops.splice(from, 1));
    });
    setDraggedLoopId(null);
  };

  return <div ref={columns.ref} className="workspace-grid loops-workspace resizable-workspace" style={columns.style}>
    <aside className="panel loop-list">
      <div className="panel-heading"><div><span className="eyebrow">Drag to map A–H</span><h2>Video loops</h2></div><IconButton title="Add loop" onClick={addLoop}>＋</IconButton></div>
      <div className="stack-list" aria-label="Visual loops in hot cue order">{project.visualLoops.map((item, index) => <div key={item.id} data-loop-id={item.id} className={`list-card loop-list-card ${item.id === loop?.id ? "selected" : ""} ${draggedLoopId === item.id ? "dragging" : ""}`} onDragOver={(event) => { if (event.dataTransfer.types.includes("application/x-video-sync-loop")) { event.preventDefault(); event.dataTransfer.dropEffect = "move"; } }} onDrop={(event) => { event.preventDefault(); reorderLoop(event.dataTransfer.getData("application/x-video-sync-loop"), item.id); }}>
        <button type="button" draggable className="loop-order-handle" aria-label={`Drag ${item.name} to reorder`} title="Drag to reorder hot cues" onDragStart={(event) => { event.dataTransfer.effectAllowed = "move"; event.dataTransfer.setData("application/x-video-sync-loop", item.id); setDraggedLoopId(item.id); }} onDragEnd={() => setDraggedLoopId(null)}><span className="grip-dots" aria-hidden="true">{Array.from({ length: 6 }, (_, dot) => <i key={dot} />)}</span></button>
        <span className="loop-cue-badge" title={index < CUE_LETTERS.length ? `Hot Cue ${CUE_LETTERS[index]}` : "Not mapped to a hot cue"}>{index < CUE_LETTERS.length ? CUE_LETTERS[index] : "—"}</span>
        <button type="button" className="loop-list-select" title={item.name} onClick={() => { setSelectedLoopId(item.id); setSelectedEventId(null); }}><strong>{item.name}</strong><span>{beatsFromMusical(item.length) / 4} bars · {item.events.length} events</span></button>
        <button type="button" className={`loop-default-button ${project.defaultLoopId === item.id ? "active" : ""}`} aria-label={`Set ${item.name} as default loop`} aria-pressed={project.defaultLoopId === item.id} title={project.defaultLoopId === item.id ? "Scene default" : "Set as scene default"} onClick={() => update((draft) => { draft.defaultLoopId = item.id; })}>{project.defaultLoopId === item.id ? "★" : "☆"}</button>
      </div>)}</div>
    </aside>
    <PanelResizeHandle name="Resize Video loops panel" axis="x" value={columns.leftWidth} onChange={columns.setLeft} />
    <main ref={vertical.ref} className="panel loop-editor" style={vertical.style}>
      <div className="panel-heading"><div><span className="eyebrow">Loop Builder</span><h2>{loop?.name}</h2></div>{loop && <div className="inline-fields">
        <SteppedNumberField id="loop-preview-bpm" label="Preview BPM" value={project.previewBpm} min={20} max={300} inputStep={0.01} onChange={(value) => update((draft) => { draft.previewBpm = value; })} />
        <SteppedNumberField id="loop-bars" label="Bars" value={beatsFromMusical(loop.length) / 4} min={0.25} inputStep={0.25} onChange={(value) => changeLoop({ length: { bars: Math.max(0.25, value) } })} />
      </div>}</div>
      {loop && <>
        {preparing ? <div className="loop-preview-wrap"><div className="loop-preview-shell"><div className="loop-preview"><div className="source-loading loop-loading" role="status" aria-label="Preparing clips"><span className="source-loading-ring" /></div></div></div></div> : <LoopPreview project={project} loop={loop} preparedMedia={preparedMedia} selectedEventId={selectedEventId} onMotionTargetChange={changeMotionFocus} seekRef={previewSeekRef} initialBeat={initialBeat} onBeatChange={(beat, length) => { onPreviewBeatChange(beat); if (timelinePlayheadRef.current) timelinePlayheadRef.current.style.left = `${beat / length * 100}%`; }} spaceShortcut />}
        <PanelResizeHandle name="Resize loop preview and timeline" axis="y" direction={-1} value={vertical.bottomHeight} onChange={vertical.setBottom} />
        <LoopTimeline project={project} loop={loop} selectedEventId={selectedEventId} onSelect={setSelectedEventId} onSeek={(beat) => previewSeekRef.current?.(beat)} playheadRef={timelinePlayheadRef} update={update} reorderLane={reorderLane} placementError={placementError} setPlacementError={setPlacementError} />
        <div className="clip-strip"><span>Drag a clip into the timeline</span>{project.clips.map((clip) => <button key={clip.id} draggable onDragStart={(event) => event.dataTransfer.setData("application/x-video-sync-clip", clip.id)} style={{ borderColor: clip.color }} onDoubleClick={() => { const created = makeEvent(project, loop, clip.id); update((draft) => draft.visualLoops.find((item) => item.id === loop.id)?.events.push(created)); setSelectedEventId(created.id); }}>{clip.label}</button>)}</div>
      </>}
    </main>
    <PanelResizeHandle name="Resize Loop inspector" axis="x" direction={-1} value={columns.rightWidth} onChange={columns.setRight} />
    <aside className="panel inspector">
      <div className="panel-heading"><div><span className="eyebrow">Selected item</span><h2>Inspector</h2></div></div>
      {loop && <div className="inspector-fields">
        <Field label="Loop name"><input value={loop.name} onChange={(event) => changeLoop({ name: event.target.value })} /></Field>
        {selectedEvent ? <>
          <h3>Clip instance</h3>
          <Field label="Clip"><select value={selectedEvent.clipId} onChange={(event) => changeEvent({ clipId: event.target.value })}>{project.clips.map((clip) => <option key={clip.id} value={clip.id}>{clip.label}</option>)}</select></Field>
          <div className="field-row"><Field label="Start beat"><input type="number" min="0" step="0.25" value={eventStart(selectedEvent)} onChange={(event) => changeEvent({ at: musicalFromBeats(Number(event.target.value)) })} /></Field><Field label="Duration"><input type="number" min="0.25" step="0.25" value={eventDuration(selectedEvent)} onChange={(event) => changeEvent({ duration: musicalFromBeats(Number(event.target.value)) })} /></Field></div>
          <div className="field-row"><Field label="Source offset"><input type="number" min="0" step="0.1" value={selectedEvent.source.offsetSeconds} onChange={(event) => changeEvent({ source: { ...selectedEvent.source, offsetSeconds: Number(event.target.value) } })} /></Field><Field label="Playback speed"><input type="number" min="0.1" max="4" step="0.1" value={selectedEvent.source.rate} onChange={(event) => changeEvent({ source: { ...selectedEvent.source, rate: Number(event.target.value) } })} /></Field></div>
          <Field label="End behavior"><select value={selectedEvent.source.endBehavior} onChange={(event) => changeEvent({ source: { ...selectedEvent.source, endBehavior: event.target.value as "loop" | "hold" } })}><option value="loop">Loop clip range</option><option value="hold">Hold last frame</option></select></Field>
          <Field label="Framing"><select aria-label="Framing" value={selectedEvent.appearance.fit} onChange={(event) => changeEvent({ appearance: { ...selectedEvent.appearance, fit: event.target.value as "contain" | "cover" } })}><option value="contain">Full frame</option><option value="cover">Fill screen (crop)</option></select></Field>
          <Field label={`Opacity · ${Math.round(selectedEvent.appearance.opacity * 100)}%`}><input className="opacity-slider" aria-label="Opacity" type="range" min="0" max="100" step="1" value={Math.round(selectedEvent.appearance.opacity * 100)} onChange={(event) => changeEvent({ appearance: { ...selectedEvent.appearance, opacity: Number(event.target.value) / 100 } })} /></Field>
          <Field label="Blend"><select value={selectedEvent.appearance.blendMode} onChange={(event) => changeEvent({ appearance: { ...selectedEvent.appearance, blendMode: event.target.value as LoopEvent["appearance"]["blendMode"] } })}><option>normal</option><option>screen</option><option>multiply</option><option>plus-lighter</option></select></Field>
          <label className="check-row"><input type="checkbox" checked={Boolean(selectedEvent.appearance.motion)} onChange={(event) => toggleMotion(event.target.checked)} /> Slow zoom & pan</label>
          {selectedEvent.appearance.motion && <div className="motion-controls">
            <Field label={`Zoom amount · ${Math.round(Math.abs(selectedEvent.appearance.motion.end.scale - selectedEvent.appearance.motion.start.scale) * 100)}%`}><input aria-label="Zoom amount" type="range" min="0" max="300" step="1" value={Math.round(Math.abs(selectedEvent.appearance.motion.end.scale - selectedEvent.appearance.motion.start.scale) * 100)} onChange={(event) => changeMotionZoom(Number(event.target.value))} /></Field>
            <Field label={`Motion speed · ${(selectedEvent.appearance.motion.speed ?? 1).toFixed(2)}×`}><input aria-label="Motion speed" type="range" min="0.25" max="4" step="0.25" value={selectedEvent.appearance.motion.speed ?? 1} onChange={(event) => changeEvent({ appearance: { ...selectedEvent.appearance, motion: { ...selectedEvent.appearance.motion!, speed: Number(event.target.value) } } })} /></Field>
            <div className="motion-target-readout"><span>Target</span><strong>{Math.round((selectedEvent.appearance.motion.start.scale > selectedEvent.appearance.motion.end.scale ? selectedEvent.appearance.motion.start.focus.x : selectedEvent.appearance.motion.end.focus.x) * 100)}%, {Math.round((selectedEvent.appearance.motion.start.scale > selectedEvent.appearance.motion.end.scale ? selectedEvent.appearance.motion.start.focus.y : selectedEvent.appearance.motion.end.focus.y) * 100)}%</strong></div>
            <p>Drag the target over the Loop Builder preview.</p>
          </div>}
        </> : <p className="empty">Select a clip instance on the timeline.</p>}
      </div>}
      {selectedEvent && <div className="instance-actions"><button className="instance-duplicate" aria-label={`Duplicate ${selectedClip?.label ?? selectedEvent.clipId} after original`} title="Place a copy immediately after this instance" onClick={() => duplicateInstance(selectedEvent.id)}>Duplicate instance</button><button className="danger" onClick={deleteSelectedEvent}>Delete instance</button></div>}
    </aside>
  </div>;
}

export function App() {
  const restoredSession = useMemo(readStudioSession, []);
  const restoredDraft = restoredSession?.drafts[restoredSession.activeSceneId];
  const initialProject = useMemo(() => restoredDraft?.project ?? catalogProject(DEFAULT_SCENE_ID), []);
  const history = useProjectHistory(initialProject);
  const { project, update, replace, undo, redo, canUndo, canRedo, undoDescription, redoDescription } = history;
  const [workspace, setWorkspace] = useState<Workspace>(restoredSession?.workspace ?? "clips");
  const [prepared, setPrepared] = useState<{ projectId: string; signature: string; media: PreparedClipMedia } | null>(restoredSession?.prepared ?? null);
  const [preparationMessage, setPreparationMessage] = useState("");
  const [preparationProgress, setPreparationProgress] = useState<PreparationProgress | null>(null);
  const [preparationDismissed, setPreparationDismissed] = useState(false);
  const [activePreparation, setActivePreparation] = useState<{ projectId: string; key: string } | null>(null);
  const preparationRun = useRef<{ key: string; token: number } | null>(null);
  const preparationSequence = useRef(0);
  const [selectedSourceId, setSelectedSourceId] = useState<string | null>(restoredDraft?.selectedSourceId ?? project.sources[0]?.id ?? null);
  const [selectedClipId, setSelectedClipId] = useState<string | null>(restoredDraft?.selectedClipId ?? project.clips[0]?.id ?? null);
  const [selectedLoopId, setSelectedLoopId] = useState(restoredDraft?.selectedLoopId ?? project.defaultLoopId);
  const [selectedEventId, setSelectedEventId] = useState<string | null>(restoredDraft?.selectedEventId ?? null);
  const [sourceMuted, setSourceMuted] = useState(restoredSession?.settings?.sourceMuted ?? false);
  const [auditionLoop, setAuditionLoop] = useState(restoredSession?.settings?.auditionLoop ?? false);
  const sourcePlayheads = useRef<Record<string, number>>({ ...restoredDraft?.sourcePlayheads });
  const loopPreviewBeat = useRef(restoredDraft?.loopPreviewBeat ?? 0);
  const [status, setStatus] = useState(restoredDraft ? `Local session restored · ${project.name}` : "Catalog scene loaded · Save to preserve edits");
  const [savedProjects, setSavedProjects] = useState<Array<{ id: string; name: string; updatedAt: string }>>([]);
  const [busy, setBusy] = useState(false);
  const [dirty, setDirty] = useState(restoredDraft?.dirty ?? false);
  const [hasSaved, setHasSaved] = useState(restoredDraft?.hasSaved ?? false);
  const [hydrated, setHydrated] = useState(Boolean(restoredSession));
  const [scenePickerOpen, setScenePickerOpen] = useState(false);
  const clipSignature = JSON.stringify({ sources: project.sources.map(({ id, file, durationSeconds }) => [id, file, durationSeconds]), clips: project.clips.map(({ id, sourceId, inSeconds, outSeconds }) => [id, sourceId, inSeconds, outSeconds]) });
  const currentPrepared = prepared?.projectId === project.id && prepared.signature === clipSignature ? prepared.media : null;
  const preparingCurrentProject = activePreparation?.projectId === project.id;
  const silentInitialPreparation = useRef(Boolean(restoredSession?.workspace === "loops" && !currentPrepared));
  const drafts = useRef(new Map<string, StudioDraft>(Object.entries(restoredSession?.drafts ?? {})));
  const hasInteracted = useRef(false);
  const switchToken = useRef(0);
  const currentDraft = (overrides: Partial<StudioDraft> = {}): StudioDraft => ({
    project, dirty, hasSaved, selectedSourceId, selectedClipId, selectedLoopId, selectedEventId,
    sourcePlayheads: { ...sourcePlayheads.current }, loopPreviewBeat: loopPreviewBeat.current,
    ...overrides,
  });
  const editProject = (mutate: (draft: SceneProject) => void) => { hasInteracted.current = true; setDirty(true); update(mutate); };
  const performUndo = () => { if (!canUndo) return; hasInteracted.current = true; setDirty(true); undo(); };
  const performRedo = () => { if (!canRedo) return; hasInteracted.current = true; setDirty(true); redo(); };
  const openProject = (loaded: SceneProject, saved: boolean, message: string, draft?: StudioDraft) => {
    const { project: expanded, migrated } = migrateLegacyDefaultClipRanges(loaded);
    const url = new URL(window.location.href);
    if (url.searchParams.has("scene")) {
      url.searchParams.set("scene", expanded.id);
      window.history.replaceState(null, "", url);
    }
    replace(normalizeProjectLanes(expanded));
    setSelectedSourceId(draft?.selectedSourceId ?? expanded.sources[0]?.id ?? null);
    setSelectedClipId(draft?.selectedClipId ?? expanded.clips[0]?.id ?? null);
    setSelectedLoopId(draft?.selectedLoopId ?? expanded.defaultLoopId);
    setSelectedEventId(draft?.selectedEventId ?? null);
    sourcePlayheads.current = { ...draft?.sourcePlayheads };
    loopPreviewBeat.current = draft?.loopPreviewBeat ?? 0;
    setHasSaved(saved);
    setDirty(migrated || Boolean(draft?.dirty));
    setStatus(migrated ? `${message} · Default clip ranges expanded; save to keep` : message);
  };

  const refreshProjects = () => listProjects().then(setSavedProjects).catch(() => setSavedProjects([]));
  useEffect(() => {
    void refreshProjects();
    const requestedSceneId = new URLSearchParams(window.location.search).get("scene");
    if (requestedSceneId) {
      const sameSessionScene = restoredSession?.activeSceneId === requestedSceneId;
      if (!sameSessionScene) setWorkspace("clips");
      const draft = restoredSession?.drafts[requestedSceneId];
      if (draft?.dirty) {
        openProject(draft.project, draft.hasSaved, `Opened ${draft.project.name}`, draft);
        setHydrated(true);
      } else {
        void loadProject(requestedSceneId).then((saved) => {
          if (!hasInteracted.current) openProject(saved, true, `Opened saved ${saved.name}`, sameSessionScene ? draft : undefined);
        }).catch(() => {
          if (draft) openProject(draft.project, draft.hasSaved, `Opened cached ${draft.project.name}`, draft);
          else if (isStudioScene(requestedSceneId)) {
            const loaded = catalogProject(requestedSceneId);
            openProject(loaded, false, loaded.sources.length ? `Opened catalog ${loaded.name}` : `Source video needed · Import footage to build ${loaded.name}`);
          }
          else setStatus(`Scene ${requestedSceneId} could not be opened`);
        }).finally(() => setHydrated(true));
      }
      return;
    }
    if (restoredSession) return;
    void loadProject(DEFAULT_SCENE_ID).then((saved) => {
      if (!hasInteracted.current) openProject(saved, true, `Opened saved ${saved.name}`);
    }).catch(() => {}).finally(() => setHydrated(true));
  }, []);
  useEffect(() => {
    if (!hydrated) return;
    const persist = () => {
      const allDrafts = Object.fromEntries(drafts.current);
      allDrafts[project.id] = currentDraft();
      writeStudioSession({ v: 1, activeSceneId: project.id, workspace, drafts: allDrafts, settings: { sourceMuted, auditionLoop }, ...(prepared ? { prepared } : {}) });
    };
    persist();
    window.addEventListener("pagehide", persist);
    return () => window.removeEventListener("pagehide", persist);
  }, [hydrated, project, dirty, hasSaved, workspace, selectedSourceId, selectedClipId, selectedLoopId, selectedEventId, sourceMuted, auditionLoop, prepared]);
  useEffect(() => {
    if (!hydrated || workspace !== "loops" || currentPrepared) return;
    const key = `${project.id}:${clipSignature}`;
    if (preparationRun.current?.key === key) return;
    const token = ++preparationSequence.current;
    preparationRun.current = { key, token };
    setActivePreparation({ projectId: project.id, key });
    setPreparationProgress({ completed: 0, total: 0, current: null });
    setPreparationDismissed(silentInitialPreparation.current);
    silentInitialPreparation.current = false;
    setPreparationMessage(`Checking ${project.name} for new or changed cuts…`);
    void prepareClips(project, (progress) => {
      if (preparationRun.current?.token !== token) return;
      setPreparationProgress(progress);
      setPreparationMessage(progress.reused === undefined
        ? `Checking ${project.name} for new or changed cuts…`
        : `Preparing ${project.name} · ${progress.completed}/${progress.total} cuts · ${progress.reused} reused`);
    }).then((result) => {
      if (preparationRun.current?.token !== token) return;
      setPrepared({ projectId: project.id, signature: clipSignature, media: result.media });
      const message = `Clips ready for ${project.name} · ${result.created} cut, ${result.reused} reused, ${result.removed} obsolete removed${result.warnings.length ? ` · ${result.warnings.length} need attention: ${result.warnings[0]}` : ""}`;
      setPreparationMessage(message);
      setStatus(message);
    }).catch((error) => {
      if (preparationRun.current?.token !== token) return;
      setPrepared({ projectId: project.id, signature: clipSignature, media: {} });
      const message = `Clip preparation failed; using source videos · ${error instanceof Error ? error.message : "unknown error"}`;
      setPreparationMessage(message);
      setStatus(message);
    }).finally(() => {
      if (preparationRun.current?.token !== token) return;
      preparationRun.current = null;
      setActivePreparation(null);
      setPreparationDismissed(true);
    });
  }, [hydrated, workspace, project.id, clipSignature]);
  useEffect(() => {
    const keyboard = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey)) return;
      if (event.key.toLowerCase() === "z") { event.preventDefault(); event.shiftKey ? performRedo() : performUndo(); }
      if (event.key.toLowerCase() === "s") { event.preventDefault(); void handleSave(); }
    };
    window.addEventListener("keydown", keyboard);
    return () => window.removeEventListener("keydown", keyboard);
  });

  const handleSave = async () => {
    setBusy(true);
    try { await saveProject(project); drafts.current.set(project.id, currentDraft({ dirty: false, hasSaved: true })); setHasSaved(true); setDirty(false); setStatus(`Saved ${project.name} · ${new Date().toLocaleTimeString()}`); await refreshProjects(); }
    catch (error) { setStatus(error instanceof Error ? error.message : "Save failed"); }
    finally { setBusy(false); }
  };
  const handlePublish = async () => {
    if (!project.clips.length || !project.visualLoops.some((loop) => loop.events.length)) {
      setStatus("Add video clips to a loop before publishing this scene");
      return;
    }
    setBusy(true);
    try { await saveProject(project); drafts.current.set(project.id, currentDraft({ dirty: false, hasSaved: true })); setHasSaved(true); setDirty(false); const media = currentPrepared ?? (await prepareClips(project)).media; await publishProject(project, compileRuntimeScene(project, media)); setStatus("Published for Live Console · reload it to use this scene"); await refreshProjects(); }
    catch (error) { setStatus(error instanceof Error ? error.message : "Publish failed"); }
    finally { setBusy(false); }
  };
  const handleExportPackage = async () => {
    setBusy(true);
    setStatus(`Packaging ${project.name} with source media…`);
    try {
      const blob = await exportScenePackage(project, compileRuntimeScene(project));
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `${project.id}.vscene`;
      anchor.click();
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
      setStatus(`Exported ${project.name} · ${project.sources.length} source videos`);
    } catch (error) { setStatus(error instanceof Error ? error.message : "Scene export failed"); }
    finally { setBusy(false); }
  };
  const handleImportPackage = async (file: File) => {
    setBusy(true);
    setStatus(`Importing scene package ${file.name}…`);
    try {
      const imported = await importScenePackage(file);
      drafts.current.set(project.id, currentDraft({ project: cloneProject(project) }));
      hasInteracted.current = true;
      const loaded = await loadProject(imported.id);
      openProject(loaded, true, `Imported ${imported.name} with source media`);
      await refreshProjects();
    } catch (error) { setStatus(error instanceof Error ? error.message : "Scene import failed"); }
    finally { setBusy(false); }
  };
  const handleImport = async (file: File) => {
    setBusy(true);
    setStatus(`Importing ${file.name}…`);
    try {
      const metadata = await readVideoMetadata(file);
      const base = slugify(file.name.replace(/\.[^.]+$/, ""));
      const sourceId = uniqueId(base, project.sources.map((source) => source.id));
      const uploaded = await uploadSource(project.id, sourceId, file);
      const source: MediaSource = { id: sourceId, label: file.name.replace(/\.[^.]+$/, ""), ...uploaded, ...metadata };
      const clip = makeClip(project, source.id, 0, source.durationSeconds);
      clip.label = source.label;
      editProject((draft) => { draft.sources.push(source); draft.clips.push(clip); });
      setSelectedSourceId(source.id);
      setSelectedClipId(clip.id);
      setStatus(`Imported ${file.name}`);
    } catch (error) { setStatus(error instanceof Error ? error.message : "Import failed"); }
    finally { setBusy(false); }
  };
  const load = async (id: string, reload = false) => {
    if (!id) return;
    if (reload && dirty && !window.confirm("Discard unsaved edits and reload this scene?")) return;
    if (!reload && id === project.id) return;
    if (!reload) drafts.current.set(project.id, currentDraft({ project: cloneProject(project) }));
    hasInteracted.current = true;
    const token = ++switchToken.current;
    setBusy(true);
    try {
      const cached = !reload ? drafts.current.get(id) : null;
      if (cached) {
        openProject(cached.project, cached.hasSaved, cached.dirty ? `Draft edits restored · ${cached.project.name}` : `Opened ${cached.project.name}`, cached);
        return;
      }
      try {
        const saved = await loadProject(id);
        if (token === switchToken.current) { if (reload) drafts.current.delete(id); openProject(saved, true, `Opened saved ${saved.name}`); }
      } catch (error) {
        if (!isStudioScene(id)) throw error;
        if (token === switchToken.current) {
          const loaded = catalogProject(id);
          openProject(loaded, false, loaded.sources.length ? "Catalog scene loaded · Save to preserve edits" : "Source video needed · Import footage to build this scene");
        }
      }
    } catch (error) { if (token === switchToken.current) setStatus(error instanceof Error ? error.message : "Open failed"); }
    finally { if (token === switchToken.current) setBusy(false); }
  };

  const historyControls = <HistoryControls canUndo={canUndo} canRedo={canRedo} undoDescription={undoDescription} redoDescription={redoDescription} onUndo={performUndo} onRedo={performRedo} />;
  const workspaceContent = workspace === "clips"
    ? <SourcesWorkspace project={project} update={editProject} selectedSourceId={selectedSourceId} setSelectedSourceId={setSelectedSourceId} selectedClipId={selectedClipId} setSelectedClipId={setSelectedClipId} sourceMuted={sourceMuted} setSourceMuted={setSourceMuted} auditionLoop={auditionLoop} setAuditionLoop={setAuditionLoop} sourcePlayheads={sourcePlayheads.current} onPlayheadChange={(sourceId, time) => { sourcePlayheads.current[sourceId] = time; }} onImport={handleImport} />
    : <LoopsWorkspace project={project} update={editProject} preparedMedia={currentPrepared ?? {}} preparing={!currentPrepared} selectedLoopId={selectedLoopId} setSelectedLoopId={setSelectedLoopId} selectedEventId={selectedEventId} setSelectedEventId={setSelectedEventId} initialBeat={loopPreviewBeat.current} onPreviewBeatChange={(beat) => { loopPreviewBeat.current = beat; }} />;

  return <div className="app-shell">
    <header className="app-header">
      <a className="brand" href="/poc/"><span className="brand-mark">VS</span><div><strong>Scene Studio</strong><small>Video Sync authoring</small></div></a>
      <nav className="workspace-tabs">{(["clips", "loops"] as Workspace[]).map((item, index) => <button key={item} className={workspace === item ? "active" : ""} onClick={() => setWorkspace(item)}><span>{index + 1}</span>{item === "clips" ? "Sources & Clips" : "Loop Builder"}</button>)}</nav>
      <div className="scene-current">
        <input className="project-name" aria-label="Scene title" title="Edit scene title" value={project.name} disabled={busy} onChange={(event) => editProject((draft) => { draft.name = event.target.value; })} />
        <button className="scene-open" type="button" aria-label="Change scene" title="Change scene" onClick={() => setScenePickerOpen(true)}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M4 7h15m0 0-4-4m4 4-4 4M20 17H5m0 0 4-4m-4 4 4 4" /></svg></button>
      </div>
      <div className="header-actions"><details className="scene-file-menu"><summary>Files</summary><div><label className={`button compact ${busy ? "is-disabled" : ""}`}>Import scene<input type="file" accept=".vscene" hidden disabled={busy} onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ""; if (file) void handleImportPackage(file); }} /></label><button onClick={() => void handleExportPackage()} disabled={busy}>Export scene</button></div></details><button onClick={() => void load(project.id, true)} disabled={busy || !hasSaved}>Reload saved</button><button onClick={() => void handleSave()} disabled={busy}>Save</button><button className="primary" onClick={() => void handlePublish()} disabled={busy}>Publish</button></div>
    </header>
    <div className="status-bar"><span className={busy ? "busy-dot" : dirty ? "unsaved-dot" : "status-dot"} />{preparingCurrentProject && <span className="status-loader" role="status" aria-label="Preparing clips" />}<span className="status-message">{dirty ? "Unsaved edits · " : ""}{preparingCurrentProject ? preparationMessage : status}</span>{preparingCurrentProject && !currentPrepared && preparationDismissed && <button type="button" className="preparation-status-link" onClick={() => setPreparationDismissed(false)}>Show progress</button>}<span className="status-spacer" />{historyControls}<span className="status-metadata">{project.sources.length} sources · {project.clips.length} clips · {project.visualLoops.length} loops</span></div>
    {workspaceContent}
    {scenePickerOpen && <SceneChooser currentId={project.id} currentName={project.name} savedProjects={savedProjects} onSelect={(id) => { setScenePickerOpen(false); void load(id); }} onClose={() => setScenePickerOpen(false)} />}
    {preparingCurrentProject && !currentPrepared && !preparationDismissed && <PreparationModal progress={preparationProgress ?? { completed: 0, total: 0, current: null }} onDismiss={() => setPreparationDismissed(true)} />}
  </div>;
}
