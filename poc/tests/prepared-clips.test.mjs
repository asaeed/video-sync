import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { prepareProjectClips } from "../prepared-clips.mjs";
import { createStudioProjectApi } from "../studio-projects.mjs";

function ffmpeg(args) {
  return new Promise((resolve, reject) => {
    const child = spawn("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", ...args]);
    let error = "";
    child.stderr.on("data", (part) => { error += part; });
    child.on("error", reject);
    child.on("close", (code) => code === 0 ? resolve() : reject(new Error(error)));
  });
}

test("clip preparation reconciles added, modified and deleted cut media without touching its source", async () => {
  const root = await mkdtemp(join(tmpdir(), "video-sync-clips-"));
  try {
    const projectId = "test-scene";
    const projectDir = join(root, ".build", "studio-projects", projectId);
    const sourceDir = join(projectDir, "sources");
    await mkdir(sourceDir, { recursive: true });
    const sourcePath = join(sourceDir, "source.mp4");
    await ffmpeg(["-f", "lavfi", "-i", "testsrc2=size=320x180:rate=24", "-t", "3", "-an", "-c:v", "libx264", "-pix_fmt", "yuv420p", sourcePath]);
    const project = {
      id: projectId,
      sources: [{ id: "source", file: `/api/studio/projects/${projectId}/media/source.mp4`, durationSeconds: 3 }],
      clips: [{ id: "cut-one", sourceId: "source", label: "One", inSeconds: 0.25, outSeconds: 1.25 }],
    };
    const first = await prepareProjectClips(root, projectId, project);
    assert.equal(first.created, 1);
    assert.equal(first.warnings.length, 0);
    const firstName = first.media["cut-one"].file.split("/").pop();
    assert.ok((await stat(join(projectDir, "prepared", firstName))).size > 0);
    const second = await prepareProjectClips(root, projectId, project);
    assert.equal(second.created, 0);
    assert.equal(second.reused, 1);

    project.clips[0].inSeconds = 0.5;
    project.clips[0].outSeconds = 1.5;
    project.clips.push({ id: "cut-two", sourceId: "source", label: "Two", inSeconds: 1.5, outSeconds: 2.5 });
    const changed = await prepareProjectClips(root, projectId, project);
    assert.equal(changed.created, 2);
    assert.equal(changed.removed, 1);
    assert.notEqual(changed.media["cut-one"].file, first.media["cut-one"].file);
    await assert.rejects(stat(join(projectDir, "prepared", firstName)), { code: "ENOENT" });

    const published = { clips: [{ src: changed.media["cut-one"].file }] };
    await writeFile(join(projectDir, "published.scene.json"), JSON.stringify(published));
    project.clips = [];
    const deleted = await prepareProjectClips(root, projectId, project);
    assert.equal(deleted.removed, 1);
    assert.ok((await stat(join(projectDir, "prepared", changed.media["cut-one"].file.split("/").pop()))).size > 0, "published media stays available");
    assert.ok((await stat(sourcePath)).size > 0, "original source remains untouched");
    await writeFile(join(projectDir, "published.scene.json"), JSON.stringify({ clips: [] }));
    const cleaned = await prepareProjectClips(root, projectId, project);
    assert.equal(cleaned.removed, 1);
    assert.deepEqual(JSON.parse(await readFile(join(projectDir, "prepared", "manifest.json"), "utf8")).entries, {});
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("changing one cut renders only that clip and reuses every unchanged prepared file", async () => {
  const root = await mkdtemp(join(tmpdir(), "video-sync-incremental-"));
  try {
    const projectId = "incremental-scene";
    const sourceDir = join(root, ".build", "studio-projects", projectId, "sources");
    await mkdir(sourceDir, { recursive: true });
    await ffmpeg(["-f", "lavfi", "-i", "testsrc2=size=320x180:rate=24", "-t", "4", "-an", "-c:v", "libx264", "-pix_fmt", "yuv420p", join(sourceDir, "source.mp4")]);
    const project = {
      id: projectId,
      sources: [{ id: "source", file: `/api/studio/projects/${projectId}/media/source.mp4`, durationSeconds: 4 }],
      clips: [
        { id: "cut-one", sourceId: "source", label: "One", inSeconds: 0.25, outSeconds: 1.25 },
        { id: "cut-two", sourceId: "source", label: "Two", inSeconds: 2, outSeconds: 3 },
      ],
    };
    const first = await prepareProjectClips(root, projectId, project);
    assert.equal(first.created, 2);
    const unchanged = first.media["cut-two"].file;
    const oldModified = first.media["cut-one"].file;

    project.clips[0].inSeconds = 0.5;
    project.clips[0].outSeconds = 1.5;
    const second = await prepareProjectClips(root, projectId, project);
    assert.equal(second.created, 1);
    assert.equal(second.reused, 1);
    assert.equal(second.removed, 1);
    assert.equal(second.media["cut-two"].file, unchanged);
    assert.notEqual(second.media["cut-one"].file, oldModified);
    assert.ok((await stat(join(root, ".build", "studio-projects", projectId, "prepared", unchanged.split("/").pop()))).size > 0);
    await assert.rejects(stat(join(root, ".build", "studio-projects", projectId, "prepared", oldModified.split("/").pop())), { code: "ENOENT" });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("adding three clips to five prepared cuts renders only the new clips and reports three cuts", async () => {
  const root = await mkdtemp(join(tmpdir(), "video-sync-new-cuts-"));
  try {
    const projectId = "new-cuts-scene";
    const sourceDir = join(root, ".build", "studio-projects", projectId, "sources");
    await mkdir(sourceDir, { recursive: true });
    await ffmpeg(["-f", "lavfi", "-i", "testsrc2=size=320x180:rate=24", "-t", "4", "-an", "-c:v", "libx264", "-pix_fmt", "yuv420p", join(sourceDir, "source.mp4")]);
    const clips = Array.from({ length: 8 }, (_, index) => ({
      id: `clip-${index + 1}`, sourceId: "source", label: `Clip ${index + 1}`,
      inSeconds: index * 0.5, outSeconds: index * 0.5 + 0.4,
    }));
    const project = { id: projectId, sources: [{ id: "source", file: `/api/studio/projects/${projectId}/media/source.mp4`, durationSeconds: 4 }], clips: clips.slice(0, 5) };
    const first = await prepareProjectClips(root, projectId, project);
    assert.equal(first.created, 5);
    const previous = await Promise.all(project.clips.map(async (clip) => {
      const name = first.media[clip.id].file.split("/").pop();
      return { id: clip.id, name, mtimeMs: (await stat(join(root, ".build", "studio-projects", projectId, "prepared", name))).mtimeMs };
    }));

    project.clips = clips;
    const progress = [];
    const second = await prepareProjectClips(root, projectId, project, (item) => progress.push(item));
    assert.equal(second.created, 3);
    assert.equal(second.reused, 5);
    assert.equal(second.warnings.length, 0);
    assert.deepEqual(progress.map(({ completed, total, reused }) => [completed, total, reused]), [[0, 3, 5], [1, 3, 5], [2, 3, 5], [3, 3, 5]]);
    for (const item of previous) {
      assert.equal(second.media[item.id].file.split("/").pop(), item.name);
      assert.equal((await stat(join(root, ".build", "studio-projects", projectId, "prepared", item.name))).mtimeMs, item.mtimeMs);
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("an entire local short source is reused and an untrimmed long remote source is not downloaded", async () => {
  const root = await mkdtemp(join(tmpdir(), "video-sync-clips-"));
  try {
    const assetDir = join(root, "assets");
    await mkdir(assetDir);
    await writeFile(join(assetDir, "short.mp4"), "fixture");
    const result = await prepareProjectClips(root, "scene", {
      id: "scene",
      sources: [
        { id: "short", file: "/assets/short.mp4", durationSeconds: 3 },
        { id: "remote", file: "https://example.com/film.mp4", durationSeconds: 5000 },
      ],
      clips: [
        { id: "full-short", sourceId: "short", inSeconds: 0, outSeconds: 3 },
        { id: "full-long", sourceId: "remote", inSeconds: 0, outSeconds: 5000 },
      ],
    });
    assert.equal(result.media["full-short"].file, "/assets/short.mp4");
    assert.equal(result.created, 0);
    assert.match(result.warnings[0], /trim it first/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("Studio preparation streams the planned cut count and a final result", async () => {
  const root = await mkdtemp(join(tmpdir(), "video-sync-progress-"));
  try {
    await mkdir(join(root, "assets"));
    await writeFile(join(root, "assets", "short.mp4"), "fixture");
    const project = {
      id: "progress-scene",
      sources: [{ id: "short", file: "/assets/short.mp4", durationSeconds: 2 }],
      clips: [
        { id: "clip-one", sourceId: "short", label: "One", inSeconds: 0, outSeconds: 2 },
        { id: "clip-two", sourceId: "short", label: "Two", inSeconds: 0, outSeconds: 2 },
      ],
    };
    const input = Readable.from([Buffer.from(JSON.stringify(project))]);
    input.method = "POST";
    input.headers = { accept: "application/x-ndjson" };
    const response = {
      status: 0, headers: {}, chunks: [], destroyed: false,
      writeHead(status, headers) { this.status = status; this.headers = headers; return this; },
      write(chunk) { this.chunks.push(Buffer.from(chunk)); return true; },
      end(chunk) { if (chunk) this.chunks.push(Buffer.from(chunk)); },
    };
    await createStudioProjectApi(root, { ".mp4": "video/mp4" })(input, response, new URL("http://localhost/api/studio/projects/progress-scene/prepare"));
    const messages = Buffer.concat(response.chunks).toString().trim().split("\n").map(JSON.parse);
    assert.equal(response.status, 200);
    assert.match(response.headers["content-type"], /x-ndjson/);
    assert.deepEqual(messages.filter((item) => item.type === "progress").map(({ completed, total, reused }) => [completed, total, reused]), [[0, 0, undefined], [0, 0, 2]]);
    assert.equal(messages.at(-1).type, "done");
    assert.equal(messages.at(-1).result.reused, 2);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
