# Rekordbox deck-state v2

`rekordbox.deck-state` is the normalized live contract between a platform adapter and the browser player. The first adapter observes visible Decks 1 and 2 through macOS Accessibility. A future Windows adapter should emit the same payload without changing the scheduler.

## Truth and confidence

The contract separates observed facts from inference:

- `bpm`, `positionSeconds`, `trackTitle`, and raw Hot Cue fields originate in visible Rekordbox controls;
- `trackFingerprint` is a non-reversible hash of normalized visible identity, not a Rekordbox library ID;
- `transportKnown`, `playing`, and `transportBasis` come from playhead motion/stability, with controller messages used only as a short low-latency hint;
- `beatPosition`, `beatPhase`, `phaseBasis`, and `phaseConfidence` state whether phase came from an observed beat counter, coherent cue-grid estimate, or track-time-zero estimate;
- unavailable cue type or identity remains `unknown`, `null`, or `unavailable`.
- `hotCueMetadataVisible` states whether the deck's PAD / Hot Cue grid is currently exposed by Rekordbox. When it is hidden, `hotCueMetadataBasis: cached` preserves the last cue timeline observed for that track during the current bridge session instead of falsely replacing it with an empty list, including when the track is loaded again.

Top-level `capabilities` describe what the current adapter can attempt. Per-deck fields describe what the current Rekordbox layout actually exposed.

## Transport

Forward continuous playhead motion confirms playback. A stable playhead for 500 ms confirms pause. A backwards jump does not imply pause because it may be a seek, Hot Cue, or audio-loop wrap. Play/Pause, LOAD, and Hot Cue controller edges supply a 400 ms hint so the visual responds before the coarse visible playhead changes; later playhead evidence wins.

Starting Video Sync during an already-playing song therefore converges to `playhead-motion` without relying on button-press parity. Starting during pause converges to `playhead-stable`.

## Loads and identity

Each adapter session maintains `loadGeneration` per deck. It advances when:

- an unloaded deck becomes loaded; or
- the visible track fingerprint changes.

The browser treats the generation or fingerprint transition as a scene-queue load. A controller LOAD within five seconds owns that same load, preventing the later visible-title update from consuming a second scene. A new adapter process does not by itself count as a new song.

Loading the same track again without a controller edge cannot be distinguished from a seek unless Rekordbox briefly exposes an unloaded state or another identity field changes. Controller LOAD remains authoritative for that case.

## Hot Cues and loops

Every cue contains a letter index and timestamp. `kind` is `cue`, `loop`, or `unknown`. Loop bounds are included only when the Accessibility label exposes an end time or beat length.

Crossing a cue timestamp selects its visual route at the interpolated crossing time. When an active loop has observed bounds, a backwards playhead jump from its end to its start re-anchors the visual loop at the interpolated wrap time. Unknown bounds fall back to the authored scene cue contract.

## Phase

The player prefers an observed beat position. When none is exposed, coherent visible Hot Cue timestamps estimate a fractional beat-grid offset. With insufficient evidence, phase is derived from `positionSeconds × BPM / 60` and explicitly marked low confidence.

The compact **Tap downbeat** control snaps the visual clock to a four-beat boundary while shifting each active loop anchor by the same amount, preserving the loop's internal playback position.

## Debug discovery

Set `VIDEO_SYNC_REKORDBOX_DUMP_ELEMENTS=1` only for a one-shot development run. The macOS adapter emits `rekordbox.adapter-debug` once and exits. That payload may contain visible track titles or other Rekordbox UI text and must not be enabled during a recorded performance.
