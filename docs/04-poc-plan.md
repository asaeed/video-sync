# Proof-of-concept plan and status

> The POC 0 verification snapshot below records the September 2026 experiment, including interface studies and AI footage that were later removed. It is not a description of today's UI. For current state and next work, see [project context](project-context.md), [architecture](03-architecture.md), and [Scene Studio](12-scene-studio.md).

## POC 0: browser interaction and scheduling model — historical baseline

Run `npm run dev` and open <http://127.0.0.1:4316/>.

Implemented in that early baseline:

- simulated 80–180 BPM musical clock;
- deterministic bar/beat scheduler;
- a film-footage scene catalog with twelve independent clips in every playable scene;
- an independent scene and transport clock for each deck;
- one-clip default loops that hold the scene's normal, non-cued visual rather than cycling through its clips;
- predictable default/A–G clip mappings, with visible Hot Cue H selecting a loop generated when its deck is loaded and Metropolis retaining its original 1/2/3/4-bar first four loop lengths;
- overlapping timeline-event support down to `0.25` beats (a 1/16 note);
- each available Hot Cue mapped to persistent loop activation, with all eight A–H controls visible and unmapped cues using the deck's generated random loop;
- short A/B/C controls, a selected-loop data pane, and repeated cue segments drawn on the 16-bar timeline;
- audio-loop metadata for A/B and audio-jump metadata for C, without changing the persistent visual behavior;
- source media repeats inside a longer event and restarts when the visual-loop event occurrence repeats;
- loaded-first-frame, playing-motion, and paused-freeze behavior;
- crossfader/channel-level weights normalized into a 100% two-deck visual mix;
- separate output window synchronized over a local `BroadcastChannel`;
- per-load song qualification and deduplicated song counting for future queue advance;
- play, hot-cue, and dominance qualification simulation;
- a continuously looping 16-bar phrase display and optional accented metronome;
- switch/frame p95 and dropped-frame diagnostics;
- an interactive schema/input-data explainer and ten selectable interface directions;
- a supervised headless Link/MIDI bridge with a scrollable event feed beneath the preview.
- a pointer- and keyboard-resizable divider between preview and controls, with a saved desktop pane ratio.

Automated tests cover note conversion, loaded preview, default and alternate loop timing, overlapping events, filter defaults, opacity normalization, Link-clock adoption, normalized controller commands, song deduplication, and the checked-in scene contract.

This browser POC demonstrates the sequencing rules and interaction model, but its short internal timing samples do not establish controller-to-projector latency or a sustained dual-deck performance result. Browser rendering remains the current implementation; a native decoder is only a fallback if measured tests require one.

The original clip buttons were an acknowledged design failure: they exposed brief temporary appearances and reused the active sequence's video nodes. The v4 player makes every configured cue a named-loop selection. A jump cue's visual remains selected until another cue or scene replaces it; the visual-loop length is a repeat boundary, not a timeout.

### Verification snapshot — 2026-09-03

- Seventeen scheduler, metronome, persistent-cue, scene-contract, bridge-control/replay, filter-default, and opacity-normalization tests pass.
- All seven scene video files probe as H.264, yuv420p, 1920x1080, 60 fps, and approximately eight seconds.
- The three AI-source MP4s were re-rendered with baked-in Ken Burns motion: an 18% push-in, an 18% pull-out, and a 14% push-in with lateral drift. The viewer contributes no motion effect.
- Browser QA confirmed that a newly loaded deck displays Clip 1 at time zero while all of its videos are paused.
- Play advanced video and enabled the platter animation; pause stopped the animation and produced zero media-time drift over a 600 ms observation.
- At center crossfader with Deck 1 level 100% and Deck 2 level 50%, preview and projector output both reported opacity `0.666667 / 0.333333`, summing to 1.
- The schema and interface-direction pages had no horizontal overflow at 1440 px or 390 px. The direction page rendered three raw, unfiltered, playing videos and enforced a maximum of three selections.
- The projector output's short automated sample reported 9.7 ms frame-interval p95 and zero decoded-video drops. This is a smoke-test observation, not evidence of projector latency or native-renderer readiness.
- No browser console errors were reported across the tested pages.
- Earlier browser QA alternated configured cues 18 times, confirmed the selected cue remained highlighted, and found no temporary cue nodes. Pause produced zero measured media-time drift, and the projector received the same persistent selection and normalized visual mix.
- The original single-clip Metropolis regression sequence was superseded by explicit two-clip timelines. Current automated and Playwright checks cover sequence, alternate, flash-overlay, call-response, crossfade, random fallback, and event in-points.
- The integrated bridge panel received the headless process's ready and Link events. With Rekordbox open but not joined/routed, the observed state was `120.0 BPM`, `0 peers`, and `0 MIDI messages`; this is a useful negative result, not proof of Rekordbox control capture.
- At that snapshot, the bridge panel sat below the preview and retained up to 500 timestamped status, Link-state-change, raw MIDI, and normalized-control rows. It is now a left-side Live Console drawer with performance preflight.

