import { useEffect, useMemo, useRef, useState } from "react";
import { listProjects, loadProject, publishProject, saveProject, uploadSource } from "./api";
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

const clamp = (value: number, minimum: number, maximum: number) => Math.min(maximum, Math.max(minimum, value));
const milliseconds = (value: number) => Math.round(value * 1000) / 1000;
const seconds = (value: number) => `${value.toFixed(2)}s`;
const eventStart = (event: LoopEvent) => beatsFromMusical(event.at);
const eventDuration = (event: LoopEvent) => beatsFromMusical(event.duration);

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="field"><span>{label}</span>{children}</label>;
}

function IconButton({ title, children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return <button className="icon-button" title={title} aria-label={title} {...props}>{children}</button>;
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
    ...STUDIO_SCENES.map((scene) => ({ id: scene.id, name: scene.id === currentId ? currentName : savedProjects.find((saved) => saved.id === scene.id)?.name ?? scene.name, saved: savedProjects.some((saved) => saved.id === scene.id) })),
    ...savedProjects.filter((saved) => !isStudioScene(saved.id)).map((saved) => ({ id: saved.id, name: saved.id === currentId ? currentName : saved.name, saved: true })),
  ].filter((scene) => scene.name.toLowerCase().includes(query.trim().toLowerCase()));
  return <dialog ref={dialog} className="scene-dialog" aria-labelledby="scene-dialog-title" onClose={onClose} onCancel={onClose} onKeyDown={(event) => { if (event.key === "Escape") { event.preventDefault(); onClose(); } }}>
    <div className="scene-dialog-heading"><div><span className="eyebrow">Scene Studio</span><h2 id="scene-dialog-title">Select scene</h2></div><IconButton title="Close scene picker" onClick={onClose}>×</IconButton></div>
    <input autoFocus type="search" aria-label="Search scenes" placeholder="Search scenes…" value={query} onChange={(event) => setQuery(event.target.value)} />
    <div className="scene-dialog-list">{scenes.map((scene) => <button key={scene.id} type="button" data-scene-id={scene.id} className={scene.id === currentId ? "selected" : ""} onClick={() => onSelect(scene.id)}><strong>{scene.name}</strong><small>{scene.id === currentId ? "Current scene" : scene.saved ? "Saved scene" : "Catalog scene"}</small></button>)}{scenes.length === 0 && <p className="empty">No matching scenes.</p>}</div>
  </dialog>;
}

