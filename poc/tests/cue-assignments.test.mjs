import test from "node:test";
import assert from "node:assert/strict";
import { assignedHotCues, deletedHotCues } from "../cue-crossings.mjs";

const observation = (hotCues, overrides = {}) => ({
  loaded: true, trackKey: "session:track:1", positionSeconds: 24, epochMs: 1000,
  hotCueMetadataBasis: "visible", hotCues, ...overrides,
});

test("new one-shot cues trigger immediately and new loop slots retain their audio position", () => {
  const before = observation([]);
  const after = observation([
    { cueIndex: 0, kind: "cue", timeSeconds: 23.9 },
    { cueIndex: 2, kind: "loop", timeSeconds: 8, lengthBeats: 64 },
  ], { epochMs: 1150 });
  const assigned = assignedHotCues(before, after, { bpm: 120 });
  assert.deepEqual(assigned.map((cue) => [cue.cueIndex, cue.elapsedBeats]), [[2, 32], [0, 0]]);
  assert.deepEqual(assignedHotCues(after, { ...after, epochMs: 1300 }, { bpm: 120 }), []);
});

test("anonymous new cue types still align to the stored start instead of the assignment press", () => {
  const assigned = assignedHotCues(observation([]), observation([
    { cueIndex: 7, kind: "unknown", timeSeconds: 12 },
  ], { epochMs: 1150 }), { bpm: 120 });
  assert.equal(assigned[0].elapsedBeats, 24);
});

test("existing cue slots reassign once when their start moves", () => {
  const before = observation([{ cueIndex: 1, kind: "cue", timeSeconds: 4 }]);
  const after = observation([{ cueIndex: 1, kind: "loop", timeSeconds: 16 }], { epochMs: 1150 });
  assert.equal(assignedHotCues(before, after, { bpm: 120 })[0].elapsedBeats, 16);
});

test("initial scans, new tracks, PAD reveals, and cached timelines do not masquerade as cue creation", () => {
  const after = observation([{ cueIndex: 0, kind: "cue", timeSeconds: 24 }], { epochMs: 1150 });
  assert.deepEqual(assignedHotCues(null, after, { bpm: 120 }), []);
  for (const overrides of [{ trackKey: "new-track" }, { loaded: false }, { hotCueMetadataBasis: "unavailable" }]) {
    assert.deepEqual(assignedHotCues(observation([], overrides), after, { bpm: 120 }), []);
  }
  assert.deepEqual(assignedHotCues(observation([]), { ...after, hotCueMetadataBasis: "cached" }, { bpm: 120 }), []);
});

test("cue deletion requires a visible same-track timeline and also works without a playhead", () => {
  const cues = [{ cueIndex: 0, kind: "cue", timeSeconds: 4 }, { cueIndex: 7, kind: "loop", timeSeconds: 8 }];
  const before = observation(cues);
  const after = observation([cues[0]], { epochMs: 1150, positionSeconds: NaN });
  assert.deepEqual(deletedHotCues(before, after).map((cue) => cue.cueIndex), [7]);
  for (const overrides of [{ hotCueMetadataBasis: "cached" }, { trackKey: "new-track" }, { loaded: false }]) {
    assert.deepEqual(deletedHotCues(before, { ...after, ...overrides }), []);
  }
  assert.deepEqual(deletedHotCues(null, after), []);
});
