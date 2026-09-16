# Link and controller MIDI bridge

This spike joins an Ableton Link session as a read-only observer and passively opens the DDJ-GRV6 MIDI input alongside Rekordbox. It emits timestamped JSON Lines to stdout and can append the identical stream to a recording.

It deliberately never sends controller MIDI, writes Link tempo/transport state, or treats a gesture as software-confirmed state. The checked-in GRV6 profile is based on AlphaTheta's published message list and verified against raw bytes from the performance computer.

## Build

Requirements: CMake 3.24+, a C++20 compiler, Git, and the platform MIDI SDK. CMake fetches pinned [Ableton Link 4.0](https://github.com/Ableton/link/releases) and [RtMidi 6.0.0](https://github.com/thestk/rtmidi/releases).

```sh
cd video-sync
cmake -S bridge -B .build/bridge -DCMAKE_BUILD_TYPE=Release
cmake --build .build/bridge --parallel
```

The executable is `.build/bridge/video-sync-bridge`.

For the integrated development path, build once with `npm run bridge:build`, then use `npm run dev`. The Node development server launches this headless executable, records `.build/bridge-live.jsonl`, and relays recent Link/MIDI evidence to the browser over `/api/bridge/events`. `/api/bridge/status` exposes the same status as JSON.

## Prove the local transports first

```sh
.build/bridge/video-sync-bridge --list-midi
.build/bridge/video-sync-bridge --self-test-midi --run-for-ms 900 --clock-hz 10
```

On macOS, the second command creates `Video Sync Rekordbox MIDI`, sends six representative GRV6-shaped messages through it, and records them as `midi.raw`. When run with the GRV6 map, it also exercises button and 14-bit control normalization. This is a local CoreMIDI test, not live controller evidence.

RtMidi can create virtual ports with CoreMIDI on macOS and ALSA/JACK on Linux. Its WinMM backend cannot create one. On Windows, install or choose an existing loopback MIDI input and pass its index with `--midi-port N`.

## Capture live GRV6 evidence alongside Rekordbox

1. Enable Ableton Link in Rekordbox and enable Link on a participating deck.
2. List the MIDI ports and start the bridge against the GRV6 by name:

   ```sh
   .build/bridge/video-sync-bridge --list-midi
   .build/bridge/video-sync-bridge \
     --midi-port-name DDJ-GRV6 \
     --map bridge/config/ddj-grv6.csv \
     --record rekordbox-session.jsonl
   ```

3. Perform one labeled action at a time: play/pause, Hot Cues A-C, channel faders, crossfader, then loop state/reset controls.
4. Keep the raw capture and compare it to AlphaTheta's published table before expanding the checked-in profile.

The browser's **Live bridge** panel makes this capture visible while the emulator is open. `npm run dev` defaults to `DDJ-GRV6` and `bridge/config/ddj-grv6.csv`; use `VIDEO_SYNC_MIDI_MODE=virtual npm run dev` for the virtual self-test path. A Link reading of `0 peers` means the bridge is healthy but Rekordbox has not joined the same Link session.

The browser receives replaceable Link clock snapshots at 10 Hz. To avoid an unbounded high-rate disk log, JSONL persistence keeps every controller event but samples a stable Link clock every five seconds, with immediate records when tempo, peer count, or shared start/stop intent changes.

The GRV6 Play/Pause control is a momentary press edge, not an absolute transport value. The development relay therefore tracks the press parity for each deck, treats a normal LOAD edge as a known stopped state, treats a Hot Cue edge as a known playing state, and stores that state in `.build/bridge-transport-state.json`. A browser receives a full absolute `controller-transport` snapshot when it connects, then live events identify and update only the deck that changed so one deck's transport cannot overwrite the other deck. The browser also retains its current deck runtime in session storage. Reloading the page while a deck is playing now restores that playing state, so the next controller press pauses the visual instead of starting it. A first-ever bridge launch while Rekordbox is already mid-song and no LOAD, Play, or Hot Cue edge has been observed remains unknowable from controller MIDI alone; an absolute Rekordbox MIDI-output mapping is the future authoritative solution.

Direct GRV6 input gives us the physical Hot Cue press edge, which is sufficient to start or re-anchor its mapped visual loop. It does not report a later automatic audio-loop wrap; the visual engine predicts that boundary from Link plus the configured cue length unless a stable reset event is discovered.

Example mapping file format:

```csv
# event,status,data1,deck,value_mode
deck.play,0x90,0x0B,1,button
hotcue.a,0x97,0x00,1,button
mixer.crossfader,0xB6,0x1F,0,cc14
```

The numbers above illustrate syntax only. They are not DDJ-GRV6 or Rekordbox assignments.

`button` and `cc7` normalize one data byte. `cc14` treats `data1` as the MSB controller and `data1 + 32` as its LSB, then emits one `0..1` value when the pair completes.

Run with a different learned map:

```sh
.build/bridge/video-sync-bridge \
  --map bridge/config/custom-controller.csv \
  --record rekordbox-mapped.jsonl
```

Every matching message produces both `midi.raw` evidence and a `controller.control` event. Normalized messages retain `rawValue`, `resolutionBits`, and `active` alongside the `0..1` value.

## Read-only Link guarantee

The bridge enables Link and captures app-session state for `tempo`, `beat`, `phase`, shared `playing` intent, and peer count. It never commits session state and never calls Link tempo, beat, or start/stop mutation APIs. Link supplies no deck number, track, hot cue, fader, Rekordbox sync-master identity, or deck playhead.

Because Link has no per-deck playhead, a configured A/B visual loop repeats from the physical Hot Cue press anchor and modeled audio-loop length. Exact correction at a later Rekordbox audio-loop wrap remains possible only if the live capture reveals a usable reset/state message.

## Output contract

Each line validates against [`schema/bridge-message.schema.json`](../schema/bridge-message.schema.json). Current event types are:

- `bridge.ready`, `bridge.self-test`, `bridge.stopped`;
- `link.clock`;
- `midi.ports`, `midi.raw`;
- `controller.control` (`rekordbox.control` remains schema-compatible for older recordings).

The browser POC consumes GRV6 controls for deck transport, LOAD 1/2, Hot Cues A-H, channel levels, crossfader position, and Beat FX. The LOAD mappings follow AlphaTheta's published message list: channel 7 notes 70 and 71. Each active LOAD edge claims the next scene-queue song assignment globally across the two decks. A track loaded by mouse or keyboard entirely inside Rekordbox emits no controller edge and is not inferred. JSON Lines remain the evidence and replay format; unsupported software state is never synthesized as controller truth.
