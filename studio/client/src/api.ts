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

export async function publishProject(project: SceneProject, scene: RuntimeScene): Promise<{ file: string }> {
  localStorage.setItem("video-sync-published-scene", JSON.stringify(scene));
  return jsonResponse(await fetch(`/api/studio/projects/${encodeURIComponent(project.id)}/publish`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(scene),
  }));
}
