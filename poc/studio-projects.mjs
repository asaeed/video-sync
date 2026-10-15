import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { extname, join } from "node:path";
import { pipeline } from "node:stream/promises";
import { createScenePackage, importScenePackage, streamScenePackage } from "./scene-package.mjs";
import { prepareProjectClips } from "./prepared-clips.mjs";

const SAFE_ID = /^[a-z0-9][a-z0-9-]*$/;
const MAX_JSON_BYTES = 20 * 1024 * 1024;

function assertId(value, label) {
  if (!SAFE_ID.test(value ?? "")) throw new Error(`Invalid ${label}`);
  return value;
}

function safeFileName(value = "source.mp4") {
  const cleaned = value.normalize("NFKD").replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
  return cleaned || "source.mp4";
}

async function readJson(request) {
  const chunks = [];
  let bytes = 0;
  for await (const chunk of request) {
    bytes += chunk.length;
    if (bytes > MAX_JSON_BYTES) throw new Error("JSON body is too large");
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function json(response, status, value) {
  response.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  response.end(JSON.stringify(value));
}

function error(response, status, message) {
  response.writeHead(status, { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" });
  response.end(message);
}

async function serveFile(request, response, filePath, mime) {
  const info = await stat(filePath);
  const headers = {
    "content-type": mime[extname(filePath).toLowerCase()] || "application/octet-stream",
    "cache-control": "no-store",
    "accept-ranges": "bytes",
  };
  const rangeMatch = request.headers.range?.match(/^bytes=(\d*)-(\d*)$/);
  if (rangeMatch) {
    const start = rangeMatch[1] ? Number(rangeMatch[1]) : 0;
    const end = rangeMatch[2] ? Math.min(Number(rangeMatch[2]), info.size - 1) : info.size - 1;
    if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || start > end || start >= info.size) {
      response.writeHead(416, { "content-range": `bytes */${info.size}` }).end();
      return;
    }
    response.writeHead(206, { ...headers, "content-range": `bytes ${start}-${end}/${info.size}`, "content-length": end - start + 1 });
    if (request.method === "HEAD") response.end();
    else createReadStream(filePath, { start, end }).pipe(response);
    return;
  }
  response.writeHead(200, { ...headers, "content-length": info.size });
  if (request.method === "HEAD") response.end();
  else createReadStream(filePath).pipe(response);
}

export function createStudioProjectApi(root, mime) {
  const projectsRoot = join(root, ".build", "studio-projects");
  const preparationQueues = new Map();

  return async function handleStudioProjectRequest(request, response, requestUrl) {
    const segments = requestUrl.pathname.split("/").filter(Boolean).map(decodeURIComponent);
    if (segments[0] !== "api" || segments[1] !== "studio") return false;

    try {
      if (segments[2] === "packages" && segments.length === 3 && request.method === "POST") {
        json(response, 200, await importScenePackage(root, request));
        return true;
      }
      if (segments[2] === "published" && segments.length === 3 && request.method === "GET") {
        await mkdir(projectsRoot, { recursive: true });
        const entries = await readdir(projectsRoot, { withFileTypes: true });
        const scenes = [];
        for (const entry of entries) {
          if (!entry.isDirectory() || !SAFE_ID.test(entry.name)) continue;
          try {
            const scene = JSON.parse(await readFile(join(projectsRoot, entry.name, "published.scene.json"), "utf8"));
            if (scene.id === entry.name && scene.schemaVersion === 4 && scene.availability === "ready"
              && Array.isArray(scene.clips) && Array.isArray(scene.visualLoops)
              && scene.visualLoops.some((loop) => loop.id === scene.defaultLoopId)) scenes.push(scene);
          } catch {
            // A saved but unpublished (or interrupted) project stays out of the player.
          }
        }
        json(response, 200, scenes);
        return true;
      }
      if (segments[2] !== "projects") return false;
      if (segments.length === 3 && request.method === "GET") {
        await mkdir(projectsRoot, { recursive: true });
        const entries = await readdir(projectsRoot, { withFileTypes: true });
        const projects = [];
        for (const entry of entries) {
          if (!entry.isDirectory() || !SAFE_ID.test(entry.name)) continue;
          try {
            const project = JSON.parse(await readFile(join(projectsRoot, entry.name, "project.json"), "utf8"));
            projects.push({ id: project.id, name: project.name, updatedAt: project.updatedAt });
          } catch {
            // Ignore incomplete project folders left by interrupted imports.
          }
        }
        projects.sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
        json(response, 200, projects);
        return true;
      }

      const projectId = assertId(segments[3], "project id");
      const projectDir = join(projectsRoot, projectId);
      const projectFile = join(projectDir, "project.json");

      if (segments.length === 4 && request.method === "GET") {
        json(response, 200, JSON.parse(await readFile(projectFile, "utf8")));
        return true;
      }

      if (segments.length === 4 && request.method === "PUT") {
        const project = await readJson(request);
        if (project?.id !== projectId || project?.projectVersion !== 1 || project?.schemaVersion !== 5) {
          error(response, 400, "Project identity or schema version does not match the route");
          return true;
        }
        await mkdir(projectDir, { recursive: true });
        await writeFile(projectFile, `${JSON.stringify(project, null, 2)}\n`);
        json(response, 200, { id: projectId, saved: true });
        return true;
      }

      if (segments[4] === "export" && segments.length === 5 && request.method === "POST") {
        const { project, scene } = await readJson(request);
        if (project?.id !== projectId || scene?.id !== projectId) throw new Error("Export scene id does not match the route");
        const bundle = await createScenePackage(root, project, scene);
        response.writeHead(200, {
          "content-type": "application/octet-stream",
          "content-disposition": `attachment; filename="${projectId}.vscene"`,
          "content-length": bundle.totalBytes,
          "cache-control": "no-store",
        });
        await streamScenePackage(response, bundle);
        return true;
      }

      if (segments[4] === "sources" && segments.length === 6 && request.method === "PUT") {
        const sourceId = assertId(segments[5], "source id");
        const fileName = safeFileName(request.headers["x-file-name"]);
        const storedName = `${sourceId}-${fileName}`;
        const sourcesDir = join(projectDir, "sources");
        await mkdir(sourcesDir, { recursive: true });
        await pipeline(request, createWriteStream(join(sourcesDir, storedName)));
        json(response, 200, {
          file: `/api/studio/projects/${encodeURIComponent(projectId)}/media/${encodeURIComponent(storedName)}`,
          fileName,
        });
        return true;
      }

      if (segments[4] === "media" && segments.length === 6 && ["GET", "HEAD"].includes(request.method)) {
        const storedName = safeFileName(segments[5]);
        await serveFile(request, response, join(projectDir, "sources", storedName), mime);
        return true;
      }

      if (segments[4] === "prepared" && segments.length === 6 && ["GET", "HEAD"].includes(request.method)) {
        const name = segments[5];
        if (!/^[a-z0-9][a-z0-9-]*-[a-f0-9]{16}\.mp4$/.test(name)) throw new Error("Invalid prepared clip filename");
        await serveFile(request, response, join(projectDir, "prepared", name), mime);
        return true;
      }

      if (segments[4] === "prepare" && segments.length === 5 && request.method === "POST") {
        const project = await readJson(request);
        const streaming = String(request.headers.accept).includes("application/x-ndjson");
        if (streaming) {
          response.writeHead(200, { "content-type": "application/x-ndjson; charset=utf-8", "cache-control": "no-store" });
          response.write(`${JSON.stringify({ type: "progress", completed: 0, total: 0, current: null })}\n`);
        }
        const previous = preparationQueues.get(projectId) ?? Promise.resolve();
        const task = previous.catch(() => {}).then(() => prepareProjectClips(root, projectId, project, (progress) => {
          if (streaming && !response.destroyed) response.write(`${JSON.stringify({ type: "progress", ...progress })}\n`);
        }));
        preparationQueues.set(projectId, task);
        try {
          const result = await task;
          if (streaming) response.end(`${JSON.stringify({ type: "done", result })}\n`);
          else json(response, 200, result);
        } catch (caught) {
          if (!streaming) throw caught;
          response.end(`${JSON.stringify({ type: "error", message: caught instanceof Error ? caught.message : "Clip preparation failed" })}\n`);
        }
        finally { if (preparationQueues.get(projectId) === task) preparationQueues.delete(projectId); }
        return true;
      }

      if (segments[4] === "publish" && segments.length === 5 && request.method === "POST") {
        const scene = await readJson(request);
        if (scene?.id !== projectId || scene?.schemaVersion !== 4) {
          error(response, 400, "Published scene identity or schema version does not match the project");
          return true;
        }
        await mkdir(projectDir, { recursive: true });
        await writeFile(join(projectDir, "published.scene.json"), `${JSON.stringify(scene, null, 2)}\n`);
        json(response, 200, { file: `/api/studio/projects/${encodeURIComponent(projectId)}/published` });
        return true;
      }

      if (segments[4] === "published" && segments.length === 5 && request.method === "GET") {
        json(response, 200, JSON.parse(await readFile(join(projectDir, "published.scene.json"), "utf8")));
        return true;
      }

      error(response, 405, "Unsupported Scene Studio operation");
      return true;
    } catch (caught) {
      if (response.headersSent) {
        response.destroy(caught);
        return true;
      }
      if (caught?.code === "ENOENT") error(response, 404, "Project or media not found");
      else error(response, 400, caught instanceof Error ? caught.message : "Invalid Scene Studio request");
      return true;
    }
  };
}
