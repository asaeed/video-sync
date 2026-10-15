import { createHash, randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { access, mkdir, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { join, resolve, sep } from "node:path";

const SAFE_ID = /^[a-z0-9][a-z0-9-]*$/;
const SAFE_NAME = /^[a-zA-Z0-9._-]+$/;
const ENCODE_VERSION = 1;
const MAX_AUTOMATIC_SECONDS = 60;

function localSourcePath(root, projectId, file) {
  if (file.startsWith("/assets/")) {
    const path = resolve(root, `.${file}`);
    if (!path.startsWith(`${resolve(root, "assets")}${sep}`)) throw new Error("Invalid asset path");
    return path;
  }
  const match = file.match(/^\/api\/studio\/projects\/([^/]+)\/media\/([^/]+)$/);
  if (!match) return null;
  const owner = decodeURIComponent(match[1]);
  const name = decodeURIComponent(match[2]);
  if (owner !== projectId || !SAFE_NAME.test(name) || name.startsWith(".")) throw new Error("Invalid project media path");
  return join(root, ".build", "studio-projects", projectId, "sources", name);
}

function runFfmpeg(input, start, duration, output) {
  return new Promise((resolve, reject) => {
    const args = ["-hide_banner", "-loglevel", "error", "-y", "-ss", String(start), "-i", input,
      "-t", String(duration), "-an", "-vf", "scale=w='min(1280,iw)':h=-2,fps=30,format=yuv420p",
      "-c:v", "libx264", "-preset", "veryfast", "-crf", "22", "-g", "30", "-movflags", "+faststart",
      "-f", "mp4", output];
    const child = spawn("ffmpeg", args, { stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    child.stderr.on("data", (chunk) => { stderr = `${stderr}${chunk}`.slice(-3000); });
    child.on("error", reject);
    child.on("close", (code) => code === 0 ? resolve() : reject(new Error(`ffmpeg failed (${code}): ${stderr.trim()}`)));
  });
}

export async function prepareProjectClips(root, projectId, project, onProgress = () => {}) {
  if (!SAFE_ID.test(projectId) || project?.id !== projectId || !Array.isArray(project.sources) || !Array.isArray(project.clips)) {
    throw new Error("Invalid project clip preparation request");
  }
  const preparedDir = join(root, ".build", "studio-projects", projectId, "prepared");
  const manifestPath = join(preparedDir, "manifest.json");
  await mkdir(preparedDir, { recursive: true });
  const next = {};
  const media = {};
  const warnings = [];
  const sources = new Map(project.sources.map((source) => [source.id, source]));
  const seen = new Set();
  let created = 0;
  let reused = 0;
  let removed = 0;
  const cuts = [];

  for (const clip of project.clips) {
    if (!SAFE_ID.test(clip.id) || seen.has(clip.id)) throw new Error("Invalid or duplicate clip id");
    seen.add(clip.id);
    const source = sources.get(clip.sourceId);
    if (!source || typeof source.file !== "string") {
      warnings.push(`${clip.label || clip.id}: source is missing`);
      continue;
    }
    const start = Number(clip.inSeconds);
    const end = Number(clip.outSeconds);
    const duration = end - start;
    if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || duration <= 0 || end > Number(source.durationSeconds) + 0.1) {
      warnings.push(`${clip.label || clip.id}: invalid clip range`);
      continue;
    }
    if (duration > MAX_AUTOMATIC_SECONDS) {
      warnings.push(`${clip.label || clip.id}: ${duration.toFixed(1)}s exceeds the ${MAX_AUTOMATIC_SECONDS}s automatic cut limit; trim it first`);
      continue;
    }
    let input;
    let sourceStamp;
    try {
      const path = localSourcePath(root, projectId, source.file);
      if (path) {
        const info = await stat(path);
        if (!info.isFile()) throw new Error("source is not a file");
        input = path;
        sourceStamp = `${path}:${info.size}:${info.mtimeMs}`;
        if (start < 0.001 && Math.abs(end - Number(source.durationSeconds)) < 0.1) {
          media[clip.id] = { file: source.file, durationSeconds: duration };
          reused += 1;
          continue;
        }
      } else {
        const url = new URL(source.file);
        if (!["http:", "https:"].includes(url.protocol)) throw new Error("unsupported source URL");
        input = source.file;
        sourceStamp = source.file;
      }
    } catch (error) {
      warnings.push(`${clip.label || clip.id}: ${error instanceof Error ? error.message : "source unavailable"}`);
      continue;
    }
    const fingerprint = createHash("sha256").update(JSON.stringify([ENCODE_VERSION, sourceStamp, start, end])).digest("hex").slice(0, 16);
    const fileName = `${clip.id}-${fingerprint}.mp4`;
    const path = join(preparedDir, fileName);
    const url = `/api/studio/projects/${encodeURIComponent(projectId)}/prepared/${encodeURIComponent(fileName)}`;
    try {
      await access(path);
      reused += 1;
      next[clip.id] = { fileName, fingerprint };
      media[clip.id] = { file: url, durationSeconds: duration };
    } catch {
      cuts.push({ clip, input, start, duration, path, fileName, fingerprint, url });
    }
  }

  const total = cuts.length;
  let completed = 0;
  onProgress({ completed, total, current: cuts[0]?.clip.label || cuts[0]?.clip.id || null, reused });
  for (const cut of cuts) {
    const { clip, input, start, duration, path, fileName, fingerprint, url } = cut;
    const temporary = join(preparedDir, `${clip.id}-${randomUUID()}.tmp.mp4`);
    try {
      await runFfmpeg(input, start, duration, temporary);
      const info = await stat(temporary);
      if (info.size === 0) throw new Error("empty prepared clip");
      await rename(temporary, path);
      created += 1;
      next[clip.id] = { fileName, fingerprint };
      media[clip.id] = { file: url, durationSeconds: duration };
    } catch (error) {
      warnings.push(`${clip.label || clip.id}: ${error instanceof Error ? error.message : "preparation failed"}`);
    } finally {
      await rm(temporary, { force: true });
      completed += 1;
      const upcoming = cuts[completed]?.clip;
      onProgress({ completed, total, current: upcoming?.label || upcoming?.id || null, reused });
    }
  }

  const temporaryManifest = `${manifestPath}.${randomUUID()}.tmp`;
  await writeFile(temporaryManifest, `${JSON.stringify({ version: ENCODE_VERSION, entries: next }, null, 2)}\n`);
  await rename(temporaryManifest, manifestPath);
  const publishedPath = join(root, ".build", "studio-projects", projectId, "published.scene.json");
  let publishedFiles = new Set();
  try {
    const published = JSON.parse(await readFile(publishedPath, "utf8"));
    publishedFiles = new Set((published.clips ?? []).map((clip) => clip.src?.split("/").pop()));
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  const activeFiles = new Set(Object.values(next).map((entry) => entry.fileName));
  for (const name of await readdir(preparedDir)) {
    if (!/^[a-z0-9][a-z0-9-]*-[a-f0-9]{16}\.mp4$/.test(name) || activeFiles.has(name) || publishedFiles.has(name)) continue;
    await rm(join(preparedDir, name), { force: true });
    removed += 1;
  }
  return { media, created, reused, removed, warnings };
}
