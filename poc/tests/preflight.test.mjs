import test from "node:test";
import assert from "node:assert/strict";
import { inputReadiness, sceneMediaPlan } from "../preflight.mjs";

test("preflight distinguishes live, stale, manual, and replay input", () => {
  const now = 10_000;
  assert.equal(inputReadiness({ bridgeState: "running", signals: { controller: 9_000 } }, now).mode, "Live input");
  assert.equal(inputReadiness({ bridgeState: "missing", signals: { rekordbox: 9_000 } }, now).mode, "Live input");
  assert.equal(inputReadiness({ bridgeState: "running", signals: { link: 9_000 } }, now).mode, "Link tempo only");
  assert.equal(inputReadiness({ bridgeState: "running", signals: { midi: 9_000 } }, now).mode, "Manual / emulator");
  assert.equal(inputReadiness({ bridgeState: "running", signals: { controller: 1_000 } }, now).mode, "Manual / emulator");
  assert.equal(inputReadiness({ replaying: true, bridgeState: "running", signals: { controller: 9_000 } }, now).mode, "Replay");
});

test("preflight separates local scene files from media needing a connection", () => {
  const result = sceneMediaPlan({ clips: [
    { id: "one", src: "/poc/assets/one.mp4" },
    { id: "two", src: "/poc/assets/one.mp4" },
    { id: "three", src: "https://archive.org/film.mp4" },
    { id: "four", src: "" },
  ] }, "http://127.0.0.1:4316/poc/");
  assert.equal(result.localUrls.length, 1);
  assert.equal(result.remoteUrls.length, 1);
  assert.deepEqual(result.missingUrls, ["four"]);
});
