const DEFAULT_PAUSE_CONFIRM_MS = 500;
const MINIMUM_POSITION_MOVEMENT_SECONDS = 0.035;

function finiteNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function cleanText(value) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function positiveModulo(value, modulus) {
  return ((value % modulus) + modulus) % modulus;
}

function fnv1a(value) {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

export function fingerprintForTrack({ title, artist, durationSeconds } = {}) {
  const normalizedTitle = cleanText(title)?.toLocaleLowerCase() ?? "";
  const normalizedArtist = cleanText(artist)?.toLocaleLowerCase() ?? "";
  const duration = finiteNumber(durationSeconds);
  if (!normalizedTitle) return null;
  const durationPart = duration !== null ? Math.round(duration * 10) / 10 : "";
  return `visible:${fnv1a(`${normalizedTitle}\n${normalizedArtist}\n${durationPart}`)}`;
}

export function normalizeHotCues(hotCues = []) {
  return hotCues.flatMap((cue) => {
    const cueIndex = Number(cue?.cueIndex);
    const timeSeconds = finiteNumber(cue?.timeSeconds);
    if (!Number.isInteger(cueIndex) || cueIndex < 0 || cueIndex > 7 || timeSeconds === null || timeSeconds < 0) return [];
    const kind = ["cue", "loop"].includes(cue.kind) ? cue.kind : "unknown";
    const endTimeSeconds = finiteNumber(cue.endTimeSeconds);
    const lengthBeats = finiteNumber(cue.lengthBeats);
    return [{
      cueIndex,
      timeSeconds,
      kind,
      ...(endTimeSeconds !== null && endTimeSeconds > timeSeconds ? { endTimeSeconds } : {}),
      ...(lengthBeats !== null && lengthBeats > 0 ? { lengthBeats } : {}),
      ...(typeof cue.active === "boolean" ? { active: cue.active } : {}),
      metadataBasis: cleanText(cue.metadataBasis) ?? "timestamp-only",
    }];
  }).sort((left, right) => left.timeSeconds - right.timeSeconds || left.cueIndex - right.cueIndex);
}

export function estimateBeatPosition({ bpm, positionSeconds, beatPosition, hotCues = [] } = {}) {
  const exactBeat = finiteNumber(beatPosition);
  if (exactBeat !== null) {
    return {
      beatPosition: exactBeat,
      beatPhase: positiveModulo(exactBeat, 1),
      beatGridOffsetBeats: 0,
      phaseBasis: "accessibility-beat-counter",
      phaseConfidence: "high",
    };
  }

  const tempo = finiteNumber(bpm);
  const position = finiteNumber(positionSeconds);
  if (!(tempo > 0) || position === null || position < 0) return null;
  const rawBeat = position * tempo / 60;
  const cueBeats = normalizeHotCues(hotCues).map((cue) => cue.timeSeconds * tempo / 60);
  if (cueBeats.length >= 2) {
    let x = 0;
    let y = 0;
    for (const cueBeat of cueBeats) {
      const angle = positiveModulo(cueBeat, 1) * Math.PI * 2;
      x += Math.cos(angle);
      y += Math.sin(angle);
    }
    const concentration = Math.hypot(x, y) / cueBeats.length;
    if (concentration >= 0.82) {
      const averagePhase = positiveModulo(Math.atan2(y, x) / (Math.PI * 2), 1);
      const offset = averagePhase > 0.5 ? 1 - averagePhase : -averagePhase;
      const correctedBeat = rawBeat + offset;
      return {
        beatPosition: correctedBeat,
        beatPhase: positiveModulo(correctedBeat, 1),
        beatGridOffsetBeats: offset,
        phaseBasis: "hot-cue-grid-estimate",
        phaseConfidence: cueBeats.length >= 3 && concentration >= 0.94 ? "medium" : "low",
      };
    }
  }

  return {
    beatPosition: rawBeat,
    beatPhase: positiveModulo(rawBeat, 1),
    beatGridOffsetBeats: 0,
    phaseBasis: "track-time-zero-estimate",
    phaseConfidence: "low",
  };
}

function emptyDeckState(deck) {
  return {
    deck,
    wasLoaded: false,
    fingerprint: null,
    loadGeneration: 0,
    lastPositionSeconds: null,
    lastObservedAtUnixMs: null,
    stableSinceUnixMs: null,
    transportKnown: false,
    playing: false,
    transportBasis: "unobserved",
    transportChangedAtUnixMs: null,
    hintedPlaying: null,
    transportHintUntilUnixMs: null,
    hotCues: [],
  };
}

export class RekordboxStateTracker {
  constructor(deckCount = 2, { pauseConfirmMs = DEFAULT_PAUSE_CONFIRM_MS, sessionId = null } = {}) {
    this.pauseConfirmMs = pauseConfirmMs;
    this.sessionId = sessionId ?? `rbx-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
    this.decks = Array.from({ length: deckCount }, (_, index) => emptyDeckState(index + 1));
    this.hotCueTimelines = new Map();
  }

  observe(message) {
    if (message?.type !== "rekordbox.deck-state" || !Array.isArray(message.payload?.decks)) return message;
    const observedAtUnixMs = finiteNumber(message.emittedAtUnixMs) ?? Date.now();
    const decks = message.payload.decks.flatMap((observation) => {
      const deckNumber = Number(observation?.deck);
      const state = this.decks[deckNumber - 1];
      return state ? [this.#observeDeck(state, observation, observedAtUnixMs)] : [];
    });
    return {
      ...message,
      payload: {
        contractVersion: 2,
        adapterSessionId: this.sessionId,
        capabilities: {
          absoluteTransport: true,
          trackIdentity: decks.some((deck) => Boolean(deck.trackFingerprint)),
          hotCueMetadata: true,
          beatPhase: "observed-or-estimated",
        },
        decks,
      },
    };
  }

  observeControl(payload, observedAtUnixMs = Date.now()) {
    if (!payload?.active) return false;
    const state = this.decks[Number(payload.deck) - 1];
    if (!state) return false;
    const hotCue = /^hotcue\.[a-h]$/i.test(payload.event);
    let playing = null;
    if (payload.event === "deck.play") playing = state.transportKnown ? !state.playing : true;
    else if (["deck.load", "track.load"].includes(payload.event)) playing = false;
    else if (hotCue) playing = true;
    if (playing === null) return false;
    state.transportKnown = true;
    state.playing = playing;
    state.transportBasis = "controller-hint";
    state.transportChangedAtUnixMs = observedAtUnixMs;
    state.hintedPlaying = playing;
    state.transportHintUntilUnixMs = observedAtUnixMs + 400;
    state.stableSinceUnixMs = playing ? null : observedAtUnixMs;
    return true;
  }

  #observeDeck(state, observation, observedAtUnixMs) {
    const loaded = Boolean(observation.loaded);
    const bpm = finiteNumber(observation.bpm);
    const positionSeconds = finiteNumber(observation.positionSeconds);
    const trackTitle = cleanText(observation.trackTitle);
    const trackArtist = cleanText(observation.trackArtist);
    const trackFingerprint = cleanText(observation.trackFingerprint) ?? fingerprintForTrack({
      title: trackTitle,
      artist: trackArtist,
      durationSeconds: observation.durationSeconds,
    });
    const identityChanged = Boolean(trackFingerprint && state.fingerprint && trackFingerprint !== state.fingerprint);
    const loadedTransition = loaded && !state.wasLoaded;
    const identityAttached = Boolean(loaded && trackFingerprint && !state.fingerprint);
    const loadChanged = loadedTransition || identityChanged;

    if (loadChanged) {
      state.loadGeneration += 1;
      state.transportKnown = false;
      state.playing = false;
      state.transportBasis = "new-load";
      state.transportChangedAtUnixMs = observedAtUnixMs;
      state.stableSinceUnixMs = observedAtUnixMs;
      state.lastPositionSeconds = null;
      state.lastObservedAtUnixMs = null;
      state.hintedPlaying = null;
      state.transportHintUntilUnixMs = null;
      state.hotCues = [];
    }
    if (!loaded && state.wasLoaded) {
      state.transportKnown = true;
      state.playing = false;
      state.transportBasis = "deck-unloaded";
      state.transportChangedAtUnixMs = observedAtUnixMs;
      state.stableSinceUnixMs = null;
      state.lastPositionSeconds = null;
      state.lastObservedAtUnixMs = null;
      state.fingerprint = null;
      state.hotCues = [];
    } else if (trackFingerprint) {
      state.fingerprint = trackFingerprint;
    }

    if (loaded && positionSeconds !== null) this.#observeTransport(state, positionSeconds, observedAtUnixMs);
    else if (!loaded) {
      state.transportKnown = true;
      state.playing = false;
      state.transportBasis = "deck-unloaded";
    }

    state.wasLoaded = loaded;
    // Accessibility only exposes cue timestamps while that deck's PAD / Hot
    // Cue grid is visible. Treat an explicitly hidden grid as unavailable,
    // not as proof that the track has no cues, and retain the last observed
    // timeline for the same loaded track.
    const hotCueMetadataVisible = observation.hotCueMetadataVisible !== false;
    if (loaded && hotCueMetadataVisible) {
      state.hotCues = normalizeHotCues(observation.hotCues);
      if (state.fingerprint) this.hotCueTimelines.set(state.fingerprint, state.hotCues);
    } else if (loaded && state.hotCues.length === 0 && state.fingerprint && this.hotCueTimelines.has(state.fingerprint)) {
      state.hotCues = this.hotCueTimelines.get(state.fingerprint);
    }
    const hotCues = loaded ? state.hotCues : [];
    const hotCueMetadataBasis = hotCueMetadataVisible
      ? "visible"
      : (hotCues.length > 0 ? "cached" : "unavailable");
    const phase = estimateBeatPosition({
      bpm,
      positionSeconds,
      beatPosition: observation.beatPosition,
      hotCues,
    });

    return {
      deck: state.deck,
      loaded,
      bpm,
      positionSeconds,
      trackTitle,
      trackArtist,
      trackFingerprint: state.fingerprint,
      trackIdentityBasis: cleanText(observation.trackIdentityBasis) ?? (trackFingerprint ? "visible-title" : "unavailable"),
      loadGeneration: state.loadGeneration,
      loadChanged,
      identityAttached,
      transportKnown: state.transportKnown,
      playing: state.playing,
      transportBasis: state.transportBasis,
      transportChangedAtUnixMs: state.transportChangedAtUnixMs,
      hotCues,
      hotCueMetadataVisible,
      hotCueMetadataBasis,
      ...(phase ?? {
        beatPosition: null,
        beatPhase: null,
        beatGridOffsetBeats: null,
        phaseBasis: "unavailable",
        phaseConfidence: "none",
      }),
    };
  }

  #observeTransport(state, positionSeconds, observedAtUnixMs) {
    const previousPosition = state.lastPositionSeconds;
    const previousObservedAt = state.lastObservedAtUnixMs;
    if (previousPosition === null || previousObservedAt === null || observedAtUnixMs <= previousObservedAt) {
      state.lastPositionSeconds = positionSeconds;
      state.lastObservedAtUnixMs = observedAtUnixMs;
      state.stableSinceUnixMs = observedAtUnixMs;
      return;
    }

    const elapsedSeconds = (observedAtUnixMs - previousObservedAt) / 1000;
    const advanceSeconds = positionSeconds - previousPosition;
    const maximumContinuousAdvance = Math.max(2.5, elapsedSeconds * 2.25 + 0.5);
    const movingForward = advanceSeconds >= MINIMUM_POSITION_MOVEMENT_SECONDS && advanceSeconds <= maximumContinuousAdvance;
    const unchanged = Math.abs(advanceSeconds) < MINIMUM_POSITION_MOVEMENT_SECONDS;
    const hintActive = Number.isFinite(state.transportHintUntilUnixMs) && observedAtUnixMs <= state.transportHintUntilUnixMs;

    if (movingForward) {
      if (hintActive && state.hintedPlaying === false) {
        state.lastPositionSeconds = positionSeconds;
        state.lastObservedAtUnixMs = observedAtUnixMs;
        return;
      }
      const estimatedStartAt = observedAtUnixMs - Math.min(observedAtUnixMs - previousObservedAt, advanceSeconds * 1000);
      if (!state.playing || !state.transportKnown) state.transportChangedAtUnixMs = estimatedStartAt;
      state.transportKnown = true;
      state.playing = true;
      state.transportBasis = "playhead-motion";
      state.stableSinceUnixMs = null;
    } else if (unchanged) {
      if (hintActive && state.hintedPlaying === true) {
        state.lastPositionSeconds = positionSeconds;
        state.lastObservedAtUnixMs = observedAtUnixMs;
        return;
      }
      state.stableSinceUnixMs ??= previousObservedAt;
      if (observedAtUnixMs - state.stableSinceUnixMs >= this.pauseConfirmMs) {
        if (state.playing || !state.transportKnown) state.transportChangedAtUnixMs = state.stableSinceUnixMs;
        state.transportKnown = true;
        state.playing = false;
        state.transportBasis = "playhead-stable";
      }
    } else {
      // A seek or an audio-loop wrap is not itself evidence of pause. Keep a
      // previously confirmed playing state until the following samples prove
      // motion or stability.
      state.stableSinceUnixMs = observedAtUnixMs;
      if (!state.transportKnown) state.transportBasis = "playhead-discontinuity";
    }

    state.lastPositionSeconds = positionSeconds;
    state.lastObservedAtUnixMs = observedAtUnixMs;
    if (!hintActive) {
      state.hintedPlaying = null;
      state.transportHintUntilUnixMs = null;
    }
  }
}
