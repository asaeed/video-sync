export function authoredClipOrder(scene) {
  return scene.clips.map((clip) => clip.id);
}

export function normalizeClipOrder(scene, candidate) {
  const authored = authoredClipOrder(scene);
  if (!Array.isArray(candidate) || candidate.length !== authored.length) return authored;
  const allowed = new Set(authored);
  const unique = new Set(candidate);
  if (unique.size !== authored.length || candidate.some((clipId) => !allowed.has(clipId))) return authored;
  return [...candidate];
}

function randomIndex(random, limit) {
  const value = Number(random());
  const normalized = Number.isFinite(value) ? Math.min(0.999999999, Math.max(0, value)) : 0;
  return Math.floor(normalized * limit);
}

export function shuffledClipOrder(scene, random = Math.random) {
  const authored = authoredClipOrder(scene);
  const shuffled = [...authored];
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const swapIndex = randomIndex(random, index + 1);
    [shuffled[index], shuffled[swapIndex]] = [shuffled[swapIndex], shuffled[index]];
  }

  if (shuffled.length > 1 && shuffled[0] === authored[0]) {
    const replacementIndex = shuffled.findIndex((clipId, index) => index > 0 && clipId !== authored[0]);
    [shuffled[0], shuffled[replacementIndex]] = [shuffled[replacementIndex], shuffled[0]];
  }
  return shuffled;
}

export function clipOrderForAssignment(scene, assignment, random = Math.random) {
  return assignment?.occurrence > 1
    ? shuffledClipOrder(scene, random)
    : authoredClipOrder(scene);
}

export function remapSceneClipId(scene, clipOrder, authoredClipId) {
  const authored = authoredClipOrder(scene);
  const index = authored.indexOf(authoredClipId);
  if (index < 0) return authoredClipId;
  return normalizeClipOrder(scene, clipOrder)[index] ?? authoredClipId;
}
