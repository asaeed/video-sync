import { createReadStream, createWriteStream } from "node:fs";
import { access, mkdir, open, rename, rm, stat, writeFile } from "node:fs/promises";
import { once } from "node:events";
import { randomUUID } from "node:crypto";
import { join, resolve, sep } from "node:path";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";

const MAGIC = Buffer.from("VSSET1\n");
const MAX_MANIFEST = 20 * 1024 * 1024;
const MAX_PACKAGE = 8 * 1024 * 1024 * 1024;
const SAFE_ID = /^[a-z0-9][a-z0-9-]*$/;

function safeId(value) {
  if (typeof value !== "string" || !SAFE_ID.test(value)) throw new Error("Invalid scene or source id in package");
  return value;
}

function safeName(value) {
  if (typeof value !== "string" || !/^[a-zA-Z0-9._-]+$/.test(value) || value.startsWith(".")) {
    throw new Error("Invalid media filename in package");
  }
  return value;
}

function sourcePath(root, source) {
  const pathname = source.file;
  if (typeof pathname !== "string") throw new Error(`Source ${source.id} has no local media file`);
  if (pathname.startsWith("/assets/")) {
    const path = resolve(root, `.${pathname}`);
    const assetsRoot = resolve(root, "assets");
    if (!path.startsWith(`${assetsRoot}${sep}`)) throw new Error("Invalid asset path");
    return path;
  }
  const match = pathname.match(/^\/api\/studio\/projects\/([^/]+)\/media\/([^/]+)$/);
  if (match) {
    const projectId = safeId(decodeURIComponent(match[1]));
    const name = safeName(decodeURIComponent(match[2]));
    return join(root, ".build", "studio-projects", projectId, "sources", name);
  }
  throw new Error(`Source ${source.id} is not a local video; import it before exporting`);
}

function validateDefinitions(project, scene) {
  if (project?.projectVersion !== 1 || project?.schemaVersion !== 5 || !Array.isArray(project.sources)) {
    throw new Error("Invalid Scene Studio project in package");
  }
  if (scene?.schemaVersion !== 4 || project.id !== scene.id) throw new Error("Published scene does not match project");
  safeId(project.id);
  const ids = new Set();
  for (const source of project.sources) {
    safeId(source.id);
    if (ids.has(source.id)) throw new Error("Duplicate source id in package");
    ids.add(source.id);
    safeName(source.fileName);
  }
}

export async function createScenePackage(root, project, scene) {
  validateDefinitions(project, scene);
  const media = [];
  for (const source of project.sources) {
    const path = sourcePath(root, source);
    const info = await stat(path);
    if (!info.isFile()) throw new Error(`Source ${source.id} is not a file`);
    media.push({ sourceId: source.id, fileName: source.fileName, size: info.size, path });
  }
  const manifest = Buffer.from(JSON.stringify({ format: "video-sync-scene", version: 1, project, scene,
    media: media.map(({ sourceId, fileName, size }) => ({ sourceId, fileName, size })) }), "utf8");
  if (manifest.length > MAX_MANIFEST) throw new Error("Scene manifest is too large");
  const header = Buffer.alloc(MAGIC.length + 8);
  MAGIC.copy(header);
  header.writeBigUInt64BE(BigInt(manifest.length), MAGIC.length);
  const totalBytes = header.length + manifest.length + media.reduce((sum, item) => sum + item.size, 0);
  if (totalBytes > MAX_PACKAGE) throw new Error("Scene package exceeds the 8 GB limit");
  return { header, manifest, media, totalBytes };
}

export async function streamScenePackage(response, bundle) {
  response.write(bundle.header);
  response.write(bundle.manifest);
  for (const media of bundle.media) {
    for await (const chunk of createReadStream(media.path)) {
      if (!response.write(chunk)) await once(response, "drain");
    }
  }
  response.end();
}

async function readExactly(handle, length, position) {
  const bytes = Buffer.alloc(length);
  let offset = 0;
  while (offset < length) {
    const { bytesRead } = await handle.read(bytes, offset, length - offset, position + offset);
    if (!bytesRead) throw new Error("Truncated scene package");
    offset += bytesRead;
  }
  return bytes;
}