function ClipTimeInput({ label, value, min, max, onCommit }: { label: string; value: number; min: number; max: number; onCommit: (value: number) => void }) {
  const [draft, setDraft] = useState(value.toFixed(3));
  const [editing, setEditing] = useState(false);
  const cancel = useRef(false);
  useEffect(() => { if (!editing) setDraft(value.toFixed(3)); }, [value, editing]);
  const commit = () => {
    if (cancel.current) {
      cancel.current = false;
      setDraft(value.toFixed(3));
      setEditing(false);
      return;
    }
    const parsed = Number(draft);
    if (draft.trim() && Number.isFinite(parsed)) onCommit(milliseconds(clamp(parsed, min, max)));
    else setDraft(value.toFixed(3));
    setEditing(false);
  };
  return <Field label={label}><input type="number" min={min} max={max} step="0.001" value={draft} onFocus={() => setEditing(true)} onChange={(event) => setDraft(event.target.value)} onBlur={commit} onKeyDown={(event) => { if (event.key === "Enter") event.currentTarget.blur(); if (event.key === "Escape") { cancel.current = true; event.currentTarget.blur(); } }} /></Field>;
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
  onSeek,
  onSelect,
  onPlay,
  onCreate,
  onChange,
}: {
  source: MediaSource;
  clips: SourceClip[];
  selectedClipId: string | null;
  playhead: number;
  onSeek: (time: number) => void;
  onSelect: (id: string) => void;
  onPlay: (id: string) => void;
  onCreate: (time: number) => void;
  onChange: (id: string, input: Partial<SourceClip>) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const duration = Math.max(0.1, source.durationSeconds);
  const timeFromPointer = (clientX: number) => {
    const rect = ref.current!.getBoundingClientRect();
    return milliseconds(clamp(((clientX - rect.left) / rect.width) * duration, 0, duration));
  };
  const drag = (event: React.PointerEvent, clip: SourceClip, mode: "move" | "in" | "out") => {
    event.preventDefault();
    event.stopPropagation();
    onSelect(clip.id);
    const startX = event.clientX;
    let moved = false;
    const original = { inSeconds: clip.inSeconds, outSeconds: clip.outSeconds };
    const pixels = ref.current!.getBoundingClientRect().width;
    const move = (moveEvent: PointerEvent) => {
      if (mode === "move" && Math.abs(moveEvent.clientX - startX) < 4) return;
      moved = true;
      const delta = ((moveEvent.clientX - startX) / pixels) * duration;
      if (mode === "move") {
        const length = original.outSeconds - original.inSeconds;
        const nextIn = milliseconds(clamp(original.inSeconds + delta, 0, duration - length));
        onChange(clip.id, { inSeconds: nextIn, outSeconds: milliseconds(nextIn + length) });
      } else if (mode === "in") {
        onChange(clip.id, { inSeconds: milliseconds(clamp(original.inSeconds + delta, 0, original.outSeconds - 0.08)) });
      } else {
        onChange(clip.id, { outSeconds: milliseconds(clamp(original.outSeconds + delta, original.inSeconds + 0.08, duration)) });
      }
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      if (mode === "move" && !moved) onPlay(clip.id);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up, { once: true });
  };

  return (
    <div className="source-timeline-wrap">
      <div className="time-ruler">
        {Array.from({ length: 9 }, (_, index) => <span key={index} style={{ left: `${index * 12.5}%` }}>{seconds(duration * index / 8)}</span>)}
      </div>
      <div
        className="source-timeline"
        ref={ref}
        data-testid="source-timeline"
        onPointerDown={(event) => {
          if (event.target !== event.currentTarget) return;
          const time = timeFromPointer(event.clientX);
          onSeek(time);
          onCreate(time);
        }}
      >
        {clips.map((clip) => (
          <button
            key={clip.id}
            className={`clip-range ${selectedClipId === clip.id ? "selected" : ""}`}
            style={{ left: `${clip.inSeconds / duration * 100}%`, width: `${(clip.outSeconds - clip.inSeconds) / duration * 100}%`, background: clip.color }}
            onPointerDown={(event) => drag(event, clip, "move")}
            onClick={(event) => { if (event.detail === 0) { onSelect(clip.id); onPlay(clip.id); } }}
            title={`${clip.label}: ${seconds(clip.inSeconds)}–${seconds(clip.outSeconds)}`}
          >
            <span className="range-handle left" onPointerDown={(event) => drag(event, clip, "in")} />
            <span className="range-label">{clip.label}</span>
            <span className="range-handle right" onPointerDown={(event) => drag(event, clip, "out")} />
          </button>
        ))}
        <div className="source-playhead" style={{ left: `${playhead / duration * 100}%` }} />
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
  onImport,
  historyControls,
}: {
  project: SceneProject;
  update: (mutate: (draft: SceneProject) => void) => void;
  selectedSourceId: string | null;
  setSelectedSourceId: (id: string) => void;
  selectedClipId: string | null;
  setSelectedClipId: (id: string | null) => void;
  onImport: (file: File) => void;
  historyControls: React.ReactNode;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [playhead, setPlayhead] = useState(0);
  const [auditionLoop, setAuditionLoop] = useState(false);
  const auditionLoopRef = useRef(false);
  const loopPlaybackKeyRef = useRef("");
  const [loopClipId, setLoopClipId] = useState<string | null>(null);
  const [previewClipId, setPreviewClipId] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);
  const source = project.sources.find((candidate) => candidate.id === selectedSourceId) ?? project.sources[0];
  const clips = project.clips.filter((clip) => clip.sourceId === source?.id);
  const selectedClip = clips.find((clip) => clip.id === selectedClipId) ?? clips[0] ?? null;
  const loopClip = clips.find((clip) => clip.id === loopClipId);
  const previewClip = clips.find((clip) => clip.id === previewClipId);

  useEffect(() => {
    setPreviewClipId(null);
    setPlaying(false);
    const firstClip = project.clips.find((clip) => clip.sourceId === source?.id);
    setLoopClipId(firstClip?.id ?? null);
    const inPoint = firstClip?.inSeconds ?? 0;
    setPlayhead(inPoint);
    if (videoRef.current) {
      videoRef.current.pause();
      videoRef.current.currentTime = inPoint;
    }
  }, [source?.id]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    let frame = 0;
    const paint = () => {
      setPlayhead(video.currentTime);
      if (!video.paused && !video.ended) frame = requestAnimationFrame(paint);
    };
    const start = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(paint);
    };
    const stop = () => {
      cancelAnimationFrame(frame);
      setPlayhead(video.currentTime);
    };
    const sync = () => setPlayhead(video.currentTime);
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

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !previewClip || auditionLoop) return;
    let frame = 0;
    const stopAtOut = () => {
      if (auditionLoopRef.current) return;
      if (video.currentTime >= previewClip.outSeconds - 0.02) {
        video.pause();
        video.currentTime = previewClip.outSeconds;
        setPlayhead(previewClip.outSeconds);
        return;
      }
      if (!video.paused) frame = requestAnimationFrame(stopAtOut);
    };
    const start = () => { frame = requestAnimationFrame(stopAtOut); };
    video.addEventListener("play", start);
    if (!video.paused) start();
    return () => {
      cancelAnimationFrame(frame);
      video.removeEventListener("play", start);
    };
  }, [previewClip?.id, previewClip?.outSeconds, auditionLoop]);

  const changeClip = (id: string, input: Partial<SourceClip>) => update((draft) => {
    const clip = draft.clips.find((candidate) => candidate.id === id);
    if (clip) Object.assign(clip, input);
  });
  const createAt = (at: number) => {
    if (!source) return;
    setPreviewClipId(null);
    const start = milliseconds(clamp(at, 0, Math.max(0, source.durationSeconds - 0.25)));
    const clip = makeClip(project, source.id, start, milliseconds(Math.min(source.durationSeconds, start + 2)));
    update((draft) => draft.clips.push(clip));
    setSelectedClipId(clip.id);
    if (auditionLoop) setLoopClipId(clip.id);
  };
  const seek = (time: number) => {
    setPlayhead(time);
    if (videoRef.current) videoRef.current.currentTime = time;
  };
  const selectClip = (id: string) => {
    videoRef.current?.pause();
    setSelectedClipId(id);
    const clip = clips.find((candidate) => candidate.id === id);
    if (clip) seek(clip.inSeconds);
  };
  const playClip = (id: string) => {
    if (auditionLoop) {
      setPreviewClipId(null);
      setLoopClipId(id);
    } else setPreviewClipId(id);
    void videoRef.current?.play();
  };
  const togglePlayback = () => {
    const video = videoRef.current;
    if (!video) return;
    if (!video.paused) {
      video.pause();
      return;
    }
    const clip = clips.find((candidate) => candidate.id === previewClipId);
    if (clip && (video.currentTime < clip.inSeconds || video.currentTime >= clip.outSeconds - 0.02)) seek(clip.inSeconds);
    if (auditionLoop && loopClip && (video.currentTime < loopClip.inSeconds || video.currentTime >= loopClip.outSeconds - 0.02)) seek(loopClip.inSeconds);
    void video.play();
  };
  const toggleAudition = () => {
    const video = videoRef.current;
    if (!video) return;
    if (auditionLoop) {
      auditionLoopRef.current = false;
      loopPlaybackKeyRef.current = "";
      setAuditionLoop(false);
      const clip = loopClip ?? selectedClip;
      setPreviewClipId(clip && video.currentTime >= clip.inSeconds && video.currentTime < clip.outSeconds - 0.02 ? clip.id : null);
      setLoopClipId(null);
      return;
    }
    if (!selectedClip || selectedClip.sourceId !== source?.id) return;
    setPreviewClipId(null);
    setLoopClipId(selectedClip.id);
    auditionLoopRef.current = true;
    setAuditionLoop(true);
  };

  return (
    <div className="workspace-grid sources-workspace">
      <aside className="panel source-list">
        <div className="panel-heading"><div><span className="eyebrow">Media</span><h2>Sources</h2></div><label className="button compact">＋ Import<input type="file" accept="video/*" hidden onChange={(event) => event.target.files?.[0] && onImport(event.target.files[0])} /></label></div>
        <div className="stack-list">
          {project.sources.map((item) => {
            const clipCount = project.clips.filter((clip) => clip.sourceId === item.id).length;
            return <button key={item.id} className={`list-card ${source?.id === item.id ? "selected" : ""}`} onClick={() => { setSelectedSourceId(item.id); setSelectedClipId(project.clips.find((clip) => clip.sourceId === item.id)?.id ?? null); }}><strong>{item.label}</strong><span className="source-clip-count">{clipCount} {clipCount === 1 ? "clip" : "clips"}</span><span className="source-duration">{seconds(item.durationSeconds)}{item.width && item.height ? ` · ${item.width}×${item.height}` : ""}</span></button>;
          })}
          {project.sources.length === 0 && <p className="empty">Import a long source video to begin.</p>}
        </div>
        {source?.originUrl && <div className="source-origin"><span>These are the existing edited extracts. The full film is not stored here.</span><a href={source.originUrl} target="_blank" rel="noreferrer">Original film page ↗</a></div>}
      </aside>

      <main className="panel source-editor">
        <div className="panel-heading"><div><span className="eyebrow">Sources & Clips</span><h2>{source?.label ?? "No source selected"}</h2></div>{source && <span className="timecode">{seconds(playhead)} / {seconds(source.durationSeconds)}</span>}</div>
        <div className="source-preview">
          {source ? <video
            ref={videoRef}
            src={source.file}
            controls
            onPlay={() => setPlaying(true)}
            onPause={() => setPlaying(false)}
            onEnded={(event) => {
              setPlaying(false);
              if (auditionLoop && loopClip) {
                event.currentTarget.currentTime = loopClip.inSeconds;
                void event.currentTarget.play();
              }
            }}
            onTimeUpdate={(event) => {
              setPlayhead(event.currentTarget.currentTime);
            }}
            onLoadedMetadata={(event) => {
              if (source.durationSeconds <= 0 && Number.isFinite(event.currentTarget.duration)) update((draft) => {
                const target = draft.sources.find((candidate) => candidate.id === source.id);
                if (target) target.durationSeconds = event.currentTarget.duration;
              });
            }}
          /> : <div className="empty-preview">Import a video source</div>}
        </div>
        {source && <>
          <div className="transport-row">
            <button className={`transport-icon ${playing ? "active" : ""}`} aria-label={playing ? "Pause" : "Play"} title={playing ? "Pause" : "Play"} aria-pressed={playing} onClick={togglePlayback}>{playing ? <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 4v16M17 4v16" /></svg> : <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m8 4 12 8-12 8z" /></svg>}</button>
            <button className="transport-icon" aria-label="Cut clip here" title="Cut clip here" onClick={() => createAt(playhead)}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4v16M4 12h16" /></svg></button>
            <button className={`transport-icon ${auditionLoop ? "active" : ""}`} aria-label={auditionLoop ? "Stop audition" : "Loop audition"} title={auditionLoop ? "Stop audition" : "Loop audition"} aria-pressed={auditionLoop} disabled={!selectedClip && !auditionLoop} onClick={toggleAudition}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 9V5h-4M4 15v4h4M20 5l-3 3a7 7 0 0 0-11.5 2M4 19l3-3a7 7 0 0 0 11.5-2" /></svg></button>
            {selectedClip && <><button onClick={() => changeClip(selectedClip.id, { inSeconds: Math.min(playhead, selectedClip.outSeconds - 0.08) })}>Set in</button><button onClick={() => changeClip(selectedClip.id, { outSeconds: Math.max(playhead, selectedClip.inSeconds + 0.08) })}>Set out</button></>}
          </div>
          <SourceTimeline source={source} clips={clips} selectedClipId={selectedClip?.id ?? null} playhead={playhead} onSeek={seek} onCreate={createAt} onSelect={selectClip} onPlay={playClip} onChange={changeClip} />
        </>}
      </main>

      <aside className="panel inspector">
        {historyControls}
        <div className="panel-heading"><div><span className="eyebrow">Reusable ranges</span><h2>Clip bin</h2></div></div>
        <div className="clip-bin">
          {clips.map((clip) => <button key={clip.id} className={`clip-card ${selectedClipId === clip.id ? "selected" : ""}`} style={{ borderLeftColor: clip.color }} onClick={() => { selectClip(clip.id); playClip(clip.id); }}><strong>{clip.label}</strong><span>{seconds(clip.inSeconds)}–{seconds(clip.outSeconds)}</span></button>)}
        </div>
        {selectedClip && <div className="inspector-fields">
          <h3>Clip settings</h3>
          <Field label="Name"><input value={selectedClip.label} onChange={(event) => changeClip(selectedClip.id, { label: event.target.value })} /></Field>
          <div className="field-row"><ClipTimeInput key={`${selectedClip.id}-in`} label="In" value={selectedClip.inSeconds} min={0} max={Math.max(0, selectedClip.outSeconds - 0.001)} onCommit={(value) => changeClip(selectedClip.id, { inSeconds: value })} /><ClipTimeInput key={`${selectedClip.id}-out`} label="Out" value={selectedClip.outSeconds} min={selectedClip.inSeconds + 0.001} max={source?.durationSeconds ?? selectedClip.outSeconds} onCommit={(value) => changeClip(selectedClip.id, { outSeconds: value })} /></div>
          <Field label="End behavior"><select value={selectedClip.defaultEndBehavior} onChange={(event) => changeClip(selectedClip.id, { defaultEndBehavior: event.target.value as "loop" | "hold" })}><option value="loop">Loop source range</option><option value="hold">Hold last frame</option></select></Field>
          <Field label="Color"><div className="color-row">{CLIP_COLORS.map((color) => <button key={color} aria-label={`Use ${color}`} className={selectedClip.color === color ? "selected" : ""} style={{ background: color }} onClick={() => changeClip(selectedClip.id, { color })} />)}</div></Field>
          <button className="danger" onClick={() => { update((draft) => { draft.clips = draft.clips.filter((clip) => clip.id !== selectedClip.id); for (const loop of draft.visualLoops) loop.events = loop.events.filter((event) => event.clipId !== selectedClip.id); }); setSelectedClipId(null); }}>Delete clip</button>
        </div>}
      </aside>
    </div>
  );
}

