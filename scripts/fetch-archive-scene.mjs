import { spawn } from "node:child_process";
import { mkdir, stat } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { SCENE_CATALOG } from "../poc/scene-catalog.mjs";

const projectRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const requested = process.argv.slice(2).filter((value) => !value.startsWith("--"));
const startArgument = process.argv.find((value) => value.startsWith("--start="));
const firstClipNumber = startArgument ? Number(startArgument.split("=")[1]) : 1;
const cacheArgument = process.argv.find((value) => value.startsWith("--cache-sources="));
const sourceCache = cacheArgument?.slice("--cache-sources=".length) || null;
if (!Number.isInteger(firstClipNumber) || firstClipNumber < 1) {
  throw new Error("--start must be a positive clip number");
}

if (process.argv.includes("--list")) {
  for (const scene of SCENE_CATALOG.filter((candidate) => candidate.archiveId || candidate.sourceMediaUrl)) {
    console.log(`${scene.id}\t${scene.archiveId ?? "direct source"}\t${scene.name}`);
  }
  process.exit(0);
}

if (!requested.length) {
  console.error("Usage: node scripts/fetch-archive-scene.mjs [--start=N] [--cache-sources=PATH] <scene-id> [scene-id ...]\n       node scripts/fetch-archive-scene.mjs --list");
  process.exit(2);
}

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: "inherit" });
    child.on("error", reject);
    child.on("exit", (code) => code === 0 ? resolve() : reject(new Error(`${command} exited with ${code}`)));
  });
}

async function archiveFile(scene) {
  const response = await fetch(`https://archive.org/metadata/${encodeURIComponent(scene.archiveId)}`);
  if (!response.ok) throw new Error(`Archive metadata returned ${response.status} for ${scene.archiveId}`);
  const metadata = await response.json();
  const candidates = metadata.files?.filter((file) => /\.mp4$/i.test(file.name)) ?? [];
  const selected = candidates.find((file) => file.name === scene.preferredFile)
    ?? candidates.find((file) => file.format === "512Kb MPEG4")
    ?? candidates.find((file) => file.source === "original")
    ?? candidates[0];
  if (!selected) throw new Error(`No MP4 file found for ${scene.archiveId}`);
  return selected.name;
}

async function mediaUrl(scene) {
  if (scene.sourceMediaUrl) return scene.sourceMediaUrl;
  if (!scene.archiveId) throw new Error(`${scene.id} does not yet have a verified downloadable source`);
  const fileName = await archiveFile(scene);
  return `https://archive.org/download/${encodeURIComponent(scene.archiveId)}/${encodeURIComponent(fileName)}`;
}

async function cachedMedia(scene, remoteUrl) {
  if (!sourceCache) return remoteUrl;
  await mkdir(sourceCache, { recursive: true });
  const extension = new URL(remoteUrl).pathname.match(/\.(mp4|webm|mkv)(?:\/|$)/i)?.[1]?.toLowerCase() ?? "mp4";
  const sourceFile = join(sourceCache, `${scene.id}.${extension}`);
  let ready = false;
  try {
    ready = (await stat(sourceFile)).size > 1024 * 1024;
  } catch {}
  if (!ready) {
    console.log(`  caching source: ${sourceFile}`);
    await run("curl", [
      "-L", "--fail", "--retry", "8", "--retry-delay", "15",
      "-A", "video-sync local authoring/1.0", "-o", sourceFile, remoteUrl,
    ]);
  }
  return sourceFile;
}

async function build(scene) {
  const remoteUrl = await mediaUrl(scene);
  const inputSource = await cachedMedia(scene, remoteUrl);
  const outputDir = join(projectRoot, "assets", "scenes", scene.id);
  await mkdir(outputDir, { recursive: true });
  console.log(`\n${scene.name}\n  source: ${remoteUrl}\n  clips: ${scene.labels.length}`);
  for (let index = firstClipNumber - 1; index < scene.labels.length; index += 1) {
    const moment = scene.moments[index] ?? index * 30;
    const output = join(outputDir, `clip-${index + 1}.mp4`);
    console.log(`  ${String(index + 1).padStart(2, "0")}  ${moment}s  ${scene.labels[index]}`);
    await run("ffmpeg", [
      "-hide_banner", "-loglevel", "error", "-y",
      "-ss", String(moment), "-i", inputSource, "-t", "8", "-an",
      "-vf", "scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:(oh-ih)/2:black,fps=30,format=yuv420p",
      "-c:v", "libx264", "-preset", "veryfast", "-crf", "23", "-g", "30", "-movflags", "+faststart",
      output,
    ]);
  }
}

for (const id of requested) {
  const scene = SCENE_CATALOG.find((candidate) => candidate.id === id);
  if (!scene) throw new Error(`Unknown scene: ${id}`);
  await build(scene);
}
