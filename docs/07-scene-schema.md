# Scene schema and live state contract

> Status: version 4 is implemented by the browser POC. The normative JSON Schema is [`schema/scene.schema.json`](../schema/scene.schema.json).

## Model

The format separates reusable media from its musical use:

1. **clips** identify source video files;
2. **visual loops** define repeating musical timelines;
3. **timeline events** place a clip on a loop and own source time, duration, layer, opacity, fit, blend, filters, and optional motion;
4. **cue bindings** describe the Rekordbox audio-cue behavior and select a persistent visual loop;
5. **deck runtime state** selects a scene and loop, controls transport, and supplies visual mix weight.

Clips have no permanent base, accent, or flash role. The same clip can be full-frame for four bars in one loop and a filtered 1/16-note overlay in another.

## Scene shape

```json
{
  "$schema": "../schema/scene.schema.json",
  "schemaVersion": 4,
  "id": "metropolis-machine",
  "name": "Metropolis Machine",
  "clips": [],
  "visualLoops": [],
  "defaultLoopId": "song-default",
  "cueBindings": [],
  "advance": { "afterSongs": 2 }
}
```

### Clip

```json
{
  "id": "clip-2",
  "label": "Transformation rings",
  "file": "../assets/scenes/metropolis/transformation-rings.mp4",
  "durationSeconds": 8,
  "startSeconds": 1,
  "subjectFocus": { "x": 0.458, "y": 0.482 }
}
```

The POC uses one optimized MP4 per numbered clip. `clip.startSeconds` is its default in-point and is copied into generated timeline events; an event can override it with `source.startSeconds`. `subjectFocus` is an authoring-time suggestion in normalized frame coordinates. V4 does not yet model an out-point. The authoring roadmap adds reusable media ranges (`mediaId`, `inSeconds`, `outSeconds`) while retaining the option to prerender each range as a standalone performance file.

### Visual loop and timeline events

```json
{
  "id": "song-default",
  "name": "Song default",
  "length": { "bars": 16 },
  "repeat": true,
  "events": [
    {
      "id": "default-clip-1",
      "at": { "bars": 0 },
      "duration": { "bars": 4 },
      "clipId": "clip-1",
      "source": { "startSeconds": 0, "loop": true, "rate": 1 },
      "appearance": {
        "z": 0,
        "opacity": 1,
        "blendMode": "normal",
        "fit": "cover",
        "filters": [],
        "motion": {
          "type": "ken-burns",
          "focusSource": "clip-subject",
          "progress": "loop",
          "easing": "ease-in-out",
          "start": { "scale": 1, "focus": { "x": 0.5, "y": 0.5 } },
          "end": { "scale": 1.14, "focus": { "x": 0.38, "y": 0.42 } }
        }
      }
    }
  ]
}
```

`at` and `duration` are musical positions. In 4/4, one bar is four beats and a 1/16 note is `0.25` beats. Events may overlap; `z` controls their order. An empty filter array means raw video.

`appearance.motion` is optional and belongs to this occurrence of the clip, not the clip file. A Ken Burns motion interpolates between two scale/focus keyframes. Focus coordinates are normalized across the frame: `{ "x": 0, "y": 0 }` is top-left and `{ "x": 1, "y": 1 }` is bottom-right. `focusSource: "clip-subject"` lets a repeated scene use the focus point belonging to the actual shuffled clip; omit it to keep the keyframes' explicit coordinates. `progress: "loop"` makes the move span the whole musical loop even if that clip appears in several alternating events; `"event"` restarts it for each event. The renderer clamps pan to the zoom overscan so no empty edge is exposed.

For the current playable catalog, subject points were suggested offline from representative frames using face detection followed by attention saliency. This analysis never runs in the player. An authoring UI should show the suggested point over the frame, allow drag-to-correct, and fall back to a restrained centered zoom when confidence is weak or the subject moves significantly.

`source.startSeconds` is a timestamp inside the media file. With `source.loop: true`, the video repeats from that in-point if the event lasts longer than the remaining media. Each time the timeline event re-enters the visual loop, the renderer also seeks back to `startSeconds` before continuing.

### Two-clip authoring recipes

The authoring layer can compile a concise two-clip recipe into ordinary timeline events. The player only consumes those events, which keeps the performance path simple and lets a future agent or editor generate the same contract without adding runtime modes.

| Recipe | Timeline result |
| --- | --- |
| `sequence` | Clip A, then Clip B at a configured musical position |
| `alternate` | A and B alternate at a configured beat interval |
| `flash-overlay` | A plays continuously while short B events appear over it on an interval |
| `call-response` | A holds the main phrase and B answers for its ending beats |
| `crossfade` | A and B overlap for the full loop while their opacities move in opposite directions |

Crossfades use a beat-synchronous linear opacity envelope on each event:

```json
"opacityEnvelope": { "from": 1, "to": 0, "curve": "linear" }
```

Their two layers use `plus-lighter` composition so opposing opacity envelopes produce a true dissolve without the dark midpoint caused by normal source-over alpha stacking.

The schema stores the compiled event timeline, not the recipe name. This keeps scene files explicit and portable. Split-screen composition is intentionally deferred.

### Load-time random loop

Each scene also declares the clips, lengths, and two-clip recipes its random loop may use:

```json
"randomLoop": {
  "id": "random-loop",
  "recipes": ["sequence", "alternate", "flash-overlay", "call-response", "crossfade"],
  "lengths": [{ "bars": 1 }, { "bars": 2 }, { "bars": 4 }],
  "candidateClipIds": ["clip-1", "clip-2", "clip-3"],
  "fit": "contain"
}
```

