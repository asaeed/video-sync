# Scene catalog and set sequencer

## Implemented state

- 36 film-footage scene contracts are registered in `poc/scene-catalog.mjs` and exported as individual JSON files under `scenes/catalog/`.
- Every playable scene has 12 numbered clips, one persistent Clip 1 default loop, varied two-clip Cue A–G mappings, and a load-time random-loop definition. Hot Cue H is always visible as the eighth controller input and selects the generated random loop.
- 28 scenes have local performance media and are enabled in the emulator.
- 8 scenes are fully described but disabled until a source is supplied and packaged: seven copyrighted wishlist titles and the mixed-rights Popeye collection.

## Playable scenes

1. Metropolis Machine — 12 independent clips from the same public-domain U.S. release scan.
2. Gumby Clay Trip — 8 locally packaged Internet Archive excerpts.
3. Swing You Sinners! — 8 locally packaged excerpts.
4. Fiddlesticks — 8 locally packaged excerpts.
5. The Skeleton Dance — 8 locally packaged excerpts.
6. The Adventures of Prince Achmed — 8 locally packaged excerpts.
7. A Trip to the Moon — 8 locally packaged excerpts from a public-domain-marked 1080p Commons scan.
8. King of Jazz — 8 locally packaged two-color Technicolor revue excerpts.
9. Whoopee! — 8 locally packaged two-color Technicolor musical excerpts.
10. Gulliver's Travels — 8 locally packaged Fleischer animation excerpts.
11. Nothing Sacred — 8 locally packaged Technicolor screwball-comedy excerpts.
12. Charade — 8 locally packaged Paris thriller excerpts.
13. The Cameraman's Revenge — 8 locally packaged insect stop-motion excerpts.
14. The Lodger — 8 locally packaged Hitchcock suspense excerpts.
15. Underworld — 8 locally packaged gangster-noir excerpts.
16. The Docks of New York — 8 locally packaged waterfront excerpts.
17. Häxan — 8 locally packaged occult phantasmagoria excerpts.
18. Nosferatu — 8 locally packaged excerpts.
19. The Cat and the Canary — 8 locally packaged haunted-house excerpts.
20. The Fall of the House of Usher — 8 locally packaged experimental-horror excerpts.
21. Aelita: Queen of Mars — 8 locally packaged excerpts.
22. Woman in the Moon — 8 locally packaged rocket and lunar excerpts.
23. Paris qui dort / The Crazy Ray — 8 locally packaged excerpts.
24. The Mechanical Man — 8 locally packaged robot-mayhem excerpts.
25. The Iron Horse — 8 locally packaged railroad-western excerpts.
26. 3 Bad Men — 8 locally packaged kinetic-western excerpts.
27. Man with a Movie Camera — 8 locally packaged excerpts.
28. Ballet mécanique — 8 locally packaged Dada-machine excerpts.

## Queue semantics

The queue is global across both decks. It tracks an ordered list of stable entry IDs, not merely scene IDs, so the same scene may appear more than once with different repeat counts.

On every new deck load:

1. read the entry at the queue cursor;
2. assign its scene to the loading deck;
3. use the authored clip order for the entry's first song, then freshly shuffle clip assignments for each later song in the same ×2–×8 run;
4. increment that entry's consumed-song count;
5. remain on the entry until its ×1–×8 count is exhausted;
6. advance to the next entry, wrapping at the end.

The shuffle changes which clip appears in the default and Hot Cue loop slots while preserving each slot's authored timing, cue behavior, and effects. It is fixed for that deck load, so a later load on the other deck never rearranges visuals already playing. Each new queue entry begins in authored order again.

Play, dominance, and hot-cue events do not advance the scene queue. They may qualify a loaded song for the diagnostic song counter, but assignment itself occurs only at load time. The emulator's Load/Reload buttons and the DDJ-GRV6 LOAD 1/LOAD 2 controls call the same function. The physical mappings use AlphaTheta's documented channel-7 notes 70 and 71; a mouse drag or software-only load inside Rekordbox remains invisible to direct controller MIDI.

Queue order, repeat counts, cursor, and partial progress persist in browser local storage. Drag-and-drop and explicit arrow buttons use the same reorder method and preserve the identity of the next entry.

Clicking a queue row makes it the next assignment, resets that entry's consumed-song count, and continues through the ordered sequence from that point. The minus/plus control changes its song count from ×1 through ×8. “+ Add item” appends a row in one step; select its scene using that row's scene control.

## Media packaging

The live path never streams a film from the internet. `scripts/fetch-archive-scene.mjs` seeks into a configured Internet Archive or direct institutional source and transcodes only eight-second 1280×720 H.264 performance clips. The active catalog and media build path are film footage only.

This is intentionally different from authoring storage. A future authoring project may retain one master movie plus in/out timestamps, but the performance package should remain a directory of short, seek-friendly files with regular keyframes.

Every performance excerpt must be reviewed at its beginning, midpoint, and final half-second. Opening titles, intertitles, dialogue cards, end credits, and fades that leave the frame unreadable should be retimed out. Each scene should reserve at least one or two clip slots for signature images that make its source recognizable at a glance; the other clips should favor motion, visual rhythm, and useful contrast.

## Source-needed catalog

The remaining public-domain candidates and copyrighted wishlist titles still have complete clip labels and loop mappings. They are shown in deck scene selectors with a “source needed” suffix and cannot be selected accidentally. Copyrighted titles require a lawfully obtained local file; no pirated source is bundled.

## Next implementation slices

1. Add a catalog browser with preview thumbnails and a “package source” flow.
2. Add cue-length authoring rather than the current predictable 1/2/3/4/1/2/4/8-bar defaults.
3. Decide whether software-only Rekordbox loads need an optional MIDI-output mapping; physical GRV6 LOAD 1/LOAD 2 are now verified.
4. Measure controller-event-to-photon latency under Rekordbox plus dual-deck 1080p load.
