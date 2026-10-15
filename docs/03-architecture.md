# Architecture and qualification targets

## Current recommendation

The current implementation has three modules around versioned scene and event contracts:

1. **Input adapters** — a headless C++20 Ableton Link/RtMidi bridge for optional clock and controller gestures, plus a macOS adapter that observes visible Rekordbox deck state through Accessibility. A local Node server supervises both and relays their evidence.
2. **Live Console and projector** — the browser scheduler, visual engine, scene queue, diagnostics, and a separate 16:9 output window. The output shares live state through `BroadcastChannel`.
3. **Scene Studio** — a separate browser authoring UI that saves source ranges and ordered visual loops, prepares clips with FFmpeg, and publishes runtime scenes. Its loop preview uses the Live Console visual engine.

This isolates device integration from presentation and avoids maintaining different preview and projector renderers. The bridge is intended to be cross-platform; the Rekordbox deck-state adapter currently has a macOS implementation only. The C++ process remains deliberately headless and narrow.

A native C++/SDL renderer remains a fallback, not the default plan. Promote it only if measured 1080p dual-deck soak tests show browser frame pacing, decode, or projector fullscreen behavior cannot meet the performance targets.

## Runtime flow

```text
Visible Rekordbox decks ─> macOS Accessibility adapter ─┐
Controller MIDI ────────> C++ Link/MIDI bridge ──────────┼─> local Node relay ──SSE──> Live Console
Ableton Link (optional) ──────────────────────────────────┘                         │
                                                                                   BroadcastChannel
Scene Studio ──save/prepare/publish──> local scene API ──> published scenes ────────┤
                                                                                   projector window
```

## Why the process boundary matters

- A controller disconnect or MIDI parsing bug need not block the browser renderer.
- The bridge and deck-state adapter can be tested with captured evidence; Live Console also records resolved visual state for controller-free replay.
- Simulated and recorded input exercises Live Console and automated tests; Studio preview uses the same visual engine with its own BPM control.
- The local server supervises bridge restarts independently of the browser windows.
- Ableton Link licensing choices remain localized. Link is dual-licensed GPLv2+ and commercially; distribution needs a deliberate license decision.

The bridge writes a versioned JSON Lines evidence stream, and the local server delivers current state and events to the browser over Server-Sent Events. Clock messages are replaceable snapshots; cue/load/play events carry sequence numbers and source timestamps. Live Console's session recorder captures both bridge evidence and resolved visuals, but references local media instead of embedding it.

Illustrative message:

```json
{
  "v": 1,
  "seq": 1842,
  "sourceTimeUs": 9012338400,
  "emittedAtUnixMs": 1788400000000,
  "source": "controller-midi",
  "type": "controller.control",
  "payload": {
    "event": "hotcue.a", "deck": 2, "value": 1.0,
    "rawValue": 127, "resolutionBits": 7, "active": true
  }
}
```

Do not expose a network listener beyond loopback in the first release.

## Clock model

Ableton Link can supply shared session tempo, beat, and phase. It does not identify tracks, decks, hot cues, or which channel is audible. On the primary macOS path, `rekordbox.deck-state` v2 instead observes each visible deck's BPM and playhead, infers absolute transport with hysteresis, and publishes an observed or explicitly estimated beat position. Link stays an optional higher-confidence phase source rather than a requirement.

Beat Sync and Link are related but separate:

- **Beat Sync** is Rekordbox’s deck-to-deck beat-grid synchronization.
- **Ableton Link** is a free synchronization capability built into Rekordbox and other apps. Ableton Live is not required or installed separately.

Link has no permanent “master application.” Rekordbox still has a sync-master deck for Beat Sync. Each visual deck keeps its own sequence clock, anchored to its observed playhead when available. Coherent Hot Cue positions can estimate a beat-grid offset; otherwise phase is labeled as a low-confidence track-time-zero estimate. **Tap downbeat** corrects the visual phase without changing BPM. Deck identity matters for transport, cue actions, scene assignment, and visual mixing; Link does not provide any of those identities.

## Master and dominant deck semantics

The user’s proposed deck-1-to-deck-2 handoff should not be assumed from the crossfader alone.

- On the GRV6, Beat Sync toggles synchronization and Shift + Beat Sync sets that deck as sync master.
- Rekordbox documents explicit master selection. Unloading/changing the master track may cause the other deck to become master, but crossfader dominance is not documented as an automatic master switch.
- Therefore, visual dominance must not be treated as Rekordbox **sync master**. Current inputs do not expose a confirmed master identity; leave it unknown rather than inferring it from the crossfader.
- Visual phase follows the selected observed deck clock, or Link when it is active and the deck-state path is unavailable. Hot-cue actions use the deck that emitted the controller event. Song qualification uses play/hot-cue first and dominant-deck crossing as a fallback.

