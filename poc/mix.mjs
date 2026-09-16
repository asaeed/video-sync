export function clamp(value, min = 0, max = 1) {
  return Math.min(max, Math.max(min, value));
}

export function crossfaderGains(position) {
  const normalized = clamp(position);
  return [1 - normalized, normalized];
}

export function computeDeckOpacities(decks, crossfaderPosition) {
  const crossfader = crossfaderGains(crossfaderPosition);
  const raw = decks.map((deck, index) => {
    if (!deck.loaded) return 0;
    return clamp(deck.level) * (crossfader[index] ?? 0);
  });
  const sum = raw.reduce((total, value) => total + value, 0);
  if (sum <= Number.EPSILON) return raw.map(() => 0);
  return raw.map((value) => value / sum);
}

export function dominantDeck(opacities, threshold = 0.6) {
  const highest = Math.max(...opacities);
  if (highest < threshold) return null;
  const index = opacities.indexOf(highest);
  return opacities.filter((value) => value === highest).length === 1 ? index + 1 : null;
}
