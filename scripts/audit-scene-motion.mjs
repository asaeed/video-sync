// Read-only shortlist of excerpts that may feel like stills in a live loop.
// This is a heuristic: subdued motion and low-contrast archival scans can
// trigger it too, so review the video before replacing any cut.
import { spawn } from "node:child_process";
import { readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const root = new URL("../assets/scenes/", import.meta.url);
const thresholdSeconds = Number(process.argv[2] ?? 4);
if (!Number.isFinite(thresholdSeconds) || thresholdSeconds < 0) throw new Error("Threshold must be a nonnegative number of seconds");

const sceneDirs = (await readdir(root, { withFileTypes: true })).filter((entry) => entry.isDirectory());
const files = (await Promise.all(sceneDirs.map(async (scene) =>
  (await readdir(new URL(`${scene.name}/`, root)))
    .filter((name) => name.endsWith(".mp4"))
    .map((name) => ({ scene: scene.name, name, path: join(fileURLToPath(root), scene.name, name) }))
))).flat();

function frozenSeconds(file) {
  return new Promise((resolve, reject) => {
    const process = spawn("ffmpeg", ["-hide_banner", "-i", file.path, "-vf", "freezedetect=n=-35dB:d=0.8", "-an", "-f", "null", "-"]);
    let output = "";
    process.stderr.on("data", (chunk) => { output += chunk; });
    process.on("error", reject);
    process.on("close", (code) => {
      if (code !== 0) return reject(new Error(`ffmpeg failed for ${file.path}`));
      const durations = [...output.matchAll(/freeze_duration: ([0-9.]+)/g)].map((match) => Number(match[1]));
      resolve({ ...file, frozenSeconds: durations.reduce((sum, duration) => sum + duration, 0) });
    });
  });
}

let next = 0;
const results = [];
await Promise.all(Array.from({ length: 8 }, async () => {
  while (next < files.length) results.push(await frozenSeconds(files[next++]));
}));
const flagged = results.filter((item) => item.frozenSeconds >= thresholdSeconds)
  .sort((a, b) => b.frozenSeconds - a.frozenSeconds);
const byScene = new Map();
for (const item of flagged) byScene.set(item.scene, [...(byScene.get(item.scene) ?? []), item]);
console.log(`${flagged.length}/${results.length} excerpts have >=${thresholdSeconds}s of near-static frames (-35dB, runs >=0.8s).`);
console.log("Scene shortlist:");
for (const [scene, clips] of [...byScene].sort((a, b) => b[1].length - a[1].length)) {
  console.log(`  ${scene}: ${clips.length} (${clips.map((clip) => clip.name.replace(/\.mp4$/, "")).join(", ")})`);
}
console.log("Most static excerpts:");
for (const item of flagged.slice(0, 15)) console.log(`  ${item.scene}/${item.name}: ${item.frozenSeconds.toFixed(1)}s`);
