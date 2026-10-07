# Scene Studio

Scene Studio is the editable, computer-first authoring surface for Video Sync. It runs in the browser and keeps heavyweight media organization out of the latency-sensitive Live Console.

Open `http://127.0.0.1:4316/studio/` after building with `npm run studio:build`.

## Why sources and clips are separate

A **source** is a video file that may be a full film, a longer excerpt, or a short edited extract. A **clip** is a named, colored in/out range inside a source; it does not duplicate or render a new video file. A **clip instance** places that reusable range onto a musical loop and can add a source offset, duration, playback rate, end behavior, opacity, blend, filters, or pan/zoom without changing the clip itself.

This is one useful abstraction, not two competing editors:

```text
source video
  -> reusable clip ranges measured in seconds
    -> clip instances measured in bars and beats
      -> Default / Hot Cue A-H mappings
        -> compiled schema v4 performance scene
```

## Workspaces

The scene picker opens the current Metropolis Machine, A Trip to the Moon, and Nosferatu palettes. Each starts with the twelve edited local video files already used by Live Console, eight current visual loops, and the current Hot Cue A–H map. Switching scenes and refreshing preserve unsaved drafts in this browser's local storage.

The three palettes reuse the existing media; they do not copy or download a full film. Sources & Clips links to the original film's source page for provenance. A full-length file can be imported later and used for new clip ranges, but its exact in/out points cannot be inferred reliably from the already edited extracts.

### Sources & Clips

- Import a long local video; it starts with one clip spanning the entire source.
- Scrub and preview it with normal video controls.
- Click the timeline to cut a two-second range, or use the current playhead as an in/out point.
- Drag a range or either edge to move and trim it.
- Name and color clips and audition the selected range as a loop.

### Loop Builder

- Create any number of named visual loops.
- Drag reusable clips from the clip strip to a bars/beats timeline.
- Drag or resize each clip instance with quarter-beat snapping; move it vertically to another lane. Adjacent instances may share a lane, while overlapping instances must use different lanes.
- Drag a lane's six-dot handle at the left edge of the timeline onto another lane to reorder their priority. At any beat, the highest occupied lane (the topmost one) is the visible video; when it ends, the next occupied lane is revealed at its rhythm-correct source time.
- Select or use the labeled Duplicate button on any instance row in the right sidebar. A duplicate is inserted immediately after its original on the same lane; later instances on that lane move only as far as needed, and the loop extends by full bars if necessary.
- Press Delete or Backspace to remove the selected instance when a text field is not focused.
- Scrub the video timeline above the sequence grid; both tracks use the same horizontal beat scale.
- Set source offset, playback speed, source-range looping/hold, opacity, blend, and slow pan/zoom.
- When pan/zoom is enabled, drag its target directly over the Loop Builder preview and choose a separate motion-speed multiplier.
- Preview the edit against an adjustable BPM.
- The Visibility control defaults to top-lane priority. Existing crossfade loops are explicitly marked Layered blend so their two opacity envelopes still produce the original dissolve; lane order determines which layer is above the other.

### Cue Map

- Choose the scene's default loop.
- Map Hot Cues A-H to authored loops.
- Mark each cue as an audio loop or a one-shot/jump cue.
- Leave a cue unassigned to retain the runtime's generated random fallback.

## Persistence and publish boundary

Editable projects use [`schema/scene-project.schema.json`](../schema/scene-project.schema.json), schema version 5. The local API saves projects and imported source media beneath `.build/studio-projects/`, which is intentionally ignored by Git.

Studio autosaves the current working draft, other open scene drafts, selected workspace, and selected items to browser local storage. A refresh restores them with the dirty indicator intact; this does not commit a project. `Save` writes the current editable project and clears its dirty state, while `Reload saved` discards its working draft and restores the last saved version. The scene picker opens saved versions when they exist and otherwise starts from the current catalog scene. Save is separate from Publish: editing or saving does not change Live Console until the scene is published. Imported source media is stored once; the built-in edited extracts are referenced in place.

Live Console independently keeps its scene queue, pane width, decks, current cues, BPM, crossfader, channel levels, and Beat FX in browser local storage. A live Rekordbox/Link signal can supersede a restored state when it reconnects. Browsers may block automatic audio on refresh, so an enabled metronome appears as **Resume metronome** until clicked.

`Publish` compiles a project into the lean schema v4 runtime scene:

- source + clip range becomes a runtime clip with an in-point;
- each clip instance becomes a runtime timeline event with an explicit out-point;
- Studio scenes set `lanePriority: "top"` and compile each instance's lane, so Live Console uses the same visibility rule as the preview; older catalog scenes keep their existing layer behavior;
- source media remains local and is streamed with HTTP byte-range support;
- the browser stores the last published scene for the Live Console to load on its next refresh.

The authoring document remains the source of truth. The compiled runtime scene is disposable output.

## Local API for agents

The same loopback-only API can be used by an agent or future CLI:

| Method | Route | Purpose |
| --- | --- | --- |
| `GET` | `/api/studio/projects` | List projects |
| `GET`, `PUT` | `/api/studio/projects/:id` | Open or save an editable project |
| `PUT` | `/api/studio/projects/:id/sources/:sourceId` | Upload raw video; send the filename in `x-file-name` |
| `GET` | `/api/studio/projects/:id/media/:file` | Stream imported media with Range support |
| `POST` | `/api/studio/projects/:id/publish` | Store a compiled schema v4 scene |
| `GET` | `/api/studio/projects/:id/published` | Read the last compiled scene |

Internet discovery and downloading are deliberately not part of the live server. An agent should record the source URL/provenance, download only material the user may use, then call the local project API. Media analysis, subject detection, and proxy/transcode generation belong in an offline import worker rather than the performance renderer.
