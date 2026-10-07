import assert from "node:assert/strict";
import test from "node:test";
import { mediaTimeForMusicalOffset } from "../media-time.mjs";

test("authored clip windows loop between their in and out points", () => {
  const source = { startSeconds: 5, endSeconds: 7, loop: true, rate: 1 };
  assert.equal(mediaTimeForMusicalOffset(source, 0, 120, 20), 5);
  assert.equal(mediaTimeForMusicalOffset(source, 5, 120, 20), 5.54);
});

test("hold events stop at the last frame inside the authored clip window", () => {
  const source = { startSeconds: 5, endSeconds: 7, loop: false, rate: 1 };
  assert.equal(mediaTimeForMusicalOffset(source, 20, 120, 20), 6.96);
});
