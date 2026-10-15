import type { SceneProject, Workspace } from "./types";

const STORAGE_KEY = "video-sync-studio-session-v1";

export type StudioDraft = {
  project: SceneProject;
  dirty: boolean;
  hasSaved: boolean;
  selectedSourceId: string | null;
  selectedClipId: string | null;
  selectedLoopId: string;
  selectedEventId: string | null;
  sourcePlayheads?: Record<string, number>;
  loopPreviewBeat?: number;
};

export type StudioSession = {
  v: 1;
  activeSceneId: string;
  workspace: Workspace;
  drafts: Record<string, StudioDraft>;
  settings?: { sourceMuted: boolean; auditionLoop: boolean };
  prepared?: { projectId: string; signature: string; media: Record<string, { file: string; durationSeconds: number }> };
};

export function readStudioSession(): StudioSession | null {
  try {
    const value = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null");
    if (value?.v !== 1 || typeof value.activeSceneId !== "string" || !value.drafts || typeof value.drafts !== "object") return null;
    const drafts: Record<string, StudioDraft> = {};
    for (const [id, draft] of Object.entries(value.drafts) as Array<[string, StudioDraft]>) {
      if (draft?.project?.id !== id || draft.project.projectVersion !== 1 || draft.project.schemaVersion !== 5
        || !Array.isArray(draft.project.sources) || !Array.isArray(draft.project.clips)
        || !Array.isArray(draft.project.visualLoops)) continue;
      drafts[id] = draft;
    }
    if (!drafts[value.activeSceneId]) return null;
    const workspace: Workspace = value.workspace === "cues" || value.workspace === "loops" ? "loops" : "clips";
    const settings = value.settings && typeof value.settings.sourceMuted === "boolean" && typeof value.settings.auditionLoop === "boolean"
      ? { sourceMuted: value.settings.sourceMuted, auditionLoop: value.settings.auditionLoop }
      : undefined;
    const prepared = value.prepared;
    return { v: 1, activeSceneId: value.activeSceneId, workspace, drafts,
      ...(settings ? { settings } : {}),
      ...(prepared && typeof prepared.projectId === "string" && typeof prepared.signature === "string" && prepared.media && typeof prepared.media === "object"
        ? { prepared } : {}),
    };
  } catch {
    return null;
  }
}

export function writeStudioSession(session: StudioSession): boolean {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
    return true;
  } catch {
    return false;
  }
}