The browser materializes this configuration into a normal event timeline once when a deck is loaded. It randomly chooses two different clips, one recipe, one loop length, recipe timing, and a half-second-quantized source in-point. That generated loop stays stable for the life of the deck load and is serialized across a page reload. Loading the deck again generates a new one. Any unassigned Hot Cue selects this deck-local random loop; with the current A–G authored mappings, Hot Cue H is random.

## Cue bindings

Every configured cue selects a visual loop. A scene does not need to bind every available Hot Cue button. “Loop” versus “jump” describes the corresponding audio hot cue, not whether the visual disappears.

### Audio loop cue

```json
{
  "input": "hotCueA",
  "cue": { "type": "loop", "length": { "bars": 4 } },
  "visual": {
    "loopId": "cue-a-loop",
    "retrigger": "audio-loop-cycle"
  }
}
```

The selected visual loop remains active. In the POC, its length matches the modeled audio-loop length, so its normal repeat boundary restarts its first event. A production bridge should re-anchor at a real audio-loop reset only if Rekordbox MIDI exposes a stable reset/state message.

### Audio jump cue

```json
{
  "input": "hotCueC",
  "cue": { "type": "jump" },
  "visual": {
    "loopId": "cue-c-loop",
    "retrigger": "cue-trigger"
  }
}
```

When configured, Hot Cue C immediately selects and restarts its mapped loop. In Metropolis Machine, Clip 6 plays for four bars while Clip 7 flashes over it every two beats for one 1/16 note. Media repeats as needed inside a longer event, the visual loop restarts at its configured boundary, and C stays active until another cue or scene replaces it.

Metropolis Machine is also the compact two-clip fixture. It now has twelve distinct media files. Its default remains Clip 1 alone; Hot Cues A through G demonstrate sequence, alternate, flash overlay, call-and-response, crossfade, a longer sequence, and bar-end accents while using all twelve clips and repeating only three across authored loops. The established loop lengths remain one, two, three, four, one, two, four, and eight bars for default through G.

Every packaged film scene now applies the same authorship constraints: 12 independent excerpts, Clip 1 as the single-clip default, and seven two-clip cue loops that collectively use the full palette. The recipe order and timing subdivisions are deterministically varied by scene, while each clip appears in at most two authored loops. This provides variation without moving recipe generation or media selection into the frame-rendering path.

## Per-deck runtime state

Runtime state is not stored in the reusable scene file:

```json
{
  "id": 2,
  "loaded": true,
  "playing": false,
  "started": true,
  "generation": 44,
  "sceneId": "metropolis-machine",
  "randomLoop": { "id": "random-loop", "length": { "bars": 2 }, "events": [] },
  "activeLoopId": "cue-c-loop",
  "activeCueInput": "hotCueC",
  "loopAnchorBeat": 31.5,
  "loopGeneration": 8,
  "level": 0.78,
  "clock": {
    "bpm": 124,
    "anchorBeat": 31.5,
    "anchorEpochMs": 1788400000000
  }
}
```

The transitions are explicit:

- **loaded, never started:** show the first frame of the first event in `defaultLoopId`;
- **playing:** advance that deck's beat clock and only the currently visible media instances;
- **paused after starting:** preserve the beat anchor and freeze every visible video;
- **shared phrase display:** run only while at least one deck is playing, continue through overlapping deck handoffs, deactivate when the last deck stops, and restart at bar 1 when playback resumes;
- **cue activation:** replace `activeLoopId`, set a new anchor, increment `loopGeneration`, and leave the cue selected;
- **deck load or scene change:** generate a new deck-local random loop, return to `defaultLoopId`, and clear `activeCueInput`;
- **page reload:** preserve the already generated random loop with the rest of the deck state;
- **unloaded:** remove the deck from the visual mix.

The 16-bar display is a performance timeline, not Rekordbox phrase analysis. Its cue lanes use the same horizontal bar grid and outline each complete visual-loop occurrence. Labels such as `Clip 6` identify the numbered scene clip inside that loop; the outline boundaries show where the loop restarts.

## Visual mix

For a linear crossfader position `x`, each loaded deck's weight is its channel level times its crossfader gain. The two weights are normalized:

```text
raw1 = loaded1 × level1 × (1 - x)
raw2 = loaded2 × level2 × x
opacity1 = raw1 / (raw1 + raw2)
opacity2 = raw2 / (raw1 + raw2)
```

When the denominator is nonzero, opacity sums to 100%. If both weights are zero, output is black. Pause freezes motion but does not force opacity to zero.

## Bridge boundary

The loop engine consumes normalized deck state; it does not care which adapter produced it.

| Source | Credible data | Limitation |
| --- | --- | --- |
| Ableton Link | Tempo, beat/time mapping, phase, optional session start/stop, peers | No decks, tracks, cues, faders, sync-master identity, or playhead |
| Rekordbox MIDI output | Indicator feedback sent to selected equipment | Not a general app event stream; the virtual-input test received nothing |
| DDJ-GRV6 MIDI | Confirmed button and 14-bit fader gestures alongside Rekordbox on macOS | Captures performer intent, not every software-originated state change; Windows and soak tests remain |
| Rekordbox local library | Analyzed metadata, grids, stored cues | Not authoritative live deck/playhead state |

The implemented recorder envelope is [`schema/bridge-message.schema.json`](../schema/bridge-message.schema.json). Raw evidence and normalized mappings remain side by side so an inferred state is never mistaken for Rekordbox truth.
