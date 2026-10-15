import test from "node:test";
import assert from "node:assert/strict";
import { SessionRecorder, SessionReplayer, shiftedSnapshot } from "../session-recorder.mjs";

const snapshot = (time, playing = true) => ({
  linkClock: { bpm: 120, playing, anchorBeat: 0, anchorEpochMs: time },
  phraseClock: { bpm: 120, playing, anchorBeat: 0, anchorEpochMs: time },
  decks: [{ loaded: true, playing, clock: { bpm: 120, playing, anchorBeat: 0, anchorEpochMs: time } }],
});

test("recording keeps controller evidence and replays resolved visuals without a bridge", () => {
  let time = 1000;
  const recorder = new SessionRecorder(() => time);
  recorder.start(snapshot(time));
  time += 10;
  recorder.captureBridge({ type: "midi.raw", payload: { bytes: [144, 1, 127] } });
  time += 40;
  recorder.captureSnapshot(snapshot(time, false));
  const session = recorder.stop(snapshot(time, false));
  assert.equal(session.events.filter((event) => event.type === "bridge").length, 1);
  assert.equal(session.events.filter((event) => event.type === "snapshot").length, 3);
  const painted = [];
  const timers = [];
  const replay = new SessionReplayer(session, (value) => painted.push(value), {
    now: () => time,
    setTimer: (fn) => { timers.push(fn); return timers.length; },
    clearTimer: () => {},
  });
  time = 5000;
  replay.start();
  assert.equal(painted[0].decks[0].clock.anchorEpochMs, 5000);
  time += 50;
  timers.shift()();
  assert.equal(painted.at(-1).decks[0].playing, false);
  assert.equal(painted.at(-1).decks[0].clock.anchorEpochMs, 5050);
});

test("snapshot clock rebasing does not mutate the recorded state", () => {
  const original = snapshot(123);
  assert.equal(shiftedSnapshot(original, 500).decks[0].clock.anchorEpochMs, 623);
  assert.equal(original.decks[0].clock.anchorEpochMs, 123);
});

test("rapid cue changes are recorded even when continuous snapshots are throttled", () => {
  let time = 1000;
  const recorder = new SessionRecorder(() => time);
  const state = snapshot(time);
  state.decks[0].activeLoopId = "song-default";
  recorder.start(state);
  time += 5;
  recorder.captureSnapshot(state); // a clock-only update inside the 30 Hz window
  state.decks[0].activeLoopId = "cue-a-loop";
  recorder.captureSnapshot(state);
  time += 5;
  state.decks[0].activeLoopId = "cue-b-loop";
  recorder.captureSnapshot(state);
  const session = recorder.stop(state);
  assert.deepEqual(session.events.filter((event) => event.type === "snapshot").map((event) => event.value.decks[0].activeLoopId), [
    "song-default", "cue-a-loop", "cue-b-loop", "cue-b-loop",
  ]);
});
