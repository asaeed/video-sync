# Decisions and remaining questions

## Decisions from the initial planning session

- Product term: **scene**.
- Working name: **Video Sync**.
- Platforms: macOS and Windows.
- Hardware under test: AlphaTheta DDJ-GRV6.
- Rekordbox: 7.2.2, Performance mode via hardware unlock.
- Media: local analyzed files initially.
- Output: 1920x1080 at 60 Hz first; 4K later.
- Clock: read-only Ableton Link; local adapter output is proven, live Rekordbox joining remains to be tested.
- Visual model: each loaded deck owns an independent scene instance; deck transport starts/freezes its visuals.
- Mixing: linear crossfader gain multiplied by channel-level position, then normalized so active visual opacities total 100%.
- Clips: numbered, role-neutral media.
- Visual loops: one or more clips arranged as repeating events on a measures/beats timeline; one loop is the default for normal deck play.
- Cue bindings: every Hot Cue selects a persistent visual loop; A/B are modeled audio loops and C is an audio jump cue.
- Filters: raw by default; optional on an individual timeline event.
- UI: one shell with compact Live mode and an expandable Author mode; expensive authoring and agent work stay outside the performance process.
- Queue: scene items carry a song count; advancing becomes pending and applies to the next newly loaded/qualified deck rather than replacing both active scenes mid-transition.
- Minimum rhythmic duration: 1/16 note (`0.25` beats in 4/4).
- Scene cue mappings: stable, user-configured order inside each reusable scene.
- Song qualification: first play, playback hot cue, or incoming-deck dominance per new load.
- Automatic advance: configurable after-N-counted-songs, with manual override.
- Failure behavior: keep the current scene running at the last stable tempo; never expose the desktop.
- Test footage: original AI footage plus *Metropolis*; exclude *Seven Samurai*.
- Final engine direction: modular C++20 bridge/viewer with Tauri Studio shell.

## Clarifications

### Beat Sync versus Ableton Link

Beat Sync is the Rekordbox feature that aligns decks to a selected sync master. Ableton Link is a separate inter-application synchronization protocol already built into Rekordbox. It is free to use as a user, and Ableton Live does not need to be installed. Video Sync will join that session as a peer and should not change its tempo unless a future setting explicitly permits it.

### Master deck behavior

Deck 2 should not be assumed to become sync master merely because it is louder or the crossfader moves toward it. Rekordbox supports explicit master selection; on the GRV6 that is Shift + Beat Sync. Rekordbox may move master when the existing master track is changed/unloaded, but audible dominance and sync master remain separate concepts in the data model.

## Questions best answered by hands-on tests

1. Does visible title extraction remain stable across Rekordbox layouts, window sizes, and two-deck/four-deck modes?
2. Which Rekordbox layouts expose a loop cue label, end time, or beat length through Accessibility, and which expose only a cue timestamp?
3. How much phase error remains in the playhead-derived clock at slow and fast tempos, before and after **Tap downbeat** correction?
4. Which audio-loop reset and Beat FX events are still missing after the confirmed direct-GRV6 mappings?
5. Does the initial linear visual crossfade feel right, or should it eventually follow Rekordbox's selected crossfader curve?
6. If the incoming deck becomes dominant before play/hot-cue is observable, what threshold and debounce feel natural?
7. When every live clock source disappears, should Player continue indefinitely at last tempo or warn and freeze automatic scene advancement after a timeout?
8. Which projector model/connection will be used for the first real latency and soak test?

The current test rig showed that enabling Link changed the normal Beat Sync workflow, so Link is optional and disabled for the primary macOS path. The deck-state v2 contract now covers transport inference, visible identity, cue metadata, and labeled phase estimates, but the Accessibility fields still require a fresh loaded-track capture before they are hardware-qualified.
