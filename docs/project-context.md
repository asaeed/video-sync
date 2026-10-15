# Project context

Updated 2026-10-15. This describes the implementation in the local worktree, not a released or performance-qualified build.

## What this is

Video Sync is a browser-based, two-deck visual companion for Rekordbox: it assigns reusable film scenes to loaded songs, runs beat-timed edited-video loops, mixes the decks visually, and sends a separate 16:9 output window to a projector. Scene Studio is the browser authoring surface; a small headless bridge supplies DJ input.

## Current state

- Live Console has an ordered scene queue with per-entry song-load counts, independent deck transport and visual mixing, A–H cue routing, a 16-bar display, Beat FX visual analogs, a Bridge/preflight drawer, and a separate projector window. It can record bridge evidence plus resolved visual state and replay that visual session without the controller or Rekordbox; the media files remain external to the recording.
- On macOS, a permissioned adapter observes visible Rekordbox BPM, playhead, track title when exposed, and Hot Cue metadata. A headless C++ bridge passively reads profile-mapped controller MIDI and optionally Ableton Link. The GRV6 is the checked-in hardware-tested profile, not a product requirement. Windows Rekordbox deck-state integration is not implemented.
- The built-in catalog has 36 scene entries: 28 playable definitions with 12 clip contracts and eight visual loops each, plus eight source-needed concepts. Video assets are generated/stored locally and excluded from Git; catalog availability does not prove that a particular machine has all media installed.
- Scene Studio has two workspaces: Sources & Clips, with a full-film overview and moving ten-second detail timeline, and Loop Builder, with ordered A–H loops and a shared-engine preview. It supports local project save, selective FFmpeg clip preparation, publication to the local scene registry, and single-scene `.vscene` import/export.
- Browser-local drafts and Live Console state survive refresh. Saving an editable project is separate from publishing it. The player loads all server-published scenes on refresh; an already-running deck is not swapped mid-set.

## How things work

- A new song load, observed through controller LOAD or a changed visible Rekordbox title, claims the next queue assignment. Play, cue, and deck dominance may qualify a diagnostic song count but do not advance the scene queue. The two load paths are deduplicated; layouts that hide title identity rely on controller LOAD or manual control.
- Every deck owns its own scene, loop clock, and transport. Pause freezes that deck's video without stopping the other deck. Channel faders and crossfader supply visual weights, not measured audio loudness; nonzero weights normalize to 100%.
- In built-in film scenes, normal playback stays on the Clip 1 default, A–G select authored loops, and H uses a stable load-time random loop. Studio publications map their first eight ordered loops to A–H and use the starred default for missing slots. All authored visual loops repeat; audio jump versus audio loop is inferred from Rekordbox evidence when available, not an authoring toggle.
- Visible deck playhead/BPM is the primary macOS timing path. Link is optional because enabling it disrupted the user's Beat Sync workflow. Missing or low-confidence input should be identified, not silently presented as confirmed DJ state.
- Studio clip definitions reference source ranges. Entering Loop Builder prepares only new/changed trimmed cuts where possible; untouched prepared cuts are reused. A changed range used in a loop requires confirmation, while a rename does not. Save and Publish are deliberate boundaries so an agent or editor cannot silently alter the active performance scene.
- Source rights are separate from software rights. The repository omits film files, and the source-needed catalog does not grant permission to download or perform a copyrighted title.

## Active work / next steps

- Complete labeled deck-1/deck-2 captures across Rekordbox layouts: title-based loads, cue-loop bounds and wraps, start-mid-track transport, bridge reconnects, and optional-Link recovery.
- Measure a real dual-deck 1080p projector session: physical controller-to-photon latency, frame pacing, media readiness, Rekordbox audio stability, and a 30-minute soak. Promote a native renderer only if measured browser failures justify it.
- Review and recut near-static catalog excerpts; avoid replacing genuinely moving film footage with synthetic motion just to inflate activity.
- Improve agent-assisted source selection and loop editing outside the live path; make single-scene packages efficient for long source films before designing portable multi-scene sets.
- Resolve a compatible software license and scene-by-scene media rights before distributing binaries or bundled footage.

## Pointers

- [README](../README.md): setup, platform status, and product overview.
- [Architecture](03-architecture.md), [runtime scene schema](07-scene-schema.md), [Scene Studio](12-scene-studio.md), and [scene queue](10-scene-catalog-and-sequencer.md): current contracts and workflows.
- [Hardware test plan](06-hardware-test-plan.md), [deck-state v2](11-deck-state-v2.md), and [bridge guide](../bridge/README.md): unqualified hardware behavior and diagnostic procedure.
- [Asset provenance](../assets/README.md): media sourcing and motion-audit caveats. [Product brief](01-product-brief.md) is a target; [POC plan](04-poc-plan.md) and [direction validation](08-direction-validation.md) preserve historical experiments.

## Suggested tooling

- `npm test` for the browser engine, `npm run studio:test` for Playwright UI behavior, and `npm run studio:build` for the served authoring bundle.
- `npm run media:validate` for local clip/catalog checks; `node scripts/publish-all-scenes.mjs` previews batch publication without publishing.
