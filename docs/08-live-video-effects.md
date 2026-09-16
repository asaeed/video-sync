# Live video effects

The POC maps every Beat FX available from the DDJ-GRV6 effect selector to a distinct, beat-synchronous video treatment. The bridge passively reads the controller; it never sends MIDI to the GRV6 or Rekordbox.

| Rekordbox Beat FX | Video analog |
| --- | --- |
| Delay | Beat-stepped displacement and cool trailing bands |
| Echo | Expanding, fading image rings |
| Low Cut Echo | Dark, high-contrast amber echo |
| Spiral | Rotating recursive zoom |
| Helix | Counter-rotating chromatic shear |
| Reverb | Soft blur, bloom, and luminous haze |
| Flanger | Fast lateral sweep and scanline interference |
| Phaser | Traveling hue phase with opposing rotation |
| Filter | Blur/contrast aperture that opens and closes |
| Trans | Hard beat-gated shutter |
| Pitch | Vertical stretch, lift, and hue shift |
| Roll | Quantized visual jump cuts |
| Mobius Saw | One-way infinite zoom with a hard reset |
| Mobius Tri | Ping-pong infinite zoom |

The GRV6 target selector applies the treatment to Deck 1, Deck 2, or both decks when **Master** is selected. Decks 3 and 4 and the sampler have no corresponding visual layer in this two-deck POC, so selecting them produces no video effect. **LEVEL/DEPTH** controls the wet amount. The beat arrows select a range from 1/16 beat through 16 beats, and all animation phase is derived from the shared Link clock.

Effect selection, target, and depth are absolute controls and are safe to restore after a browser reconnect. ON/OFF and the beat arrows are edge controls, so they are intentionally not replayed from bridge history.

An unassigned Hot Cue A–H is still a meaningful song event: it starts the deck and retriggers the scene's default visual loop. Assigned cues continue to route to their configured scene loop.

Sources: [DDJ-GRV6 MIDI Message List](https://downloads.support.alphatheta.com/software_info/dj-controllers/DDJ-GRV6/DDJ-GRV6_MIDI_Message_List_E1.pdf), [rekordbox 7 manual](https://cdn.rekordbox.com/files/20260409151936/rekordbox7.214_manual_EN.pdf).

## Current boundary

This pass implements all 14 Beat FX exposed by the GRV6 Beat FX selector. Sound Color FX, Release FX, Merge FX, and Pad FX need separate discovery because the GRV6 MIDI stream does not expose all of their currently selected Rekordbox effect identities through the same selector messages.
