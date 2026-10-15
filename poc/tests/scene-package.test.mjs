import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { createScenePackage, importScenePackage, streamScenePackage } from "../scene-package.mjs";
import { createStudioProjectApi } from "../studio-projects.mjs";

test("portable scene package embeds film source and imports to a collision-safe id", async () => {
  const root = await mkdtemp(join(tmpdir(), "video-sync-package-test-"));
  try {
    await mkdir(join(root, "assets", "scenes"), { recursive: true });
    await writeFile(join(root, "assets", "scenes", "sample.mp4"), Buffer.from("video bytes"));
    await mkdir(join(root, ".build", "studio-projects", "sample"), { recursive: true });
    const project = { projectVersion: 1, schemaVersion: 5, id: "sample", name: "Sample",
      sources: [{ id: "source-1", file: "/assets/scenes/sample.mp4", fileName: "sample.mp4" }],
      clips: [], visualLoops: [], cueBindings: [] };
    const scene = { schemaVersion: 4, id: "sample", name: "Sample",
      clips: [{ id: "clip-1", src: "/assets/scenes/sample.mp4" }] };
    const bundle = await createScenePackage(root, project, scene);
    const chunks = [];
    await streamScenePackage({ write: (chunk) => { chunks.push(Buffer.from(chunk)); return true; }, end: () => {} }, bundle);
    const imported = await importScenePackage(root, Readable.from([Buffer.concat(chunks)]));
    assert.equal(imported.id, "sample-copy-2");
    const saved = JSON.parse(await readFile(join(root, ".build", "studio-projects", imported.id, "project.json")));
    const published = JSON.parse(await readFile(join(root, ".build", "studio-projects", imported.id, "published.scene.json")));
    assert.match(saved.sources[0].file, /sample-copy-2\/media\/source-1-sample\.mp4$/);
    assert.equal(published.clips[0].src, saved.sources[0].file);
    assert.equal((await readFile(join(root, ".build", "studio-projects", imported.id, "sources", "source-1-sample.mp4"))).toString(), "video bytes");
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("Studio API exports and imports a scene package without overwriting its source", async () => {
  const root = await mkdtemp(join(tmpdir(), "video-sync-package-api-test-"));
  try {
    await mkdir(join(root, "assets"), { recursive: true });
    await writeFile(join(root, "assets", "tiny.mp4"), "tiny video");
    const project = { projectVersion: 1, schemaVersion: 5, id: "api-scene", name: "API scene",
      sources: [{ id: "source-1", file: "/assets/tiny.mp4", fileName: "tiny.mp4" }],
      clips: [], visualLoops: [], cueBindings: [] };
    const scene = { schemaVersion: 4, id: "api-scene", name: "API scene",
      clips: [{ id: "clip-1", src: "/assets/tiny.mp4" }] };
    const handle = createStudioProjectApi(root, {});
    const call = async (method, path, body) => {
      const input = Readable.from([body]);
      input.method = method;
      input.headers = {};
      const response = { status: 0, chunks: [],
        writeHead(status) { this.status = status; return this; },
        write(chunk) { this.chunks.push(Buffer.from(chunk)); return true; },
        end(chunk) { if (chunk) this.chunks.push(Buffer.from(chunk)); },
      };
      await handle(input, response, new URL(path, "http://video-sync.local"));
      return { status: response.status, bytes: Buffer.concat(response.chunks) };
    };
    const exported = await call("POST", "/api/studio/projects/api-scene/export", Buffer.from(JSON.stringify({ project, scene })));
    assert.equal(exported.status, 200);
    const imported = await call("POST", "/api/studio/packages", exported.bytes);
    assert.equal(imported.status, 200);
    assert.equal(JSON.parse(imported.bytes.toString()).id, "api-scene");
    assert.equal((await readFile(join(root, ".build", "studio-projects", "api-scene", "sources", "source-1-tiny.mp4"))).toString(), "tiny video");
  } finally { await rm(root, { recursive: true, force: true }); }
});
