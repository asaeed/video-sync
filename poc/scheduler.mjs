export const BEATS_PER_BAR = 4;

export function nowEpochMs() {
  return performance.timeOrigin + performance.now();
}

export function noteToBeats(denominator) {
  if (!Number.isFinite(denominator) || denominator <= 0) {
    throw new RangeError("note denominator must be positive");
  }
  return 4 / denominator;
}

export function positiveModulo(value, modulus) {
  return ((value % modulus) + modulus) % modulus;
}

export function beatAt(clock, epochMs) {
  if (!clock.playing) return clock.anchorBeat;
  return clock.anchorBeat + ((epochMs - clock.anchorEpochMs) * clock.bpm) / 60000;
}

export function epochMsAtBeat(clock, beat) {
  if (!(clock.bpm > 0)) throw new RangeError("clock bpm must be positive");
  return clock.anchorEpochMs + ((beat - clock.anchorBeat) * 60000) / clock.bpm;
}

export function phrasePosition(beat, bars = 16) {
  if (!Number.isInteger(bars) || bars <= 0) throw new RangeError("phrase bars must be a positive integer");
  const phraseBeats = bars * BEATS_PER_BAR;
  const beatInPhrase = positiveModulo(beat, phraseBeats);
  return {
    bar: Math.floor(beatInPhrase / BEATS_PER_BAR) + 1,
    barProgress: positiveModulo(beatInPhrase, BEATS_PER_BAR) / BEATS_PER_BAR,
    phraseProgress: beatInPhrase / phraseBeats,
  };
}

export function reanchorClock(clock, epochMs, changes = {}) {
  const currentBeat = beatAt(clock, epochMs);
  return {
    ...clock,
    ...changes,
    anchorBeat: currentBeat,
    anchorEpochMs: epochMs,
  };
}

export function computeVisualState({
  beat,
  baseEveryBars = 4,
  baseCount = 2,
  overlayEveryBeats = 2,
  overlayDurationBeats = noteToBeats(16),
  baseOffset = 0,
}) {
  const baseSpanBeats = baseEveryBars * BEATS_PER_BAR;
  const baseStep = Math.floor(Math.max(0, beat) / baseSpanBeats);
  const baseIndex = positiveModulo(baseStep + baseOffset, baseCount);
  const overlayPhase = positiveModulo(beat, overlayEveryBeats);

  return {
    beat,
    barNumber: Math.floor(Math.max(0, beat) / BEATS_PER_BAR) + 1,
    beatInBar: Math.floor(positiveModulo(beat, BEATS_PER_BAR)) + 1,
    beatPhase: positiveModulo(beat, 1),
    baseIndex,
    baseStep,
    baseBoundaryBeat: baseStep * baseSpanBeats,
    overlayVisible: overlayPhase < overlayDurationBeats,
    overlayPhase,
  };
}

export class SongCounter {
  constructor(deckCount = 4) {
    this.decks = Array.from({ length: deckCount }, () => ({
      loadGeneration: 0,
      countedGeneration: -1,
      loaded: false,
    }));
    this.total = 0;
  }

  load(deckNumber) {
    const deck = this.#deck(deckNumber);
    deck.loadGeneration += 1;
    deck.loaded = true;
    return { counted: false, total: this.total };
  }

  qualify(deckNumber, reason) {
    const deck = this.#deck(deckNumber);
    if (!deck.loaded || deck.countedGeneration === deck.loadGeneration) {
      return { counted: false, total: this.total, reason };
    }
    deck.countedGeneration = deck.loadGeneration;
    this.total += 1;
    return { counted: true, total: this.total, reason };
  }

  #deck(deckNumber) {
    const deck = this.decks[deckNumber - 1];
    if (!deck) throw new RangeError(`invalid deck ${deckNumber}`);
    return deck;
  }
}
