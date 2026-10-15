import type { RuntimeScene, SceneProject } from "./types";

const localKey = (id: string) => `video-sync-studio-project:${id}`;

async function jsonResponse<T>(response: Response): Promise<T> {
  if (!response.ok) throw new Error((await response.text()) || `${response.status} ${response.statusText}`);
  return response.json() as Promise<T>;
}

export async function listProjects(): Promise<Array<{ id: string; name: string; updatedAt: string }>> {
  try {
    return await jsonResponse(await fetch("/api/studio/projects", { cache: "no-store" }));
  } catch {
    return Object.keys(localStorage)
      .filter((key) => key.startsWith("video-sync-studio-project:"))
      .flatMap((key) => {
        try {
          const project = JSON.parse(localStorage.getItem(key) ?? "") as SceneProject;
          return [{ id: project.id, name: project.name, updatedAt: project.updatedAt }];
        } catch {
          return [];
        }
      });
  }
}

export async function loadProject(id: string): Promise<SceneProject> {
  try {
    return await jsonResponse(await fetch(`/api/studio/projects/${encodeURIComponent(id)}`, { cache: "no-store" }));
  } catch (error) {
    const saved = localStorage.getItem(localKey(id));
    if (saved) return JSON.parse(saved) as SceneProject;
    throw error;
  }
}

export async function saveProject(project: SceneProject): Promise<void> {
  const response = await fetch(`/api/studio/projects/${encodeURIComponent(project.id)}`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(project),
  });
  if (!response.ok) throw new Error((await response.text()) || "Could not save project");
  try { localStorage.setItem(localKey(project.id), JSON.stringify(project)); }
  catch { /* The server save succeeded even if browser storage is unavailable. */ }
}

export async function uploadSource(projectId: string, sourceId: string, file: File): Promise<{ file: string; fileName: string }> {
  return jsonResponse(await fetch(`/api/studio/projects/${encodeURIComponent(projectId)}/sources/${encodeURIComponent(sourceId)}`, {
    method: "PUT",
    headers: {
      "content-type": file.type || "application/octet-stream",
      "x-file-name": file.name,
    },
    body: file,
  }));
}

export type PreparedClipMedia = Record<string, { file: string; durationSeconds: number }>;
export type PreparationProgress = { completed: number; total: number; current: string | null; reused?: number };
type PreparationResult = { media: PreparedClipMedia; created: number; reused: number; removed: number; warnings: string[] };

export async function prepareClips(project: SceneProject, onProgress?: (progress: PreparationProgress) => void): Promise<PreparationResult> {
  const response = await fetch(`/api/studio/projects/${encodeURIComponent(project.id)}/prepare`, {
    method: "POST",
    headers: { "content-type": "application/json", "accept": "application/x-ndjson" },
    body: JSON.stringify(project),
  });
  if (!response.ok) throw new Error((await response.text()) || "Could not prepare clips");
  if (!response.headers.get("content-type")?.includes("application/x-ndjson")) return response.json() as Promise<PreparationResult>;
  if (!response.body) throw new Error("Clip preparation response has no body");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let pending = "";
  let result: PreparationResult | null = null;
  const consume = (line: string) => {
    if (!line.trim()) return;
    const message = JSON.parse(line) as
      | ({ type: "progress" } & PreparationProgress)
      | { type: "done"; result: PreparationResult }
      | { type: "error"; message: string };
    if (message.type === "progress") onProgress?.({ completed: message.completed, total: message.total, current: message.current, reused: message.reused });
    if (message.type === "done") result = message.result;
    if (message.type === "error") throw new Error(message.message);
  };
  while (true) {
    const { value, done } = await reader.read();
    pending += decoder.decode(value, { stream: !done });
    let newline = pending.indexOf("\n");
    while (newline !== -1) {
      consume(pending.slice(0, newline));
      pending = pending.slice(newline + 1);
      newline = pending.indexOf("\n");
    }
    if (done) break;
  }
  consume(pending);
  if (!result) throw new Error("Clip preparation ended without a result");
  return result;
}

export async function publishProject(project: SceneProject, scene: RuntimeScene): Promise<{ file: string }> {
  const result = await jsonResponse<{ file: string }>(await fetch(`/api/studio/projects/${encodeURIComponent(project.id)}/publish`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(scene),
  }));
  try { localStorage.setItem("video-sync-published-scene", JSON.stringify(scene)); }
  catch { /* The server publication succeeded even if browser storage is unavailable. */ }
  return result;
}

export async function exportScenePackage(project: SceneProject, scene: RuntimeScene): Promise<Blob> {
  const response = await fetch(`/api/studio/projects/${encodeURIComponent(project.id)}/export`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ project, scene }),
  });
  if (!response.ok) throw new Error((await response.text()) || "Could not export scene");
  return response.blob();
}

export async function importScenePackage(file: File): Promise<{ id: string; name: string }> {
  return jsonResponse(await fetch("/api/studio/packages", {
    method: "POST",
    headers: { "content-type": "application/octet-stream" },
    body: file,
  }));
}