async function availableId(projectsRoot, base) {
  let id = base;
  let suffix = 2;
  while (true) {
    try { await access(join(projectsRoot, id)); id = `${base}-copy-${suffix++}`; }
    catch { return id; }
  }
}

export async function importScenePackage(root, request) {
  const projectsRoot = join(root, ".build", "studio-projects");
  await mkdir(projectsRoot, { recursive: true });
  const packagePath = join(projectsRoot, `.incoming-${randomUUID()}`);
  const staging = join(projectsRoot, `.import-${randomUUID()}`);
  let total = 0;
  let finalPath = null;
  try {
    const limiter = new Transform({
      transform(chunk, _encoding, done) {
        total += chunk.length;
        done(total > MAX_PACKAGE ? new Error("Scene package exceeds the 8 GB limit") : null, chunk);
      },
    });
    await pipeline(request, limiter, createWriteStream(packagePath));
    total = (await stat(packagePath)).size;
    if (total > MAX_PACKAGE) throw new Error("Scene package exceeds the 8 GB limit");
    const handle = await open(packagePath, "r");
    let manifest;
    let dataOffset;
    try {
      const header = await readExactly(handle, MAGIC.length + 8, 0);
      if (!header.subarray(0, MAGIC.length).equals(MAGIC)) throw new Error("Not a Video Sync scene package");
      const manifestBytes = Number(header.readBigUInt64BE(MAGIC.length));
      if (manifestBytes < 1 || manifestBytes > MAX_MANIFEST) throw new Error("Invalid scene manifest size");
      manifest = JSON.parse((await readExactly(handle, manifestBytes, header.length)).toString("utf8"));
      dataOffset = header.length + manifestBytes;
    } finally { await handle.close(); }
    if (manifest?.format !== "video-sync-scene" || manifest.version !== 1 || !Array.isArray(manifest.media)) {
      throw new Error("Unsupported scene package version");
    }
    validateDefinitions(manifest.project, manifest.scene);
    if (manifest.media.length !== manifest.project.sources.length) throw new Error("Package media list is incomplete");
    const id = await availableId(projectsRoot, manifest.project.id);
    const project = structuredClone(manifest.project);
    const scene = structuredClone(manifest.scene);
    project.id = id;
    scene.id = id;
    await mkdir(join(staging, "sources"), { recursive: true });
    const rewritten = new Map();
    let offset = dataOffset;
    for (const [index, source] of project.sources.entries()) {
      const media = manifest.media[index];
      if (!media || media.sourceId !== source.id || media.fileName !== source.fileName || !Number.isSafeInteger(media.size) || media.size < 0) {
        throw new Error(`Invalid media entry for ${source.id}`);
      }
      const name = `${safeId(source.id)}-${safeName(source.fileName)}`;
      if (offset + media.size > total) throw new Error("Truncated scene media");
      if (media.size) await pipeline(createReadStream(packagePath, { start: offset, end: offset + media.size - 1 }), createWriteStream(join(staging, "sources", name)));
      else await writeFile(join(staging, "sources", name), "");
      offset += media.size;
      const newUrl = `/api/studio/projects/${encodeURIComponent(id)}/media/${encodeURIComponent(name)}`;
      rewritten.set(source.file, newUrl);
      source.file = newUrl;
    }
    if (offset !== total) throw new Error("Unexpected bytes after scene media");
    for (const clip of scene.clips ?? []) {
      const newUrl = rewritten.get(clip.src);
      if (!newUrl) throw new Error(`Published clip ${clip.id} has no packaged source`);
      clip.src = newUrl;
    }
    await writeFile(join(staging, "project.json"), `${JSON.stringify(project, null, 2)}\n`);
    await writeFile(join(staging, "published.scene.json"), `${JSON.stringify(scene, null, 2)}\n`);
    finalPath = join(projectsRoot, id);
    await rename(staging, finalPath);
    return { id, name: project.name };
  } finally {
    await rm(packagePath, { force: true });
    if (!finalPath) await rm(staging, { recursive: true, force: true });
  }
}