function previewMotionTransform(motion: NonNullable<LoopEvent["appearance"]["motion"]> | undefined, progress: number): string {
  if (!motion) return "none";
  const normalized = clamp(progress * (motion.speed ?? 1), 0, 1);
  const time = motion.easing === "linear" ? normalized : normalized * normalized * (3 - 2 * normalized);
  const scale = motion.start.scale + (motion.end.scale - motion.start.scale) * time;
  const focusX = motion.start.focus.x + (motion.end.focus.x - motion.start.focus.x) * time;
  const focusY = motion.start.focus.y + (motion.end.focus.y - motion.start.focus.y) * time;
  const maximumShift = Math.max(0, (scale - 1) / 2);
  const translateX = clamp((0.5 - focusX) * scale, -maximumShift, maximumShift) * 100;
  const translateY = clamp((0.5 - focusY) * scale, -maximumShift, maximumShift) * 100;
  return `translate3d(${translateX.toFixed(3)}%, ${translateY.toFixed(3)}%, 0) scale(${scale.toFixed(4)})`;
}

function PreviewEvent({ event, project, loopBeat, bpm, playing, layered = false }: { event: LoopEvent; project: SceneProject; loopBeat: number; bpm: number; playing: boolean; layered?: boolean }) {
  const ref = useRef<HTMLVideoElement>(null);
  const clip = project.clips.find((candidate) => candidate.id === event.clipId);
  const source = project.sources.find((candidate) => candidate.id === clip?.sourceId);
  const elapsedBeats = loopBeat - eventStart(event);
  const rangeStart = (clip?.inSeconds ?? 0) + event.source.offsetSeconds;
  const rangeLength = Math.max(0.04, (clip?.outSeconds ?? 0.04) - rangeStart);
  const wantedTime = event.source.endBehavior === "loop"
    ? rangeStart + ((Math.max(0, elapsedBeats) * 60 / bpm * event.source.rate) % rangeLength)
    : Math.min((clip?.outSeconds ?? rangeStart) - 0.04, rangeStart + Math.max(0, elapsedBeats) * 60 / bpm * event.source.rate);

  useEffect(() => {
    const video = ref.current;
    if (!video) return;
    if (Number.isFinite(wantedTime) && Math.abs(video.currentTime - wantedTime) > 0.28) video.currentTime = wantedTime;
    video.playbackRate = event.source.rate;
    if (playing) video.play().catch(() => {}); else video.pause();
  }, [wantedTime, playing, event.source.rate]);

  if (!clip || !source) return null;
  const filters = event.appearance.filters.map((filter) => {
    if (filter.type === "hue-rotate") return `hue-rotate(${filter.degrees}deg)`;
    return `${filter.type}(${filter.amount})`;
  }).join(" ") || "none";
  const progress = clamp(elapsedBeats / Math.max(0.001, eventDuration(event)), 0, 1);
  const envelope = event.appearance.opacityEnvelope;
  const opacity = event.appearance.opacity * (envelope ? envelope.from + (envelope.to - envelope.from) * progress : 1);
  return <video ref={ref} data-event-id={event.id} src={source.file} muted playsInline preload="auto" style={{ zIndex: layered ? 1000 - laneOf(event) : 0, opacity, objectFit: event.appearance.fit, mixBlendMode: event.appearance.blendMode, filter: filters, transform: previewMotionTransform(event.appearance.motion, progress) }} />;
}