## Song qualification

Each deck has a monotonically increasing `loadGeneration`. On macOS it advances from a newly visible track identity as well as controller LOAD, with a five-second deduplication window covering the same physical load. A generation counts once when the first qualifying event arrives:

1. play;
2. a hot cue that starts/continues playback;
3. the deck crosses the configured dominance threshold.

Repeated cue hits and fader movement do not increment the diagnostic count. Scene assignment is stricter: every new load claims the current item in the global ordered scene queue. Its ×1–×8 multiplier is consumed across both decks, then the cursor advances. Play, hot-cue, and dominance events never advance that queue.

## Visual deck mixer

Each loaded audio deck has an independent visual scene instance. Transport and visibility are separate:

- load seeks the default visual loop's first event to its first configured source frame;
- play advances that deck's video and musical sequence;
- pause freezes the current decoded frame and beat position;
- channel level and crossfader position set the deck's relative visual opacity.

For two decks and a linear crossfader position `x` in `[0, 1]`:

```text
raw1 = loaded1 × level1 × (1 - x)
raw2 = loaded2 × level2 × x
opacityN = rawN / (raw1 + raw2)
```

The normalized opacities total 1 when at least one raw weight is nonzero. If both are zero, output is black. These controls represent fader intent, not measured audio amplitude; true loudness would require a later master-audio capture path.

## Browser performance engine

- `VisualEngine` schedules musical timelines and drives browser video elements; authored Studio previews and Live Console use the same resolver and appearance rules.
- Local H.264 performance excerpts avoid network playback during a set. Studio uses FFmpeg before publication to prepare trimmed clips, then the browser decodes them. Fully covered Studio lanes stay timed but need not decode until revealed.
- Each event can specify source in-point, repeat/hold behavior, rate, opacity, blend, filters, and optional pan/zoom. Full-frame `contain` is the default for new Studio events; fill/crop is explicit.
- The projector is a separate browser window with a 16:9 output frame. The operator chooses its display and fullscreen mode; the application does not yet own OS-level display selection or presentation timing.
- The Bridge drawer distinguishes live, stale, Link-only, manual, and replay states and checks loaded/next-scene media. Missing input must not silently masquerade as confirmed Rekordbox state.
- Keep downloads, source search, agent work, and transcodes outside the performance path. A native renderer remains a measured fallback, not an active dependency.

## Studio

Scene Studio has a full-source timeline and moving ten-second detail timeline for defining clips, then a lane-based musical Loop Builder. Reordering loops maps the first eight to Hot Cues A–H; the starred default is separate. Every authored visual loop repeats, while audio jump/loop classification comes from live Rekordbox evidence when available. Studio saves editable schema-v5 projects and publishes compiled schema-v4 scenes through the local API. Save and Publish are separate; unpublished edits cannot replace a live scene. The set queue and projector controls remain in Live Console. An agent may use the local authoring API, but discovery and editing automation are not yet an integrated Studio feature.

## Scene contract

Versioned JSON is human-readable and agent-editable. A clip describes media only. Each visual loop owns a repeating musical timeline; each event owns its clip reference, source timestamp, duration, appearance, and optional motion. The same clip can therefore be static in one loop, slowly reframed in another, and briefly filtered in a third. Subject recognition is an offline authoring aid; the live renderer consumes only normalized focus points and deterministic keyframes. The built-in catalog has 36 film-scene entries: 28 playable scenes with 12 clips each and eight source-needed concepts. The [runtime schema](07-scene-schema.md), [Studio authoring model](12-scene-studio.md), and [scene queue](10-scene-catalog-and-sequencer.md) contain the detailed contracts.

## Performance targets

Initial target: 1920x1080 at 60 Hz, two simultaneous deck scene instances with bounded rule layers, one external display, with Rekordbox running normally.

- Quantized switch visible within two display frames of its intended boundary at p95.
- Internally scheduled event-to-render-state within one frame at p95.
- No stale or black frame during 100 consecutive switches.
- No output drops or Rekordbox audio glitch during a 30-minute soak.
- No synchronous media load on a performance boundary.
- Stable output through 10 seconds of bridge loss and safe recovery.

Internal telemetry is not button-to-photon proof. Final latency must be measured with a high-frame-rate camera showing the GRV6 action/LED and projector image together.
