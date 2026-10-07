import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { extname, join } from "node:path";
import { pipeline } from "node:stream/promises";

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

  return async function handleStudioProjectRequest(request, response, requestUrl) {
    const segments = requestUrl.pathname.split("/").filter(Boolean).map(decodeURIComponent);
    if (segments[0] !== "api" || segments[1] !== "studio" || segments[2] !== "projects") return false;

    try {
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
      if (caught?.code === "ENOENT") error(response, 404, "Project or media not found");
      else error(response, 400, caught instanceof Error ? caught.message : "Invalid Scene Studio request");
      return true;
    }
  };
}
