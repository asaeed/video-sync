export function clockFromLinkMessage(message) {
  if (message?.type !== "link.clock" || !(message.payload?.tempo > 0) || !Number.isFinite(message.payload?.beat)) return null;
  return {
    bpm: message.payload.tempo,
    playing: true,
    anchorBeat: message.payload.beat,
    anchorEpochMs: message.emittedAtUnixMs,
  };
}

export function rekordboxTempoPlan(message, runtimeDecks = [], opacities = []) {
  if (message?.type !== "rekordbox.deck-state" || !Array.isArray(message.payload?.decks)) return null;
  const decks = message.payload.decks.flatMap((entry) => {
    const deck = Number(entry?.deck);
    const bpm = Number(entry?.bpm);
    if (!entry?.loaded || !Number.isInteger(deck) || deck < 1 || deck > 4 || !(bpm >= 40 && bpm <= 300)) return [];
    return [{ deck, bpm }];
  });
  if (decks.length === 0) return null;

  const playing = decks.filter((entry) => runtimeDecks[entry.deck - 1]?.playing);
  const candidates = playing.length > 0 ? playing : decks;
  const source = candidates.reduce((best, candidate) => {
    const bestOpacity = Number(opacities[best.deck - 1]) || 0;
    const candidateOpacity = Number(opacities[candidate.deck - 1]) || 0;
    return candidateOpacity > bestOpacity ? candidate : best;
  });
  return { bpm: source.bpm, sourceDeck: source.deck, decks };
}

export function transportEntriesForEvent(state) {
  const decks = Array.isArray(state?.decks) ? state.decks : [];
  const changedDeck = Number(state?.changedDeck);
  if (!Number.isInteger(changedDeck) || changedDeck < 1) return decks;
  return decks.filter((transport) => Number(transport?.deck) === changedDeck);
}

export function commandFromController(payload) {
  if (!payload || !Number.isFinite(payload.value)) return null;
  const value = Math.min(1, Math.max(0, payload.value));
  const deck = Number(payload.deck);

  if (payload.event === "mixer.crossfader") return { type: "crossfader", value };
  if (payload.event === "deck.level" && deck >= 1 && deck <= 4) return { type: "deck-level", deck, value };
  if (["deck.load", "track.load"].includes(payload.event) && payload.active && deck >= 1 && deck <= 4) return { type: "load-deck", deck };
  if (payload.event === "deck.play" && payload.active && deck >= 1 && deck <= 4) return { type: "toggle-deck", deck };

  const beatFxSelection = /^beatfx\.select\.(.+)$/i.exec(payload.event);
  if (beatFxSelection && payload.active) return { type: "beatfx-select", effect: beatFxSelection[1].toLowerCase() };

  const beatFxTarget = /^beatfx\.target\.(deck[1-4]|master|sampler)$/i.exec(payload.event);
  if (beatFxTarget && payload.active) return { type: "beatfx-target", target: beatFxTarget[1].toLowerCase() };

  if (payload.event === "beatfx.toggle" && payload.active) return { type: "beatfx-toggle" };
  if (payload.event === "beatfx.beat-down" && payload.active) return { type: "beatfx-beat-step", direction: -1 };
  if (payload.event === "beatfx.beat-up" && payload.active) return { type: "beatfx-beat-step", direction: 1 };
  if (payload.event === "beatfx.depth") return { type: "beatfx-depth", value };

  const hotCue = /^hotcue\.([a-h])$/i.exec(payload.event);
  if (hotCue && payload.active && deck >= 1 && deck <= 4) {
    return { type: "hot-cue", deck, cueIndex: hotCue[1].toLowerCase().charCodeAt(0) - 97 };
  }
  return null;
}

export function resolveHotCueRoute(scene, cueIndex, randomLoop = null) {
  const input = `hotCue${String.fromCharCode(65 + cueIndex)}`;
  const binding = scene.cueBindings.find((candidate) => candidate.input === input) ?? null;
  const fallbackLoop = randomLoop ?? null;
  return {
    input,
    binding,
    loopId: binding?.visual.loopId ?? fallbackLoop?.id ?? scene.defaultLoopId,
    activeCueInput: binding?.input ?? (fallbackLoop ? input : null),
  };
}
