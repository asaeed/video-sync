# Direction validation: scenes, visual loops, cues, and the bridge

Date: 2026-09-03

## Verdict

The new content model has replaced the original rule model in the browser POC. `Scene -> clips -> visual loops -> timeline events` is understandable, authorable, and compatible with both manual live control and agent-generated defaults. The implemented contract lives at [`schema/scene.schema.json`](../schema/scene.schema.json).

It is not all proven. Automatic song-to-scene mapping depends on live track identity, which Ableton Link does not provide and generic controller MIDI may not provide. That feature must stay optional until the bridge spike identifies a reliable source. Queue-based or manual scene assignment is the safe fallback.

## Recommended model

### Scene

A reusable visual world containing:

- any number of immutable source clips;
- one or more visual loops;
- one default loop;
- hot-cue mappings to persistent visual-loop selection;
- optional scene defaults and provenance.

### Visual loop

A repeating timeline with an explicit musical length. A loop can contain one event using one clip, or a sequence of overlapping events spread across measures and beats.

The name is understandable, but it collides with Rekordbox's audio-loop concept. The UI should consistently say **Visual Loop**; code can use `visualLoops` so logs and support messages remain unambiguous.

### Timeline event

One occurrence of one clip:

```json
{
  "id": "event-2",
  "at": { "bars": 4, "beats": 0 },
  "duration": { "bars": 4 },
  "clipId": "clip-2",
  "source": { "startSeconds": 1.5, "loop": true, "rate": 1 },
  "appearance": {
    "z": 0,
    "opacity": 1,
    "blendMode": "normal",
    "fit": "cover",
    "filters": []
  }
}
```

Filters belong here, not on the clip. This permits the same media to be raw in one loop and altered in another.

### Cue binding

Every configured cue selects a visual loop. A scene may leave later cue slots unbound. The cue metadata distinguishes an audio loop from an audio jump:

```json
{
  "input": "hotCueA",
  "cue": { "type": "loop", "length": { "bars": 4 } },
  "visual": { "loopId": "cue-a-loop", "retrigger": "audio-loop-cycle" }
}
```

```json
{
  "input": "hotCueC",
  "cue": { "type": "jump" },
  "visual": { "loopId": "cue-c-loop", "retrigger": "cue-trigger" }
}
```

Both loops remain active until another cue or scene replaces them. Metropolis Machine's C loop holds Clip 6 for four bars and flashes Clip 7 over it. `source.loop: true` repeats shorter media from its configured non-zero in-point inside an event; the event also seeks to that timestamp whenever its visual loop repeats.

Normal deck play starts `defaultLoopId`. Loading without play shows the first frame of its first event. Pause freezes every visible video.

## Why the original clip buttons felt broken

They are not general clip selectors. In the original v2 POC they simulated Hot Cues A-C and revealed Clips 1-3 for only `0.25` beats. At 124 BPM that is about 121 ms. If the requested clip was already visible, the action had no obvious visual difference. The behavior was technically deterministic but poor interaction design.

The v4 player removes that ambiguity. Each configured Hot Cue selects a named, persistent visual loop and remains highlighted while selected. Repeated clicks restart the chosen loop at its first event. A jump cue has nothing to “return” to; it stays active until a later cue. Inactive video elements are explicitly paused and hidden, preventing an earlier cue's inline opacity from covering the newly selected cue.

## Song-to-scene mapping: the hard dependency

A stored mapping is easy:

```json
{
  "trackKey": "provider-or-library-stable-id",
  "sceneId": "metropolis-machine"
}
```

Applying it live is not yet easy. Link provides a musical session clock, not loaded-track or deck identity. The published GRV6 MIDI list gives control gestures and positions, but a load/browse action does not necessarily include the selected track's identity. Reading Rekordbox's local analysis data can tell us about known tracks but not reliably which one is currently playing.

Therefore:

- support explicit mappings only after a stable live `trackKey` is proven;
- never infer identity from BPM or waveform similarity in the live path;
- make the ordered scene queue fully usable without track identity;
- allow manual override from compact Live mode.

## Queue semantics

Each item should be explicit:

```json
{
  "sceneId": "metropolis-machine",
  "songCount": 3
}
```

With independent visual decks, advancing the queue must not replace both active deck scenes in the middle of a transition. Recommended behavior:

1. the active queue item supplies the scene assigned to newly loaded decks;
2. each newly qualified track consumes one song from that item;
3. when the count is exhausted, the next item becomes **pending**;
4. the pending scene is assigned on the next deck load/qualification;
5. the outgoing deck keeps its existing scene until it is unloaded or faded away.

This creates a musically natural handoff instead of a global visual cut. A manual `Apply now` action can remain available.

## Live and Author modes

One shell with two densities is reasonable:

- **Live:** projector preview, bridge health, deck/scene state, current and next queue items, `songs remaining`, reorder, `+/- songs`, next/previous, freeze, and manual apply.
- **Author:** expands the media bin, visual-loop timeline, cue mappings, preview clock, provenance, validation, and agent conversation.

They should share UI and data contracts, but not unrestricted runtime behavior. AI search, generation, editing, downloads, and transcodes must be disabled from the performance-critical process. Authoring produces a versioned, immutable, preflighted performance pack; Live consumes that pack. An agent can prepare or revise a draft, but it must not mutate the active pack during a set.

## Bridge spike: do this before deeper authoring work

The recorder foundation and first live GRV6 coexistence capture are implemented; labeled mapping and soak tests remain before a richer editor.

### Inputs to probe

- read-only Ableton Link snapshots: tempo, beat/time mapping, phase at 4/8/16-beat quanta, optional start/stop intent, peer state;
- passive DDJ-GRV6 MIDI for play/pause, Hot Cues A-C, channel faders, and crossfader;
- Rekordbox MIDI indicator output only as a secondary state probe if it adds something the controller cannot expose;
- audio-loop wrap/reset if available, otherwise deterministic configured-length prediction;
- endpoint availability and behavior across disconnect/reconnect.

### Output contract

Record both raw evidence and normalized events. Every normalized field should carry capability/quality state such as `observed`, `inferred`, or `unavailable`; do not simulate unavailable Rekordbox facts as if they were confirmed.

### Minimum success criteria

- Video Sync joins Link without proposing tempo or transport changes.
- Beat/time conversion remains stable through tempo changes and Link loss/rejoin.
- The minimum GRV6 controls remain observable by a second process without affecting Rekordbox.
- Recorded input can replay deterministically into the viewer and produce the same sequence decisions.
- No Rekordbox audio glitch, controller behavior change, or measurable render-thread blocking occurs during a 30-minute baseline.

Failure to observe track identity does not kill the product. It means v1 uses queue/manual scene assignment and defers automatic per-track mapping.

## Recommended order

1. Run the implemented Link/direct-GRV6 recorder with Rekordbox and complete labeled A/B deck captures.
2. Freeze the normalized bridge event contract based on observed data.
3. Build compact queue-oriented Live mode on the implemented visual-loop contract.
4. Expand the same shell into Author mode.
5. Add agent-assisted scene creation only after validation and preflight rules exist.
