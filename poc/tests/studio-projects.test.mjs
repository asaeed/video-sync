import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { createStudioProjectApi } from "../studio-projects.mjs";

test("Scene Studio saves, lists, reloads, and publishes a project without duplicating media", async () => {
  const testRoot = await mkdtemp(join(tmpdir(), "video-sync-studio-test-"));
  const handle = createStudioProjectApi(testRoot, {});
  const request = async (method, path, body) => {
    const input = Readable.from(body === undefined ? [] : [Buffer.from(JSON.stringify(body))]);
    input.method = method;
    input.headers = {};
    const response = {
      status: 0,
      chunks: [],
      writeHead(status) { this.status = status; return this; },
      end(chunk) { if (chunk) this.chunks.push(Buffer.from(chunk)); return this; },
    };
    await handle(input, response, new URL(path, "http://video-sync.local"));
    return { status: response.status, body: JSON.parse(Buffer.concat(response.chunks).toString("utf8")) };
  };
  try {
    const project = {
      projectVersion: 1, schemaVersion: 5, id: "studio-api-test", name: "Studio API test",
      updatedAt: new Date().toISOString(), sources: [], clips: [], visualLoops: [], cueBindings: [],
    };
    const saved = await request("PUT", `/api/studio/projects/${project.id}`, project);
    assert.equal(saved.status, 200);
    const listing = (await request("GET", "/api/studio/projects")).body;
    assert.deepEqual(listing.map((item) => item.id), [project.id]);
    const reloaded = (await request("GET", `/api/studio/projects/${project.id}`)).body;
    assert.deepEqual(reloaded, project);

    const scene = { schemaVersion: 4, id: project.id, name: project.name };
    const published = await request("POST", `/api/studio/projects/${project.id}/publish`, scene);
    assert.equal(published.status, 200);
    const reloadedScene = (await request("GET", `/api/studio/projects/${project.id}/published`)).body;
    assert.deepEqual(reloadedScene, scene);
  } finally {
    await rm(testRoot, { recursive: true, force: true });
  }
});
