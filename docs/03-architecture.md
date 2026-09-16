# Proposed architecture

## Current recommendation

Build three modules around one versioned scene and event contract:

1. **`performance-bridge`** — a small C++20 process using Ableton Link for musical clock and RtMidi for confirmed, passive DDJ-GRV6 controls alongside Rekordbox.
2. **`browser-viewer`** — the existing deterministic JavaScript scheduler plus browser hardware video decoding and CSS/WebGL composition in a dedicated projector window.
3. **`studio-player`** — the browser operator UI for scene authoring, set queueing, diagnostics, and live control, reusing the same viewer code for preview.

This gives macOS and Windows one deterministic renderer while isolating device integration from presentation. The C++ process remains deliberately headless and narrow. The browser implementation has already shown good behavior in the POC and avoids duplicating the preview and projector renderers.

A native C++/SDL renderer remains a fallback, not the default plan. Promote it only if measured 1080p dual-deck soak tests show browser frame pacing, decode, or projector fullscreen behavior cannot meet the performance targets.

## Runtime flow

```text
Rekordbox 7.2.2 ─ Ableton Link ─────────┐
DDJ-GRV6 ─ passive MIDI subscription ───┴─> performance-bridge ─> local event contract ─┐
                                                                               v
Scene JSON ─> media validation ─> preload/cache ─> scheduler ─> viewer-core
                                                            │          │
                                                            │          ├─ Metal (macOS)
Studio / Player controls ────────────────────────────────────┘          └─ D3D11/Vulkan (Windows)
                                                                               │
                                                                               v
                                                                  projector display
```

## Why the process boundary matters

- A controller disconnect or MIDI parsing bug cannot block the render thread.
- The bridge can be tested with a recorder/replayer before a native renderer exists.
- A simulated bridge feeds Studio previews and automated tests through the same contract.
- Viewer watchdog and bridge restart policy stay simple.
- Ableton Link licensing choices remain localized. Link is dual-licensed GPLv2+ and commercially; distribution needs a deliberate license decision.

The spike writes a versioned JSON Lines evidence stream. The runtime protocol can use compact JSON over loopback UDP once its fields are based on a live Rekordbox capture. Clock messages are replaceable snapshots; cue/load/play events carry sequence numbers and monotonic timestamps. A missed snapshot is harmless because a newer one replaces it. Important edge events can be acknowledged or repeated briefly with the same ID for deduplication.

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

Ableton Link supplies shared session tempo, beat, and phase. It does not identify tracks, decks, hot cues, or which channel is audible. The bridge captures a Link session state against a monotonic host clock, and the viewer calculates future beat boundaries locally rather than receiving a stream of approximate beat ticks.

Beat Sync and Link are related but separate:

- **Beat Sync** is Rekordbox’s deck-to-deck beat-grid synchronization.
- **Ableton Link** is a free synchronization capability built into Rekordbox and other apps. Ableton Live is not required or installed separately.

Link has no permanent “master application.” Rekordbox still has a sync-master deck for Beat Sync. Each visual deck keeps its own sequence clock, anchored to the Link timebase when started. Deck identity matters for transport, cue actions, scene assignment, and visual mixing; Link does not provide any of those identities.

## Master and dominant deck semantics

The user’s proposed deck-1-to-deck-2 handoff should not be assumed from the crossfader alone.

- On the GRV6, Beat Sync toggles synchronization and Shift + Beat Sync sets that deck as sync master.
- Rekordbox documents explicit master selection. Unloading/changing the master track may cause the other deck to become master, but crossfader dominance is not documented as an automatic master switch.
- Therefore, the bridge tracks **sync master** and **audible/dominant deck** as separate state.
- Visual phase follows Link. Hot-cue actions use the deck that emitted the controller event. Song qualification uses play/hot-cue first and dominant-deck crossing as a fallback.

## Song qualification

Each deck has a monotonically increasing `loadGeneration`. A generation counts once when the first qualifying event arrives:

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

## Viewer-core

### Threads

- **Input:** receive and timestamp bridge messages.
- **Scheduler:** convert beat rules to presentation times and publish immutable render state.
- **Decode pool:** pre-open and decode current plus next-scene clips.
- **Render:** display-linked, allocation-free composition and presentation.
- **Control/UI:** never owns media timing.

### Media

- Decode with FFmpeg on both platforms; prefer VideoToolbox on macOS and D3D11VA where stable on Windows.
- Present through SDL3 and native GPU textures.
- Keep a CPU-decoding fallback for compatibility and diagnostics.
- Pre-roll every current-scene clip and at least the next scene before it becomes eligible.
- Benchmark H.264/HEVC delivery media against short-GOP or intra-frame intermediates such as ProRes 422 LT and DNxHR. Choose from measured seek latency, memory, and disk bandwidth.
- Normalize the first target to 1920x1080, 60 fps, yuv420p, no audio.

### Scheduling

- Store musical durations as rational beat values; `1/16 note = 1/4 beat` in 4/4.
- Recompute future recurring events when tempo changes.
- Dispatch predecoded state ahead of the intended presentation boundary by a measured per-display lead time.
- Never parse JSON, open files, allocate large buffers, or invoke AI on a performance boundary.

### Display safety

- Borderless full-screen output on a specifically selected external display.
- Blackout, freeze, test pattern, diagnostics toggle, and cursor hiding.
- If the display disconnects, keep the operator UI local and do not move it automatically.
- If Link or MIDI disappears, continue at the last stable tempo while clearly flagging degraded sync.

## Studio

The first Studio should have only:

- media bin and provenance;
- visual-loop timeline editor with measure/beat placement;
- clip source time and looping controls per timeline event;
- optional filters and beat-clocked pan/zoom motion attached to one event appearance, with raw video as the default;
- explicit audio Hot Cue -> persistent visual-loop mappings;
- BPM simulator and native-render preview;
- scene cue-order mapping;
- set queue and after-N-songs behavior;
- media validation and performance estimate;
- Player launch, display selection, and health.

Tauri is appropriate for the shell because it is cross-platform and small, but `viewer-core` remains the authority for preview and show output so the Studio cannot silently diverge from live behavior.

## Scene contract

Versioned JSON is human-readable and agent-editable. A clip describes media only. Each visual loop owns a repeating musical timeline; each event owns its clip reference, source timestamp, duration, appearance, and optional motion. The same clip can therefore be static in one loop, slowly reframed in another, and briefly filtered in a third. Subject recognition is an offline authoring aid; the live renderer consumes only normalized focus points and deterministic keyframes. The browser POC consumes a 36-scene film-footage runtime catalog; all 28 playable scenes have 12 clips and v4 persistent-loop mappings, while the eight source-needed wishlist contracts retain placeholders. The implemented queue semantics and media status are in [scene catalog and set sequencer](10-scene-catalog-and-sequencer.md). The direction and remaining integration constraints are in [the direction validation](08-direction-validation.md).

## Performance targets

Initial target: 1920x1080 at 60 Hz, two simultaneous deck scene instances with bounded rule layers, one external display, with Rekordbox running normally.

- Quantized switch visible within two display frames of its intended boundary at p95.
- Internally scheduled event-to-render-state within one frame at p95.
- No stale or black frame during 100 consecutive switches.
- No output drops or Rekordbox audio glitch during a 30-minute soak.
- No synchronous media load on a performance boundary.
- Stable output through 10 seconds of bridge loss and safe recovery.

Internal telemetry is not button-to-photon proof. Final latency must be measured with a high-frame-rate camera showing the GRV6 action/LED and projector image together.
