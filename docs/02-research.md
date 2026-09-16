# Research: existing tools and Rekordbox integration

Research updated through 2026-09-03.

## Bottom line

Several products cover pieces of the idea, but none combines all four priorities: edited-video scenes, phrase-level automation, Rekordbox-derived triggers, and a small same-Mac runtime.

The closest built-in option is Rekordbox Video. The closest general VJ option is Resolume. The closest automatic music-reactive option is Synesthesia. They are useful references, but a narrow custom player is justified if the intended workflow is scene preparation followed by largely unattended playback. The user’s DDJ-GRV6 hardware unlocks Rekordbox Performance mode, but full Video functions are documented as a Creative/Professional-plan feature rather than part of this controller’s hardware unlock.

## Existing-tool comparison

| Tool | Useful overlap | Why it does not fully match |
| --- | --- | --- |
| **Rekordbox Video** | Runs inside Rekordbox; two video decks; audio/video linking; video crossfader; transitions and touch effects; projector output; delay compensation; Syphon output on Mac. | It follows the two-deck DJ metaphor rather than a queued scene with layered, beat-rule sequencing. Current documented support is limited to 1920x1080 and H.264/MPEG formats. Full video functions require Creative or Professional. Running video inside Rekordbox also shares the process whose audio stability we most want to protect. |
| **Resolume Avenue/Arena** | Mature clip/layer model, MIDI and OSC control, projector workflows, and Ableton Link tempo/measure synchronization. | It is a broad VJ workstation. The desired automatic scene lifecycle and Rekordbox hot-cue/song semantics would still need custom glue and show programming. |
| **Synesthesia** | Projector output, imported media, playlists, MIDI/OSC, and strong audio reactivity. | It is primarily a shader/audio-reactive visual instrument. Edited-video phrase sequencing is secondary, and audio analysis is not the same as exact beat-grid/cue state. |
| **Videosync** | Treats video musically in Ableton Live, including timeline/session workflows, follow actions, warping, modulation, and automation. | Requires Ableton Live and Max for Live as a second performance environment and still lacks direct Rekordbox cue/track state. |
| **Beat Link Trigger** | Rich triggers from Pioneer/AlphaTheta PRO DJ LINK hardware: beats, play state, track metadata, positions, and show cues; can bridge to MIDI/OSC. | Its own documentation warns against running it on the same computer as Rekordbox because of network-port competition. It also cannot help with controllers that have no DJ Link Ethernet interface, and some metadata features depend on local, fully analyzed tracks. |
| **Arkestra** | Ableton Link, MIDI, OSC, scenes, audio reactivity, video, shaders, 3D, and other show outputs. | Much broader than the requested edited-video player and still does not solve Rekordbox-specific cue or song-boundary detection by itself. |

## What Rekordbox exposes

There is no documented public Rekordbox WebSocket or OSC playback-state API in the official material reviewed for Rekordbox 7.2.2.

### 1. Ableton Link — recommended clock source

Rekordbox supports Ableton Link. Link provides tempo, beat, phase, and optional start/stop intent. It works between applications on the same machine or local network and is specifically designed for low-latency musical synchronization. It is built into Rekordbox: Ableton Live is not required, and there is no separate end-user Link installation or purchase.

Strengths:

- Officially supported by Rekordbox and Ableton.
- Musical phase rather than a stream of approximate wall-clock ticks.
- No need to scrape the Rekordbox UI or read process memory.
- The visual engine can calculate any future beat boundary against a monotonic host clock.

Limits:

- Link is a shared session without a permanent master application, not a read-only “master deck output.” Any participant can propose tempo changes, so Video Sync should never do so by default.
- Rekordbox requires Link to be enabled globally and on the participating deck. We need to test how this fits the actual performance workflow, especially if manual beatmatching is preferred.
- Link does not expose track identity, active deck, channel fader, hot cues, phrase labels, or song boundaries.

### 2. Rekordbox MIDI output — limited indicator path

Rekordbox MIDI Learn includes an `Indicator` control type and documents MIDI OUT messages used to illuminate the selected MIDI equipment. The live GRV6 test did not expose a general Rekordbox-to-app event destination; the bridge's virtual input received no data.

It is not a hidden full-state API. The documented output is feature/indicator feedback for equipment, not track identity, waveform position, channel audio, arbitrary deck metadata, or a general WebSocket-like event stream. Keep the virtual endpoint only as a diagnostic; it is not the primary bridge.

### 3. Controller MIDI — confirmed primary control path

On 2026-09-04, a second CoreMIDI client passively received DDJ-GRV6 messages while Rekordbox 7.2.2 continued playing. The capture matched AlphaTheta's published assignments for Play/Pause, Beat Sync, and the 14-bit tempo fader. The published profile also identifies Hot Cues A-C, channel faders, and the crossfader. The bridge uses RtMidi over CoreMIDI and the corresponding Windows backend.

Strengths:

- Very low-latency local events.
- Captures the performer’s intent at button press time.
- The event path is local and can be kept outside the UI/render thread.

Limits:

- Concurrent access is still device- and platform-specific; the successful coexistence observation is macOS plus this GRV6, not yet Windows proof.
- Rekordbox MIDI Learn documents MIDI input mappings and indicator feedback; it is not a general event-output API.
- A longer labeled capture and 30-minute audio soak are still required before calling every mapped control performance-qualified.

### DDJ-GRV6-specific findings

