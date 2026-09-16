# Video Sync

Working project for a lean, cross-platform visual-performance app that follows a Rekordbox DJ set and drives a separate projector display.

**Video Sync** is the current working name and `video-sync` is the project folder.

## Vocabulary

- **Scene:** one reusable visual composition (the former “patch”).
- **Clip:** a source video file.
- **Visual loop:** one or more clip appearances arranged on a repeating musical timeline.
- **Timeline event:** one use of a clip, with source time, musical placement, duration, and optional filters.
- **Render appearance:** the layer, opacity, blend, fit, and optional filters used for one occurrence of a clip.
- **Cue binding:** a Rekordbox hot cue mapped to a persistent visual loop.
- **Set:** an ordered queue of scenes for a performance.

## Run the proof of concept

Requirements: Node.js 20+ and a current Chromium, Safari, or Firefox browser.

```sh
cd video-sync
npm test
npm run bridge:build
npm run dev
```

Then open:

- Timing/player POC: <http://127.0.0.1:4316/>
- Scene schema, input map, and mix lab: <http://127.0.0.1:4316/studio/schema/>
- Ten interface directions: <http://127.0.0.1:4316/studio/visual-directions/>

Each deck owns an independent scene and visual-loop instance. Loading shows the first frame of the default loop, play starts that deck's timeline and platter, and pause freezes both. Normal playback holds the default clip rather than cycling through a scene's media; each configured Hot Cue selects its own persistent visual loop. A deck load also generates one stable random two-clip loop for any unassigned Hot Cue. Channel levels and the crossfader produce normalized deck opacities that total 100% whenever either deck has nonzero weight. State is mirrored to a separate projector window.

The browser renderer implements the v4 scene contract with visual loops, timeline events, and explicit audio-cue/visual-loop bindings. It also includes a continuously repeating 16-bar display, selected-cue lanes, an optional audible metronome, live bridge evidence, and a persistent draggable divider between the preview and live controls on desktop widths. See [the scene schema](docs/07-scene-schema.md) and [direction validation](docs/08-direction-validation.md) before extending the POC.

This browser build proves the interaction model and deterministic beat math. It does **not** yet prove native decoding, projector latency, or Rekordbox coexistence under load.

## Media setup

The public repository intentionally excludes all video files, source-film downloads, live bridge captures, and build output. This keeps the Git history small and avoids redistributing a scan or restoration whose rights may differ from the underlying film. Scene contracts, source URLs, timestamps, and provenance notes remain tracked.

To generate local eight-second performance excerpts, install `ffmpeg` and `curl`, review [the asset provenance](assets/README.md), then run:

```sh
npm run media:archive -- --list
npm run media:archive -- metropolis-machine trip-to-the-moon
```

Only generate material you are entitled to use in your territory. The resulting files are written beneath `assets/scenes/` and ignored by Git.

## Run the bridge spike

The native bridge is a read-only Ableton Link observer plus a passive, timestamped DDJ-GRV6 MIDI receiver that can run alongside Rekordbox. Build and setup instructions are in [bridge/README.md](bridge/README.md).

`npm run dev` supervises the headless bridge, opens the GRV6 by name, applies the checked-in device profile, and exposes Link plus raw/normalized controller events in the scrollable **Live bridge** feed. The same stream is recorded to `.build/bridge-live.jsonl`. The browser consumes Link tempo/beat, Play presses, Hot Cues A-H, channel faders, the crossfader, and mapped Beat FX. Continuous controller values are consumed losslessly but UI work is coalesced to one update per display frame. Set `VIDEO_SYNC_MIDI_MODE=virtual` only for the CoreMIDI self-test path.

## Clip files

The current POC models every numbered clip as a separate optimized MP4 file. A timeline event can start at `source.startSeconds`, but v4 does not yet define an out-point. The planned authoring extension separates immutable media from reusable source ranges (`mediaId`, `inSeconds`, `outSeconds`) and can render those ranges into standalone performance files during packaging.

