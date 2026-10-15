import test from "node:test";
import assert from "node:assert/strict";
import { mergePublishedScenes } from "../scene-registry.mjs";

test("player uses every server-published scene while preserving catalog order and browser-only scenes", () => {
  const catalog = [{ id: "first", name: "Catalog first" }, { id: "second", name: "Catalog second" }];
  const server = [{ id: "second", name: "Published second" }, { id: "custom", name: "Published custom" }];
  const local = { id: "local", name: "Browser-only scene" };
  assert.deepEqual(mergePublishedScenes(catalog, server, local).map((scene) => scene.name), [
    "Catalog first", "Published second", "Published custom", "Browser-only scene",
  ]);
  assert.equal(mergePublishedScenes(catalog, server, { id: "second", name: "Stale browser copy" })[1].name, "Published second");
});
