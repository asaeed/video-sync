# Scene Studio

Scene Studio is the editable, computer-first authoring surface for Video Sync. It runs in the browser and keeps heavyweight media organization out of the latency-sensitive Live Console.

Open `http://127.0.0.1:4316/studio/` after building with `npm run studio:build`.

## Why sources and clips are separate

A **source** is a video file that may be a full film, a longer excerpt, or a short edited extract. A **clip** is a named, colored in/out range inside a source; its editable definition does not duplicate the source. On entering Loop Builder, Studio prepares a short local video for each trimmed clip that needs one. A **clip instance** places that reusable range onto a musical loop and can add a source offset, duration, playback rate, end behavior, opacity, blend, filters, or pan/zoom without changing the clip itself.

This is one useful abstraction, not two competing editors:

```text
source video
  -> reusable clip ranges measured in seconds
    -> clip instances measured in bars and beats
      -> ordered loops: Hot Cue A-H plus one scene default
        -> compiled schema v4 performance scene
```

## Workspaces

The scene picker opens all 36 built-in scene entries. The 28 playable scenes each start with the twelve edited local video files already used by Live Console and eight visual loops. The eight source-needed concepts open as empty, editable starter projects with a default loop; import footage and place clips on that loop before publishing. Saved projects, including scenes outside the built-in catalog, also appear in the picker. Switching scenes and refreshing preserve unsaved drafts in this browser's local storage.

The playable palettes reuse the existing media; they do not copy or download a full film. Sources & Clips links to the original film's source page for provenance. A full-length file can be imported later and used for new clip ranges, but its exact in/out points cannot be inferred reliably from the already edited extracts. Source-needed concepts do not fabricate media or imply that a copyrighted film is licensed.

### Sources & Clips

- Import a long local video; it starts with one clip spanning the entire source.
- Click the video or use Play/Pause; Space also toggles playback when focus is outside an input. The native video seek bar is hidden in favor of Studio's timelines.
- Use the **Full source** overview to jump or drag to a part of a long film. The detail timeline shows a moving ten-second window: click to seek, drag its background to pan, or use ±10 seconds / Left and Right arrows. Dragging pauses playback until release.
- Click **+** once to mark a clip edge and again at another position to finish the range, in either time direction. Clicking again without moving cancels. The **Set** buttons beside In and Out use the current playhead.
- Click a clip in the detail timeline or Clip bin to play it from its beginning on repeat. Click empty timeline space to deselect it and return to unrestricted source playback; this does not force a paused video to start. Drag a range or either edge to move and trim it.
- Name and color clips. Trimming a clip used in a visual loop asks for confirmation; renaming does not. Deleting a used clip warns that its timeline instances will also be removed.

### Loop Builder

- Create any number of named visual loops.
- Drag loop cards by their six-dot handles to set Hot Cues A–H in list order. Loops after the eighth are not cue-mapped; if there are fewer than eight, remaining cues use the scene default. Click a card's star to make it the default independently of cue order.
- Drag reusable clips from the clip strip to a bars/beats timeline.
- Drag or resize each clip instance with quarter-beat snapping; move it vertically to another lane. Adjacent instances may share a lane, while overlapping instances must use different lanes.
- Drag a lane's six-dot handle at the left edge of the timeline onto another lane to reorder their priority. Lanes stack from top to bottom: an opaque clip covers lower clips, while lowering its opacity (or using a blend mode) reveals the clips beneath it. Fully covered clips are skipped until needed, then resume at their rhythm-correct source time.
- Select or use the labeled Duplicate button on any instance row in the right sidebar. A duplicate is inserted immediately after its original on the same lane; later instances on that lane move only as far as needed, and the loop extends by full bars if necessary.
- Press Delete or Backspace to remove the selected instance when a text field is not focused.
- Scrub the video timeline above the sequence grid; both tracks use the same horizontal beat scale.
- Set source offset, playback speed, source-range looping/hold, opacity, blend, and slow pan/zoom.
- Choose **Full frame** or **Fill screen (crop)** for each clip instance. New instances and random loops default to full-frame `contain`; Loop Builder's 16:9 preview uses the same framing as the projector popup, which stays 16:9 and letterboxes on a differently shaped display.
- When pan/zoom is enabled, drag its target directly over the Loop Builder preview and choose a separate motion-speed multiplier.
- Preview the edit against an adjustable BPM and loop length. The small arrows inside each number field change its value by one; typing remains available.
- There is no separate visibility mode. Every loop uses the lane stack; opacity defaults to 100%, and the opacity slider creates a blend when desired.
- Entering this tab reconciles prepared media with the current unsaved clip list: new and changed cuts are rendered, obsolete cuts are removed, and unmodified cuts are reused. Short local sources used from start to finish are reused directly without another copy. The original sources and authored visual-loop timelines are not rewritten.
- A preparation dialog displays the actual number of clips checked and a progress bar. It can be dismissed with **Continue in background** while preparation continues; the thin status bar shows an animated loader and a **Show progress** link to reopen it, even if you return to Sources & Clips. The link disappears when preparation finishes. Revising one clip re-renders only that cut; other prepared clips are reused by fingerprint.