## Scene library and set sequencer

The runtime catalog now contains 36 film-footage scene contracts. All 28 locally playable scenes have 12 numbered clips, a predictable Clip 1 default, and varied two-clip Cue A–G mappings. Hot Cue H remains visible as an eighth performance control and selects the deck's load-time random loop. The playable set is the original 16 plus *The Cameraman's Revenge*, *The Lodger*, *Underworld*, *The Docks of New York*, *Häxan*, *The Cat and the Canary*, *The Fall of the House of Usher*, *Woman in the Moon*, *The Mechanical Man*, *The Iron Horse*, *3 Bad Men*, and *Ballet mécanique*. The remaining 8 are seven copyrighted wishlist titles plus the mixed-rights Popeye collection; they stay visible as eight-clip source-needed entries rather than silently referencing pirated or missing media.

The emulator includes a persistent ordered scene sequencer. Click a row to continue from that point, drag rows or use the left-side arrow controls to reorder them, adjust ×1–×8 songs with minus/plus, and press Load on either deck to claim the next assignment. “+ Add item” appends a row, whose scene is chosen with the row's own selector. Counts are global across decks: if an item is ×3, the next three song loads receive that scene, then the following load advances.

Every playable scene now follows the twelve-clip, lower-reuse authored-loop model first proven in Metropolis. Clip 1 remains the stable default; each A–G loop combines two clips using scene-varied sequence, alternate, flash, call/response, and crossfade structures. All twelve clips appear in the authored set and no clip is assigned to more than two loops. Configurable non-zero in-points and the original 1/2/3/4-bar opening lengths remain intact.

See [asset provenance](assets/README.md).

## Architecture direction

The planned product is modular internally but simple to operate:

1. a small **performance bridge** combines read-only Ableton Link clock with passive DDJ-GRV6 MIDI gestures and fader positions while Rekordbox remains the audio application;
2. a lean browser **viewer engine** uses hardware-accelerated video decoding, deterministic beat scheduling, CSS/WebGL composition, and a separate projector window;
3. a browser **studio/player shell** authors scenes and runs the set queue while sharing exactly the same renderer as the output.

The current direction is hybrid: keep C++ only for the small Link/MIDI bridge and keep the renderer/studio in the browser. This preserves cross-platform reach and rapid authoring while keeping the latency-sensitive controller path headless and narrow. Details are in [the architecture](docs/03-architecture.md).

This is intentionally a monorepo while the bridge protocol, scheduler, renderer, and scene contract are changing together. The bridge should move to its own repository only when its JSON event contract is stable, independently versioned, and useful to consumers other than this player.

## Licensing status

No project-wide license has been selected yet. Public visibility does not grant permission to reuse the original Video Sync code. The bridge fetches and links against [Ableton Link](https://github.com/Ableton/link), whose pinned source is GPL-2.0-or-later; choose a compatible licensing structure before distributing bridge binaries. Film and clip rights are separate from the software and are documented in [asset provenance](assets/README.md).

## Planning documents

- [Product brief](docs/01-product-brief.md)
- [Research and existing tools](docs/02-research.md)
- [Proposed architecture](docs/03-architecture.md)
- [Proof-of-concept plan and status](docs/04-poc-plan.md)
- [Decisions and remaining questions](docs/05-decisions-and-questions.md)
- [DDJ-GRV6 and projector test plan](docs/06-hardware-test-plan.md)
- [Scene schema and live state contract](docs/07-scene-schema.md)
- [Direction validation and visual-loop model](docs/08-direction-validation.md)

## Other name candidates

1. **Beatsplice** — emphasizes edited footage and rhythmic cuts.
2. **Framephase** — emphasizes phase-locked playback.
3. **Aftercue** — connects visual changes to performed cue actions.
4. **LumaSet** — compact and performance-oriented.

These are creative directions, not trademark or domain clearance.
