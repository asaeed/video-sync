# Product brief

## Outcome

Create cohesive, mostly pre-edited video visuals that run beside Rekordbox on the same Mac or Windows computer, stay aligned to musical time, and require very little attention during a DJ set.

The app should feel like preparing a visual set, not operating a full VJ workstation.

## Confirmed setup and preferences

- Rekordbox 7.2.2 in Performance mode, unlocked by an AlphaTheta DDJ-GRV6.
- Local, analyzed music files for the first release.
- Beat Sync is part of the normal workflow.
- A visual scene is reusable with any song; each loaded deck owns an independent instance of its assigned scene.
- A scene’s cue-action order is configured once inside that scene.
- Song qualification occurs on the first of play, hot-cue playback, or becoming the dominant deck; a loaded track is counted only once.
- Numbered clips have no permanent roles. Visual-loop timeline events decide which clip appears, when it appears, which source timestamp it starts at, and how it is rendered; raw video is the default.
- A visual loop may be one repeating clip or a multi-clip sequence arranged in measures and beats.
- Normal playback starts the scene's default visual loop. Every hot cue selects and restarts another persistent visual loop.
- Channel-level and crossfader intent determine the relative opacity of the two deck outputs; nonzero weights are normalized to total 100%.
- Primary output target is 1920x1080 at 60 Hz. 4K is a later optimization.
- macOS and Windows are required product targets.

## Core experience

### Before the set: Studio

1. Import, generate, or edit video clips.
2. Assemble numbered clips into one or more visual-loop timelines with optional per-event filters.
3. Preview the scene against a simulated BPM and beat grid using the same renderer as the player.
4. Put scenes in a deliberate queue and choose an automatic advance count per scene.
5. Configure a stable hot-cue action order for that scene.
6. Validate and pre-cache all media before show mode.

Example three-clip scene:

- Make Clip 1 the repeating default visual loop for normal playback.
- Map looping audio Hot Cue A to a four-bar visual loop containing Clip 2.
- Map looping audio Hot Cue B to a two-bar visual loop containing Clip 3.
- Leave later Hot Cue slots unavailable until another clip or authored loop is added; never make the default state cycle through otherwise cue-selected clips.
- Advance to the next scene after two newly played tracks.

### During the set: Player

1. Open a prepared set and select the projector.
2. Confirm Link clock, Rekordbox bridge, loaded scene, and next scene.
3. Put the output window on the projector and enter full screen.
4. Start automatic mode and return attention to Rekordbox.
5. Retain only essential live controls: freeze, previous/next scene, intensity, and resync.

The bridge and viewer may be separate processes for stability, but they should launch and recover as one product rather than feeling like three applications.

## Product principles

- **Set and forget:** automatic operation is the default; intervention is an escape hatch.
- **Musical time first:** rules use beats, bars, and phrases, not milliseconds.
- **Edited-video first:** effects and generative shaders may come later.
- **Reusable scenes:** scene rules must not depend on one track’s phrase map.
- **Bounded runtime:** protect Rekordbox with predictable CPU, GPU, memory, and disk work.
- **Graceful degradation:** if cues disappear, continue the current scene on the last trustworthy clock.
- **Observable:** show clock health, timing, dropped frames, and buffer health without clutter.
- **Safe output:** never expose the Studio, file dialogs, desktop, or error stacks on the projector.

## First release boundary

Included:

- macOS and Windows;
- one laptop/desktop and one external 1080p display;
- independent per-deck scene instances with normalized visual mixing;
- role-neutral numbered clips and repeating visual-loop timelines;
- hot-cue bindings that select persistent loops and distinguish audio loop cues from audio jump cues;
- scene queue with manual and after-N-songs advance;
- beat/bar scheduling down to 1/16-note duration;
- consistent scene-level hot-cue action order;
- read-only Ableton Link clock plus confirmed, passive DDJ-GRV6 MIDI input mappings;
- focused Studio and Player modes.

Deferred:

- Rekordbox effect mirroring;
- 4K qualification;
- projection mapping, multi-projector output, NDI, Syphon/Spout, DMX, cameras, or streaming;
- broad plugin/shader workstations;
- cloud accounts and collaboration;
- automatic downloading of copyrighted footage.

## AI-assisted editing

An authoring agent can translate a plain-language request into an explicit, reproducible media job:

1. find user-owned, licensed, Creative Commons, or public-domain sources;
2. record source URLs, rights notes, and hashes;
3. use deterministic recipes to trim, crop, grade, loop, and transcode;
4. produce scene JSON and a preview;
5. request approval before replacing source or scene files.

AI should help prepare assets. It should never be on the live timing or render path.
