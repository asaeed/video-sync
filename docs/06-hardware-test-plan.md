# DDJ-GRV6 and projector test plan

## Why these tests are required

The preferred bridge path is Ableton Link plus passive DDJ-GRV6 MIDI. A 2026-09-04 macOS capture proved concurrent controller access while Rekordbox played and matched published Play/Pause, Beat Sync, and 14-bit tempo messages. The Rekordbox-to-virtual-input experiment received no data.

AlphaTheta publishes the remaining GRV6 assignments. We still need complete labeled deck 1/2 captures, disconnect recovery, Windows coexistence, and a performance soak before treating the profile as production-qualified.

## Setup

- DDJ-GRV6 connected directly to the computer where possible.
- Rekordbox 7.2.2 in the normal performance configuration.
- Two local analyzed tracks with clear beat grids and several hot cues.
- Ableton Link enabled globally and on the participating decks.
- Video Sync bridge opened against the `DDJ-GRV6` input with `bridge/config/ddj-grv6.csv`.
- Extended-desktop projector at 1920x1080/60 Hz.
- No additional DJ/VJ applications running during the baseline.

## Bridge probe matrix

For each action, record the direct GRV6 bytes, timestamp, deck identity, repetitions, and on/off or 14-bit values while Rekordbox remains in normal use. Treat Rekordbox MIDI OUT only as an optional secondary state source.

| Action | Decks | Required for v1 | Fallback if unavailable |
| --- | --- | --- | --- |
| Play/pause | 1, 2 | Yes | dominance crossing |
| Hot cues A–H | 1, 2 | A–C initially | manual Live control for any unmapped cue |
| Audio-loop wrap/reset | 1, 2 | Preferred for exact visual re-anchor | configured loop-length prediction |
| Load track | 1, 2 | Preferred | infer new generation from first action plus later metadata path |
| Beat Sync | 1, 2 | Diagnostic | Link health only |
| Set master | 1, 2 | Diagnostic | do not infer; show unknown |
| Channel faders | all used | Preferred | crossfader only |
| Crossfader | global | Preferred | play/hot cue only |
| Beat FX on/off/parameters | used controls | Deferred | no mirrored effect |

Run each mapped action at least 30 times, then restart the bridge and Rekordbox once and repeat. A message is accepted into the software profile only if it is stable, unambiguous, and passive. Repeat the same evidence standard after unplug/replug.

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

- If Link is stable but MIDI sharing is incomplete, ship beat-scheduled automation first with explicit manual cue mappings.
- If the browser POC is smooth but native viewer-core misses projector timing, optimize decode/preload before building more editor features.
- If the viewer disturbs Rekordbox audio, reduce decoder concurrency and GPU load before considering 4K or effects.
- Never scrape the Rekordbox UI or read process memory as the primary live path.