Preparation uses FFmpeg on the local computer and produces H.264 MP4s with fast-start metadata under `.build/studio-projects/:id/prepared/`. Cuts longer than 60 seconds are not prepared automatically; trim those first. The preview falls back to the original source if a cut cannot be prepared and reports the warning in the status bar. A prepared file still referenced by the last published scene is retained until that scene is replaced, so unpublished edits do not break Live Console.

## Persistence and publish boundary

Editable projects use [`schema/scene-project.schema.json`](../schema/scene-project.schema.json), schema version 5. The local API saves projects and imported source media beneath `.build/studio-projects/`, which is intentionally ignored by Git.

Studio autosaves the current working draft, other open scene drafts, selected workspace, and selected items to browser local storage. A refresh restores them with the dirty indicator intact; this does not commit a project. `Save` writes the current editable project and clears its dirty state, while `Reload saved` discards its working draft and restores the last saved version. The scene picker opens saved versions when they exist and otherwise starts from the current catalog scene. Save is separate from Publish: editing or saving does not change Live Console until the scene is published. Imported source media is stored once; the built-in edited extracts are referenced in place.

For a local batch refresh, `node scripts/publish-all-scenes.mjs` previews the targets and `node scripts/publish-all-scenes.mjs --publish` saves and publishes all playable catalog scenes plus saved custom projects. It uses server-saved versions where present, excludes the eight source-needed concepts, and cannot include unsaved drafts held only in another browser session.

Live Console independently keeps its scene queue, pane width, decks, current cues, BPM, crossfader, channel levels, and Beat FX in browser local storage. On load, it reads **all** locally published scene versions from the server and overlays them by ID on the built-in catalog, so publishing one scene no longer hides earlier publications. A browser-only published scene remains a fallback when it is not on the server. Refresh Live Console (and its separate projector window) after publishing to load the newest versions; an already-playing deck is not swapped underneath a set. A live Rekordbox/Link signal can supersede a restored state when it reconnects. Browsers may block automatic audio on refresh, so an enabled metronome appears as **Resume metronome** until clicked.

Loop Builder preview uses the same `VisualEngine` and sequence resolver as Live Console. Only the selected loop is loaded into the Studio preview, keeping editing responsive while preserving the live layer, filter, motion, and in-point behavior. Every authored visual loop repeats; whether a Rekordbox hot cue is a jump or an audio loop comes from the live bridge when available, not a Studio toggle.

**Files → Export scene** makes a `.vscene` package from the current working project (including unsaved edits), compiled runtime scene, and all local source videos without transcoding them. It does not yet package prepared cuts in place of long sources, so packages can still be large. **Files → Import scene** restores the project and media under `.build/studio-projects/`; if the scene ID already exists, a `-copy-N` ID is assigned so the existing scene is not overwritten. Remote video URLs must be imported as local sources before export. After import, use Publish to make that scene the current Live Console scene. A package is one scene, not yet the entire performance queue.

`Publish` compiles a project into the lean schema v4 runtime scene:

- source + clip range becomes a runtime clip with an in-point, or a zero-based prepared clip when available;
- each clip instance becomes a runtime timeline event with an explicit out-point;
- Studio scenes set `lanePriority: "top"` and compile each instance's lane, so Live Console uses the same lane stack and opacity blending as the preview; older catalog scenes keep their existing `z`-based behavior;
- source media remains local and is streamed with HTTP byte-range support;
- the local server stores the published scene; browser storage is a fallback for the most recent publication.

The authoring document remains the source of truth. The compiled runtime scene is disposable output.

## Local API for agents

The same loopback-only API can be used by an agent or future CLI:

| Method | Route | Purpose |
| --- | --- | --- |
| `GET` | `/api/studio/projects` | List projects |
| `GET` | `/api/studio/published` | List all locally published runtime scenes for Live Console and projector output |
| `GET`, `PUT` | `/api/studio/projects/:id` | Open or save an editable project |
| `PUT` | `/api/studio/projects/:id/sources/:sourceId` | Upload raw video; send the filename in `x-file-name` |
| `GET` | `/api/studio/projects/:id/media/:file` | Stream imported media with Range support |
| `POST` | `/api/studio/projects/:id/prepare` | Reconcile prepared clip media from the current project JSON, including unsaved edits. Send `Accept: application/x-ndjson` for per-clip progress and a final result; otherwise returns JSON. |
| `GET` | `/api/studio/projects/:id/prepared/:file` | Stream a prepared clip with Range support |
| `POST` | `/api/studio/projects/:id/publish` | Store a compiled schema v4 scene |
| `GET` | `/api/studio/projects/:id/published` | Read the last compiled scene |
| `POST` | `/api/studio/projects/:id/export` | Send `{project, scene}` and download the media-inclusive `.vscene` package |
| `POST` | `/api/studio/packages` | Upload a `.vscene` package; returns its restored scene ID |

Internet discovery and downloading are deliberately not part of the live server. An agent should record the source URL/provenance, download only material the user may use, then call the local project API. Media analysis, subject detection, and proxy/transcode generation belong in an offline import worker rather than the performance renderer.
