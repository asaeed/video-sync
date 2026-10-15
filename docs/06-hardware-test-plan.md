# DDJ-GRV6 and projector test plan

## Why these tests are required

The current macOS path combines visible Rekordbox deck state through Accessibility with passive DDJ-GRV6 MIDI; read-only Ableton Link is optional. A 2026-09-04 macOS capture proved concurrent controller access while Rekordbox played and matched published Play/Pause, Beat Sync, and 14-bit tempo messages. The Rekordbox-to-virtual-input experiment received no data.

AlphaTheta publishes the remaining GRV6 assignments. We still need complete labeled deck 1/2 captures, disconnect recovery, Windows coexistence, and a performance soak before treating the profile as production-qualified.

## Setup

- DDJ-GRV6 connected directly to the computer where possible.
- Rekordbox 7.2.2 in the normal performance configuration.
- Two local analyzed tracks with clear beat grids and several hot cues.
- Ableton Link disabled for the primary baseline; repeat a separate optional-Link pass afterward.
- Video Sync bridge opened against the `DDJ-GRV6` input with `bridge/config/ddj-grv6.csv`.
- Extended-desktop projector at 1920x1080/60 Hz.
- No additional DJ/VJ applications running during the baseline.

## Bridge probe matrix

For each action, record the direct GRV6 bytes, timestamp, deck identity, repetitions, and on/off or 14-bit values while Rekordbox remains in normal use. Treat Rekordbox MIDI OUT only as an optional secondary state source.

| Action | Decks | Required for v1 | Fallback if unavailable |
| --- | --- | --- | --- |
| Play/pause | 1, 2 | Yes | dominance crossing |
| Hot cues A–H | 1, 2 | Yes; verify each mapping | Studio scene default or built-in deck-local random fallback, as configured |
| Audio-loop wrap/reset | 1, 2 | Preferred for exact visual re-anchor | authored cue length when Accessibility exposes no loop bounds |
| Load track | 1, 2 | Yes | controller LOAD when visible track identity is unavailable |
| Beat Sync | 1, 2 | Diagnostic | Link health only |
| Set master | 1, 2 | Diagnostic | do not infer; show unknown |
| Channel faders | all used | Preferred | crossfader only |
| Crossfader | global | Preferred | play/hot cue only |
| Beat FX on/off/parameters | used controls | Verify existing visual analogs | manual Live control if MIDI is unavailable |

Run each mapped action at least 30 times, then restart the bridge and Rekordbox once and repeat. A message is accepted into the software profile only if it is stable, unambiguous, and passive. Repeat the same evidence standard after unplug/replug.

For each load, capture `trackTitle`, `trackFingerprint`, `trackIdentityBasis`, and `loadGeneration`. Test controller LOAD, mouse drag, keyboard load, loading the same track again, and switching between two tracks with the same BPM. Confirm that every real load consumes exactly one scene and that UI-only changes consume none.

For transport, start the bridge once while each deck is already playing and once while each deck is paused. Confirm `playhead-motion` and `playhead-stable` independently of controller parity, then press Stop during a moving sample and confirm the controller hint is not immediately reversed.

For every visible Hot Cue A-H, record `kind`, `endTimeSeconds`, `lengthBeats`, and `metadataBasis`. Treat `unknown` as a valid conservative result. For every cue classified as `loop`, observe at least ten wraps and compare the interpolated visual re-anchor against the Rekordbox playhead.

For channel and crossfader controls, verify position messages rather than assuming audio metering. The published GRV6 `CH LEVEL METER` entries are computer-to-controller MIDI output and do not provide Video Sync with measured channel loudness.

## Link checks

1. Start Rekordbox alone and enable Link.
2. Join from the read-only bridge; confirm peer count changes without tempo movement.
3. Enable Link on deck 1, then deck 2.
4. Change tempo gradually and abruptly from Rekordbox.
5. Switch the Rekordbox sync master explicitly.
6. Unload the current master and observe documented/actual handoff.
7. Stop one deck while the other continues.
8. Disable Link for 10 seconds, re-enable it, and verify a phase-safe recovery.

Record phase error at 4-, 8-, and 16-beat quanta. The bridge must timestamp against monotonic host time rather than UI receipt time.

## Projector timing

Run three layers of evidence:

1. **Internal:** scheduled boundary to submitted frame.
2. **Display:** submitted frame to presentation callback/fence where available.
3. **Physical:** high-frame-rate video showing a GRV6 button/LED and projector image together.

Test 100 consecutive quantized changes and a 30-minute soak while mixing normally in Rekordbox. Record CPU, GPU, memory, disk throughput, dropped frames, audio glitches, and thermal behavior.

## Go/no-go rules

- If controller MIDI sharing is incomplete, use only observed deck state and explicit manual controls; do not claim cue or fader input that the bridge cannot see.
- If the browser viewer misses projector timing, profile decode, seek, preload, and compositor behavior before considering a native renderer.
- If the viewer disturbs Rekordbox audio, reduce decoder concurrency and GPU load before considering 4K or effects.
- Use only visible, permissioned Accessibility state for the macOS deck adapter; do not read Rekordbox process memory or treat hidden/private app state as a supported event stream.