- AlphaTheta publishes a DDJ-GRV6 MIDI message list containing play, performance-pad, channel-fader, crossfader, loop, and effect-related assignments. The macOS coexistence test confirmed that a second process can subscribe while Rekordbox owns the device.
- The official Rekordbox hardware diagram maps **Beat Sync** to sync on/off and **Shift + Beat Sync** to set that deck as master.
- Rekordbox documents master selection as explicit. If the current master track changes or unloads it may hand master to the other deck, but moving the crossfader is not documented as a master-selection action.
- Sync master and audible/dominant deck must therefore be modeled separately.
- AlphaTheta warns against running multiple DJ software applications concurrently. Video Sync is a passive visual bridge, but the warning makes an actual coexistence test mandatory before relying on controller messages.

### 4. Local Rekordbox services — observed, unsupported

On the inspected Mac, the running Rekordbox process listened on local TCP ports 50000, 55000, and 55002, and `rekordboxAgent` listened on 30003. Safe probes did not reveal a public deck-state HTTP endpoint. Binary strings associate 55000/55002 with local redirect pages and 50000 with PRO DJ LINK-related behavior. These are evidence of internal services, not a stable WebSocket or REST contract.

Reverse-engineering them may be possible, but it would be version-fragile and is not justified before supported Link/MIDI routes are exhausted.

### 5. PRO DJ LINK — rich optional path for CDJ/XDJ environments

PRO DJ LINK broadcasts useful live state on supported networked decks. The open-source Beat Link ecosystem demonstrates access to beat packets, tempo, metadata, beat grids, and playhead information.

This is attractive for a future club/CDJ mode, but it is not the primary same-Mac path because:

- many controllers have no compatible Ethernet protocol;
- Beat Link Trigger warns about competing with Rekordbox on the same host;
- a robust setup may require a second computer or dedicated bridge;
- compatibility varies by hardware and firmware.

### 6. Rekordbox library/analysis data — editor enrichment, not live clock

Rekordbox stores analyzed BPM, beat grids, cues, waveforms, and phrase information. The data can potentially enrich editing or precompute scene suggestions after track identity is known. It does not by itself tell the player which deck is audible or where the live playhead is. The inspected installation contains local database and playlist files, but the main database is undocumented and appears encrypted.

We should avoid making an undocumented database or memory-reading technique the critical live-performance path.

### 7. Master-audio analysis — fallback only

Capturing the master signal can provide onset, energy, and approximate downbeat detection. It is useful for intensity or future reactive effects, but it has more latency and uncertainty than Link and cannot identify hot cues or tracks.

## Proposed integration hierarchy

1. **Clock:** Ableton Link.
2. **Gestures and continuous controls:** passive DDJ-GRV6 MIDI observation using an explicit, versioned device profile.
3. **Accepted boolean states:** Rekordbox MIDI indicator output only if a later test exposes a useful state that controller gestures cannot establish.
4. **Song/active-deck state:** infer only from confirmed inputs; keep track-specific mapping disabled until a stable track key exists.
5. **Fallback:** audio analysis for energy and recovery, never as the only proof of beat phase when Link is healthy.
6. **Optional club mode:** PRO DJ LINK on supported hardware, likely using a separate host or bridge.

## Test-footage rights decision

The classic-film test scene uses only a Wikisource-hosted version of *Metropolis* (1927) that is identified as public domain in the United States. Later restorations, scores, and non-U.S. rights can differ. *Seven Samurai* (1954) is excluded because it remains copyright-protected; familiarity or age is not enough to make footage safe to reuse.

## Source material

- [Rekordbox 7 Video Operation Guide](https://cdn.rekordbox.com/files/20241203185046/rekordbox7.0.5_video_operation_guide_EN.pdf)
- [Rekordbox Video FAQ](https://rekordbox.com/en/support/faq/rekordbox7/)
- [Rekordbox MIDI Learn Operation Guide](https://cdn.rekordbox.com/files/20241203210623/rekordbox7.0.5_midi_learn_operation_guide_EN.pdf)
- [DDJ-GRV6 Rekordbox hardware diagram](https://downloads.support.alphatheta.com/software_info/dj-controllers/DDJ-GRV6/DDJ-GRV6_HardwareDiagram_rekordbox_Mac_Windows_E1.pdf)
- [DDJ-GRV6 MIDI message list](https://downloads.support.alphatheta.com/software_info/dj-controllers/DDJ-GRV6/DDJ-GRV6_MIDI_Message_List_E1.pdf)
- [DDJ-GRV6 usage precautions](https://support.alphatheta.com/en-US/articles/37284057102489)
- [Rekordbox Ableton Link FAQ](https://rekordbox.com/en/support/faq/rekordbox6/)
- [Ableton Link overview](https://www.ableton.com/en/link/)
- [Ableton Link concepts and API](https://ableton.github.io/link/)
- [Ableton Link source and integration requirements](https://github.com/Ableton/link)
- [Beat Link Trigger](https://github.com/Deep-Symmetry/beat-link-trigger)
- [Resolume Ableton Link support](https://resolume.com/support/en/link)
- [Resolume clips](https://resolume.com/support/en/clips)
- [Synesthesia](https://synesthesia.live/)
- [Videosync](https://www.showsync.com/videosync/)
- [Arkestra](https://www.arkestra.app/)
- [Wikisource Metropolis source file](https://en.wikisource.org/wiki/File:Metropolis_(1927,_English_titles_1930s).webm)
- [Library of Congress Copyright Office on Metropolis](https://blogs.loc.gov/copyright/?p=3049)