function LoopPreview({ project, loop, selectedEventId, onMotionTargetChange }: { project: SceneProject; loop: VisualLoop | undefined; selectedEventId?: string | null; onMotionTargetChange?: (focus: { x: number; y: number }) => void }) {
  const [playing, setPlaying] = useState(false);
  const [beat, setBeat] = useState(0);
  const anchor = useRef({ at: performance.now(), beat: 0 });
  const previewRef = useRef<HTMLDivElement>(null);
  const length = Math.max(0.25, beatsFromMusical(loop?.length));

  useEffect(() => {
    if (!playing) return;
    let frame = 0;
    const tick = (now: number) => {
      setBeat((anchor.current.beat + (now - anchor.current.at) / 1000 * project.previewBpm / 60) % length);
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [playing, project.previewBpm, length]);
  const setTransport = () => {
    if (playing) setPlaying(false);
    else { anchor.current = { at: performance.now(), beat }; setPlaying(true); }
  };
  const seekBeat = (position: number) => {
    const next = clamp(position, 0, Math.max(0, length - 0.001));
    setBeat(next);
    anchor.current = { at: performance.now(), beat: next };
  };
  const scrubAt = (clientX: number, element: HTMLDivElement) => {
    const rect = element.getBoundingClientRect();
    seekBeat((clientX - rect.left) / rect.width * length);
  };
  const candidates = loop?.events.filter((event) => beat >= eventStart(event) && beat < eventStart(event) + eventDuration(event)) ?? [];
  const topLane = Math.min(...candidates.map(laneOf));
  const layered = loop?.compositing === "layers";
  const active = layered ? candidates : candidates.filter((event) => laneOf(event) === topLane).slice(0, 1);
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
    <div ref={previewRef} className={`loop-preview ${target ? "has-motion-target" : ""}`} onPointerDown={(event) => target && updateTarget(event.clientX, event.clientY)}>{active.map((event) => <PreviewEvent key={event.id} event={event} project={project} loopBeat={beat} bpm={project.previewBpm} playing={playing} layered={layered} />)}{active.length === 0 && <div className="empty-preview">Drop clips onto the loop timeline</div>}{target && <button className="motion-target" type="button" aria-label="Pan and zoom target" title="Drag the pan and zoom target" style={{ left: `${target.x * 100}%`, top: `${target.y * 100}%` }} onPointerDown={dragTarget}><span /></button>}</div>
    <div className="preview-transport"><div><button aria-label={playing ? "Pause preview" : "Play preview"} onClick={setTransport}>{playing ? "❚❚" : "▶"}</button><button aria-label="Reset preview" onClick={() => { setPlaying(false); seekBeat(0); }}>↺</button></div><strong>Bar {Math.floor(beat / 4) + 1} · Beat {(beat % 4 + 1).toFixed(2)}</strong></div>
    <div className="preview-scrub" data-testid="preview-scrub" role="slider" tabIndex={0} aria-label="Video timeline" aria-valuemin={0} aria-valuemax={length} aria-valuenow={beat} onPointerDown={(event) => { event.currentTarget.setPointerCapture(event.pointerId); scrubAt(event.clientX, event.currentTarget); }} onPointerMove={(event) => { if (event.buttons) scrubAt(event.clientX, event.currentTarget); }} onKeyDown={(event) => { if (event.key === "ArrowLeft" || event.key === "ArrowRight") { event.preventDefault(); seekBeat(beat + (event.key === "ArrowRight" ? 0.25 : -0.25)); } }}>
      {Array.from({ length: Math.ceil(length / 4) + 1 }, (_, bar) => <i key={bar} style={{ left: `${Math.min(100, bar * 4 / length * 100)}%` }} />)}
      <span className="preview-scrub-progress" style={{ width: `${beat / length * 100}%` }} />
      <span className="preview-scrub-head" style={{ left: `${beat / length * 100}%` }} />
    </div>
  </div>;
}

function LoopTimeline({ project, loop, selectedEventId, onSelect, update, reorderLane, placementError, setPlacementError }: { project: SceneProject; loop: VisualLoop; selectedEventId: string | null; onSelect: (id: string) => void; update: (mutate: (draft: SceneProject) => void) => void; reorderLane: (from: number, to: number) => void; placementError: string; setPlacementError: (value: string) => void }) {
  const ref = useRef<HTMLDivElement>(null);
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

  return <div className="loop-timeline-shell">
    <div className="beat-ruler">{Array.from({ length: Math.ceil(totalBeats / 4) }, (_, bar) => <span key={bar} style={{ left: `${bar * 4 / totalBeats * 100}%` }}>Bar {bar + 1}</span>)}{placementError && <span className="placement-error" role="status">{placementError}</span>}</div>
    <div className="loop-lane-rail" style={{ height: `${20 + laneCount * rowHeight}px` }}>
      {Array.from({ length: laneCount }, (_, lane) => <button key={lane} type="button" draggable data-lane-order={lane} className={`loop-lane-handle ${draggedLane === lane ? "dragging" : ""}`} style={{ top: `${8 + lane * rowHeight}px`, height: `${rowHeight}px` }} aria-label={`Drag lane ${lane + 1} to reorder`} title={`Drag lane ${lane + 1} to reorder`} onDragStart={(event) => { event.dataTransfer.effectAllowed = "move"; event.dataTransfer.setData("application/x-video-sync-lane", String(lane)); setDraggedLane(lane); }} onDragOver={(event) => { if (event.dataTransfer.types.includes("application/x-video-sync-lane")) event.preventDefault(); }} onDrop={(event) => { event.preventDefault(); event.stopPropagation(); const from = Number(event.dataTransfer.getData("application/x-video-sync-lane")); reorderLane(from, lane); setDraggedLane(null); }} onDragEnd={() => setDraggedLane(null)}><span className="grip-dots" aria-hidden="true">{Array.from({ length: 6 }, (_, dot) => <i key={dot} />)}</span><small>{lane + 1}</small></button>)}
    </div>
    <div ref={ref} className="loop-timeline" data-testid="loop-timeline" style={{ height: `${20 + laneCount * rowHeight}px` }} onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); const clipId = event.dataTransfer.getData("application/x-video-sync-clip"); if (clipId) addClip(clipId, event.clientX, event.clientY); }}>
      {Array.from({ length: Math.ceil(totalBeats) + 1 }, (_, index) => <i key={index} className={index % 4 === 0 ? "bar-line" : "beat-line"} style={{ left: `${index / totalBeats * 100}%` }} />)}
      {Array.from({ length: laneCount }, (_, lane) => <div key={lane} className="loop-lane" style={{ top: `${8 + lane * rowHeight}px`, height: `${rowHeight}px` }} />)}
      {loop.events.map((event) => {
        const clip = project.clips.find((candidate) => candidate.id === event.clipId);
        const placement = dragPreview?.id === event.id ? dragPreview.placement : eventPlacement(event);
        return <button key={event.id} data-event-id={event.id} data-lane={placement.lane} className={`loop-event ${selectedEventId === event.id ? "selected" : ""} ${dragPreview?.id === event.id && !dragPreview.valid ? "invalid" : ""}`} style={{ left: `${placement.at / totalBeats * 100}%`, width: `${placement.duration / totalBeats * 100}%`, top: `${12 + placement.lane * rowHeight}px`, background: clip?.color }} onPointerDown={(pointer) => drag(pointer, event, "move")} onClick={() => onSelect(event.id)}><span className="range-handle left" onPointerDown={(pointer) => drag(pointer, event, "start")} /><span>{clip?.label ?? event.clipId}</span><span className="range-handle right" onPointerDown={(pointer) => drag(pointer, event, "end")} /></button>;
      })}
    </div>
  </div>;
}