## POC 1: Link/MIDI bridge recorder — foundation implemented

The native C++ and macOS adapter spike now includes:

- official Ableton Link client;
- RtMidi port discovery by index or name, a macOS virtual self-test input, direct GRV6 input, and a timestamped raw event monitor;
- a versioned JSON Lines envelope and append-only recorder;
- exact CSV mappings with button, 7-bit, and paired 14-bit normalization while preserving raw evidence;
- a two-message virtual-MIDI self-test;
- Link peer/clock snapshots and monotonic source timestamps.
- supervision by the development server plus an SSE/JSON diagnostics surface consumed by the emulator.
- display-frame coalescing for high-rate 14-bit faders and sampled continuous rows in the visible feed, while the evidence recording remains lossless for controller events.
- a deck-state v2 normalization layer with playhead-derived absolute transport, visible track fingerprints/load generations, cue metadata, loop-wrap correction, and phase confidence.

The local build produced Link clock snapshots and passed its CoreMIDI self-test. On 2026-09-04 it also opened `DDJ-GRV6` while Rekordbox 7.2.2 played and captured Play/Pause, Beat Sync, LOAD 1/2, and 14-bit tempo-fader messages matching AlphaTheta's published table. Direct MIDI is therefore the primary live-control path; the Rekordbox virtual-input experiment received no data. LOAD 1/2, Hot Cue A-H, channel-level, crossfader, and Beat FX rows are now in the device profile and drive the browser POC. The verified LOAD rows use channel-7 notes 70 and 71; the combined system still needs a performance soak test.

Remaining exit criteria:

- visible title and loop metadata remain stable across supported Rekordbox layouts;
- inferred transport starts correctly mid-song and does not bounce after Stop;
- phase remains aligned through tempo changes, start/stop, seeks, and manual downbeat correction;
- receives only published and capture-confirmed GRV6 MIDI messages;
- does not change Rekordbox/controller behavior;
- unplug/replug, adapter restart, and optional-Link loss recover safely.

## POC 2: browser viewer qualification — still open

Qualify the existing browser compositor against captured bridge data, Rekordbox, and an actual projector. Scene Studio is already implemented as a browser authoring surface; this qualification remains open. Consider a native viewer only if measured browser performance misses the target after profiling.

Behavior:

- one operator window and one borderless projector window;
- current and next scenes preloaded;
- the same rules as POC 0;
- keyboard and recorded bridge triggers;
- freeze, next/previous, resync, diagnostics;
- requested boundary, state dispatch, presented frame, lateness, and dropped-frame logs.

Exit criteria on the real projector:

- 1920x1080 at 60 Hz;
- p95 quantized switches within two output frames;
- no stale/black frame across 100 consecutive switches;
- 30-minute soak with no dropped output frames or Rekordbox audio disturbance;
- measured button-to-photon delay and stable compensation range.

## POC 3: browser Scene Studio — implemented vertical slice

Scene Studio now edits source ranges and ordered loops in the browser, uses the Live visual engine for preview, prepares trimmed clips with FFmpeg, and saves and publishes through a local API. There is no Tauri shell or separate native preview renderer.

Remaining authoring work:

- improve source discovery and agent-assisted clip selection outside the live runtime;
- make packages practical when the source is a full film;
- extend portable exports from one scene to a multi-scene set;
- qualify authoring and playback behavior against real projector and hardware use.

## Recommended order

1. Complete labeled Rekordbox Accessibility and direct-controller captures on both decks, including hot-cue loop wraps and software-only loads.
2. Benchmark the browser viewer on the actual projector at dual-deck 1080p load, with a 30-minute soak and physical button-to-photon measurement.
3. Fix only observed sync, decode, or recovery failures; keep a native viewer as a measured fallback.
4. Improve source preparation, packages, and agent-assisted authoring without putting that work on the live path.

This sequencing separates clock, controller, renderer, and editor risk so a failure in one is diagnosable.
