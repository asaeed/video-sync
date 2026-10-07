export type Workspace = "clips" | "loops" | "cues";

export type MusicalTime = {
  bars?: number;
  beats?: number;
};

export type Point = {
  x: number;
  y: number;
};

export type MediaSource = {
  id: string;
  label: string;
  file: string;
  fileName: string;
  durationSeconds: number;
  width?: number;
  height?: number;
  fps?: number;
  originUrl?: string;
};

export type SourceClip = {
  id: string;
  sourceId: string;
  label: string;
  inSeconds: number;
  outSeconds: number;
  color: string;
  subjectFocus?: Point;
  defaultEndBehavior: "loop" | "hold";
};

export type VideoFilter =
  | { type: "grayscale" | "invert" | "contrast"; amount: number }
  | { type: "hue-rotate"; degrees: number };

export type KenBurnsMotion = {
  type: "ken-burns";
  focusSource?: "clip-subject";
  progress: "event" | "loop";
  easing: "linear" | "ease-in-out";
  speed?: number;
  start: { scale: number; focus: Point };
  end: { scale: number; focus: Point };
};

export type LoopEvent = {
  id: string;
  clipId: string;
  lane?: number;
  at: MusicalTime;
  duration: MusicalTime;
  source: {
    offsetSeconds: number;
    rate: number;
    endBehavior: "loop" | "hold";
  };
  appearance: {
    z: number;
    opacity: number;
    blendMode: "normal" | "screen" | "multiply" | "plus-lighter";
    fit: "cover" | "contain";
    filters: VideoFilter[];
    opacityEnvelope?: { from: number; to: number; curve: "linear" };
    motion?: KenBurnsMotion;
  };
};

export type VisualLoop = {
  id: string;
  name: string;
  length: MusicalTime;
  repeat: true;
  compositing?: "layers";
  events: LoopEvent[];
};

export type CueBinding = {
  input: `hotCue${"A" | "B" | "C" | "D" | "E" | "F" | "G" | "H"}`;
  loopId: string | null;
  cueType: "loop" | "jump";
};

export type SceneProject = {
  projectVersion: 1;
  schemaVersion: 5;
  id: string;
  name: string;
  style?: string;
  source?: string;
  sourcePage?: string;
  group?: string;
  previewBpm: number;
  createdAt: string;
  updatedAt: string;
  sources: MediaSource[];
  clips: SourceClip[];
  visualLoops: VisualLoop[];
  defaultLoopId: string;
  cueBindings: CueBinding[];
  randomLoop?: RuntimeScene["randomLoop"];
  advance?: RuntimeScene["advance"];
};

export type RuntimeScene = {
  schemaVersion: 4;
  id: string;
  name: string;
  style?: string;
  source?: string;
  sourcePage?: string;
  group?: string;
  availability: "ready";
  lanePriority: "top";
  clips: Array<{
    id: string;
    label: string;
    src: string;
    durationSeconds: number;
    startSeconds: number;
    endSeconds?: number;
    subjectFocus?: Point;
  }>;
  visualLoops: Array<{
    id: string;
    name: string;
    length: MusicalTime;
    repeat: true;
    compositing?: "layers";
    events: Array<{
      id: string;
      at: MusicalTime;
      duration: MusicalTime;
      clipId: string;
      lane: number;
      source: {
        startSeconds: number;
        endSeconds?: number;
        loop: boolean;
        rate: number;
      };
      appearance: LoopEvent["appearance"];
    }>;
  }>;
  defaultLoopId: string;
  cueBindings: Array<{
    input: CueBinding["input"];
    cue: { type: "jump" } | { type: "loop"; length: MusicalTime };
    visual: { loopId: string; retrigger: "cue-trigger" | "audio-loop-cycle" };
  }>;
  randomLoop: {
    id: "random-loop";
    recipes: Array<"sequence" | "alternate" | "flash-overlay" | "call-response" | "crossfade">;
    lengths: MusicalTime[];
    candidateClipIds: string[];
    fit: "cover" | "contain";
  };
  advance: { afterSongs: number };
};
