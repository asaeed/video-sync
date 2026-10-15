import { VisualEngine } from "./engine.mjs";
import { sceneById } from "./scene-registry.mjs";

const channel = new BroadcastChannel("video-sync-poc-v4");
const stage = document.querySelector("#output-stage");
const diagnostics = document.querySelector("#diagnostics");
const engine = new VisualEngine(stage, (metrics) => {
  const phrase = metrics.phraseActive ? `${metrics.phraseBar}/16` : "stopped";
  diagnostics.textContent = `Phrase ${phrase}  ·  frame p95 ${metrics.frameIntervalMs.toFixed(1)} ms  ·  active ${metrics.activeVideos}  ·  drops ${metrics.droppedFrames}`;
});
let recordedScenes = null;

channel.addEventListener("message", ({ data }) => {
  if (data?.type === "scene-overrides") {
    recordedScenes = data.scenes ? new Map(data.scenes.map((scene) => [scene.id, scene])) : null;
    engine.setSceneResolver((id) => recordedScenes?.get(id) ?? sceneById(id));
  }
  if (data?.type === "snapshot") engine.applySnapshot(data.snapshot);
});

document.querySelector("#fullscreen").addEventListener("click", async () => {
  await document.documentElement.requestFullscreen();
  document.querySelector("#output-help").hidden = true;
});

window.addEventListener("keydown", (event) => {
  if (event.key.toLowerCase() === "d") diagnostics.hidden = !diagnostics.hidden;
  if (event.key.toLowerCase() === "f") document.querySelector("#fullscreen").click();
});

channel.postMessage({ type: "request-snapshot" });