function LoopsWorkspace({ project, update, selectedLoopId, setSelectedLoopId, selectedEventId, setSelectedEventId, historyControls }: { project: SceneProject; update: (mutate: (draft: SceneProject) => void) => void; selectedLoopId: string; setSelectedLoopId: (id: string) => void; selectedEventId: string | null; setSelectedEventId: (id: string | null) => void; historyControls: React.ReactNode }) {
  const loop = project.visualLoops.find((candidate) => candidate.id === selectedLoopId) ?? project.visualLoops[0];
  const selectedEvent = loop?.events.find((event) => event.id === selectedEventId) ?? null;
  const selectedClip = project.clips.find((clip) => clip.id === selectedEvent?.clipId);
  const [placementError, setPlacementError] = useState("");
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

  return <div className="workspace-grid loops-workspace">
    <aside className="panel loop-list">
      <div className="panel-heading"><div><span className="eyebrow">Beat-synced edits</span><h2>Video loops</h2></div><IconButton title="Add loop" onClick={addLoop}>＋</IconButton></div>
      <div className="stack-list">{project.visualLoops.map((item) => <button key={item.id} className={`list-card ${item.id === loop?.id ? "selected" : ""}`} onClick={() => { setSelectedLoopId(item.id); setSelectedEventId(null); }}><strong>{item.name}</strong><span>{beatsFromMusical(item.length) / 4} bars · {item.events.length} events</span></button>)}</div>
    </aside>
    <main className="panel loop-editor">
      <div className="panel-heading"><div><span className="eyebrow">Loop Builder</span><h2>{loop?.name}</h2></div>{loop && <div className="inline-fields"><Field label="Bars"><input type="number" min="0.25" step="0.25" value={beatsFromMusical(loop.length) / 4} onChange={(event) => changeLoop({ length: { bars: Math.max(0.25, Number(event.target.value)) } })} /></Field></div>}</div>
      {loop && <>
        <LoopPreview project={project} loop={loop} selectedEventId={selectedEventId} onMotionTargetChange={changeMotionFocus} />
        <LoopTimeline project={project} loop={loop} selectedEventId={selectedEventId} onSelect={setSelectedEventId} update={update} reorderLane={reorderLane} placementError={placementError} setPlacementError={setPlacementError} />
        <div className="clip-strip"><span>Drag a clip into the timeline</span>{project.clips.map((clip) => <button key={clip.id} draggable onDragStart={(event) => event.dataTransfer.setData("application/x-video-sync-clip", clip.id)} style={{ borderColor: clip.color }} onDoubleClick={() => { const created = makeEvent(project, loop, clip.id); update((draft) => draft.visualLoops.find((item) => item.id === loop.id)?.events.push(created)); setSelectedEventId(created.id); }}>{clip.label}</button>)}</div>
      </>}
    </main>
    <aside className="panel inspector">
      {historyControls}
      <div className="panel-heading"><div><span className="eyebrow">Selected item</span><h2>Inspector</h2></div></div>
      {loop && <div className="inspector-fields">
        <Field label="Loop name"><input value={loop.name} onChange={(event) => changeLoop({ name: event.target.value })} /></Field>
        <Field label="Visibility"><select value={loop.compositing ?? "top"} onChange={(event) => changeLoop({ compositing: event.target.value === "layers" ? "layers" : undefined })}><option value="top">Top occupied lane</option><option value="layers">Layered blend</option></select></Field>
        {selectedEvent ? <>
          <h3>Clip instance</h3>
          <Field label="Clip"><select value={selectedEvent.clipId} onChange={(event) => changeEvent({ clipId: event.target.value })}>{project.clips.map((clip) => <option key={clip.id} value={clip.id}>{clip.label}</option>)}</select></Field>
          <div className="field-row"><Field label="Start beat"><input type="number" min="0" step="0.25" value={eventStart(selectedEvent)} onChange={(event) => changeEvent({ at: musicalFromBeats(Number(event.target.value)) })} /></Field><Field label="Duration"><input type="number" min="0.25" step="0.25" value={eventDuration(selectedEvent)} onChange={(event) => changeEvent({ duration: musicalFromBeats(Number(event.target.value)) })} /></Field></div>
          <div className="field-row"><Field label="Source offset"><input type="number" min="0" step="0.1" value={selectedEvent.source.offsetSeconds} onChange={(event) => changeEvent({ source: { ...selectedEvent.source, offsetSeconds: Number(event.target.value) } })} /></Field><Field label="Playback speed"><input type="number" min="0.1" max="4" step="0.1" value={selectedEvent.source.rate} onChange={(event) => changeEvent({ source: { ...selectedEvent.source, rate: Number(event.target.value) } })} /></Field></div>
          <Field label="End behavior"><select value={selectedEvent.source.endBehavior} onChange={(event) => changeEvent({ source: { ...selectedEvent.source, endBehavior: event.target.value as "loop" | "hold" } })}><option value="loop">Loop clip range</option><option value="hold">Hold last frame</option></select></Field>
          <Field label="Opacity"><input type="number" min="0" max="1" step="0.05" value={selectedEvent.appearance.opacity} onChange={(event) => changeEvent({ appearance: { ...selectedEvent.appearance, opacity: Number(event.target.value) } })} /></Field>
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

function CuesWorkspace({ project, update, selectedLoopId, setSelectedLoopId, historyControls }: { project: SceneProject; update: (mutate: (draft: SceneProject) => void) => void; selectedLoopId: string; setSelectedLoopId: (id: string) => void; historyControls: React.ReactNode }) {
  const selected = project.visualLoops.find((loop) => loop.id === selectedLoopId) ?? project.visualLoops[0];
  return <div className="cue-workspace"><section className="panel cue-preview"><div className="panel-heading"><div><span className="eyebrow">Cue Map</span><h2>Performance preview</h2></div><Field label="Preview BPM"><input type="number" min="20" max="300" step="0.01" value={project.previewBpm} onChange={(event) => update((draft) => { draft.previewBpm = Number(event.target.value); })} /></Field></div><LoopPreview project={project} loop={selected} /></section><section className="panel cue-map">{historyControls}<div className="default-cue"><div><span className="cue-key">▶</span><div><strong>Default</strong><small>Plays until a hot cue becomes active</small></div></div><select value={project.defaultLoopId} onChange={(event) => { update((draft) => { draft.defaultLoopId = event.target.value; }); setSelectedLoopId(event.target.value); }}>{project.visualLoops.map((loop) => <option key={loop.id} value={loop.id}>{loop.name}</option>)}</select></div><div className="cue-grid">{CUE_LETTERS.map((letter) => { const binding = project.cueBindings.find((item) => item.input === `hotCue${letter}`)!; return <article key={letter} className={binding.loopId === selectedLoopId ? "active" : ""}><button className="cue-key" onClick={() => binding.loopId && setSelectedLoopId(binding.loopId)}>{letter}</button><Field label="Video loop"><select value={binding.loopId ?? ""} onChange={(event) => { update((draft) => { const target = draft.cueBindings.find((item) => item.input === `hotCue${letter}`); if (target) target.loopId = event.target.value || null; }); if (event.target.value) setSelectedLoopId(event.target.value); }}><option value="">Random fallback</option>{project.visualLoops.map((loop) => <option key={loop.id} value={loop.id}>{loop.name}</option>)}</select></Field><div className="segmented"><button className={binding.cueType === "loop" ? "active" : ""} onClick={() => update((draft) => { draft.cueBindings.find((item) => item.input === `hotCue${letter}`)!.cueType = "loop"; })}>Loop cue</button><button className={binding.cueType === "jump" ? "active" : ""} onClick={() => update((draft) => { draft.cueBindings.find((item) => item.input === `hotCue${letter}`)!.cueType = "jump"; })}>One-shot cue</button></div></article>; })}</div></section></div>;
}

export function App() {
  const restoredSession = useMemo(readStudioSession, []);
  const restoredDraft = restoredSession?.drafts[restoredSession.activeSceneId];
  const initialProject = useMemo(() => restoredDraft?.project ?? catalogProject(DEFAULT_SCENE_ID), []);
  const history = useProjectHistory(initialProject);
  const { project, update, replace, undo, redo, canUndo, canRedo, undoDescription, redoDescription } = history;
  const [workspace, setWorkspace] = useState<Workspace>(restoredSession?.workspace ?? "clips");
  const [selectedSourceId, setSelectedSourceId] = useState<string | null>(restoredDraft?.selectedSourceId ?? project.sources[0]?.id ?? null);
  const [selectedClipId, setSelectedClipId] = useState<string | null>(restoredDraft?.selectedClipId ?? project.clips[0]?.id ?? null);
  const [selectedLoopId, setSelectedLoopId] = useState(restoredDraft?.selectedLoopId ?? project.defaultLoopId);
  const [selectedEventId, setSelectedEventId] = useState<string | null>(restoredDraft?.selectedEventId ?? null);
  const [status, setStatus] = useState(restoredDraft ? `Local session restored · ${project.name}` : "Catalog scene loaded · Save to preserve edits");
  const [savedProjects, setSavedProjects] = useState<Array<{ id: string; name: string; updatedAt: string }>>([]);
  const [busy, setBusy] = useState(false);
  const [dirty, setDirty] = useState(restoredDraft?.dirty ?? false);
  const [hasSaved, setHasSaved] = useState(restoredDraft?.hasSaved ?? false);
  const [hydrated, setHydrated] = useState(Boolean(restoredSession));
  const [scenePickerOpen, setScenePickerOpen] = useState(false);
  const drafts = useRef(new Map<string, StudioDraft>(Object.entries(restoredSession?.drafts ?? {})));
  const hasInteracted = useRef(false);
  const switchToken = useRef(0);
  const currentDraft = (overrides: Partial<StudioDraft> = {}): StudioDraft => ({
    project, dirty, hasSaved, selectedSourceId, selectedClipId, selectedLoopId, selectedEventId, ...overrides,
  });
  const editProject = (mutate: (draft: SceneProject) => void) => { hasInteracted.current = true; setDirty(true); update(mutate); };
  const performUndo = () => { if (!canUndo) return; hasInteracted.current = true; setDirty(true); undo(); };
  const performRedo = () => { if (!canRedo) return; hasInteracted.current = true; setDirty(true); redo(); };
  const openProject = (loaded: SceneProject, saved: boolean, message: string, draft?: StudioDraft) => {
    const { project: expanded, migrated } = migrateLegacyDefaultClipRanges(loaded);
    replace(normalizeProjectLanes(expanded));
    setSelectedSourceId(draft?.selectedSourceId ?? expanded.sources[0]?.id ?? null);
    setSelectedClipId(draft?.selectedClipId ?? expanded.clips[0]?.id ?? null);
    setSelectedLoopId(draft?.selectedLoopId ?? expanded.defaultLoopId);
    setSelectedEventId(draft?.selectedEventId ?? null);
    setHasSaved(saved);
    setDirty(migrated || Boolean(draft?.dirty));
    setStatus(migrated ? `${message} · Default clip ranges expanded; save to keep` : message);
  };

  const refreshProjects = () => listProjects().then(setSavedProjects).catch(() => setSavedProjects([]));
  useEffect(() => {
    void refreshProjects();
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
      writeStudioSession({ v: 1, activeSceneId: project.id, workspace, drafts: allDrafts });
    };
    persist();
    window.addEventListener("pagehide", persist);
    return () => window.removeEventListener("pagehide", persist);
  }, [hydrated, project, dirty, hasSaved, workspace, selectedSourceId, selectedClipId, selectedLoopId, selectedEventId]);
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
    setBusy(true);
    try { await saveProject(project); drafts.current.set(project.id, currentDraft({ dirty: false, hasSaved: true })); setHasSaved(true); setDirty(false); await publishProject(project, compileRuntimeScene(project)); setStatus("Published for Live Console · reload it to use this scene"); await refreshProjects(); }
    catch (error) { setStatus(error instanceof Error ? error.message : "Publish failed"); }
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
        if (token === switchToken.current) openProject(catalogProject(id), false, `Catalog scene loaded · Save to preserve edits`);
      }
    } catch (error) { if (token === switchToken.current) setStatus(error instanceof Error ? error.message : "Open failed"); }
    finally { if (token === switchToken.current) setBusy(false); }
  };

  const historyControls = <HistoryControls canUndo={canUndo} canRedo={canRedo} undoDescription={undoDescription} redoDescription={redoDescription} onUndo={performUndo} onRedo={performRedo} />;
  const workspaceContent = workspace === "clips"
    ? <SourcesWorkspace project={project} update={editProject} selectedSourceId={selectedSourceId} setSelectedSourceId={setSelectedSourceId} selectedClipId={selectedClipId} setSelectedClipId={setSelectedClipId} onImport={handleImport} historyControls={historyControls} />
    : workspace === "loops"
      ? <LoopsWorkspace project={project} update={editProject} selectedLoopId={selectedLoopId} setSelectedLoopId={setSelectedLoopId} selectedEventId={selectedEventId} setSelectedEventId={setSelectedEventId} historyControls={historyControls} />
      : <CuesWorkspace project={project} update={editProject} selectedLoopId={selectedLoopId} setSelectedLoopId={setSelectedLoopId} historyControls={historyControls} />;

  return <div className="app-shell">
    <header className="app-header">
      <a className="brand" href="/poc/"><span className="brand-mark">VS</span><div><strong>Scene Studio</strong><small>Video Sync authoring</small></div></a>
      <nav className="workspace-tabs">{(["clips", "loops", "cues"] as Workspace[]).map((item, index) => <button key={item} className={workspace === item ? "active" : ""} onClick={() => setWorkspace(item)}><span>{index + 1}</span>{item === "clips" ? "Sources & Clips" : item === "loops" ? "Loop Builder" : "Cue Map"}</button>)}</nav>
      <div className="scene-current">
        <input className="project-name" aria-label="Scene title" title="Edit scene title" value={project.name} disabled={busy} onChange={(event) => editProject((draft) => { draft.name = event.target.value; })} />
        <button className="scene-open" type="button" aria-label="Change scene" title="Change scene" onClick={() => setScenePickerOpen(true)}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M4 7h15m0 0-4-4m4 4-4 4M20 17H5m0 0 4-4m-4 4 4 4" /></svg></button>
      </div>
      <div className="header-actions"><button onClick={() => void load(project.id, true)} disabled={busy || !hasSaved}>Reload saved</button><button onClick={() => void handleSave()} disabled={busy}>Save</button><button className="primary" onClick={() => void handlePublish()} disabled={busy}>Publish</button></div>
    </header>
    <div className="status-bar"><span className={busy ? "busy-dot" : dirty ? "unsaved-dot" : "status-dot"} />{dirty ? "Unsaved edits · " : ""}{status}<span className="status-spacer" /><span>{project.sources.length} sources · {project.clips.length} clips · {project.visualLoops.length} loops</span></div>
    {workspaceContent}
    {scenePickerOpen && <SceneChooser currentId={project.id} currentName={project.name} savedProjects={savedProjects} onSelect={(id) => { setScenePickerOpen(false); void load(id); }} onClose={() => setScenePickerOpen(false)} />}
  </div>;
}
