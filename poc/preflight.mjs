const FRESH_INPUT_MS = 5_000;

export function inputReadiness({ replaying = false, bridgeState = "connecting", signals = {} }, now = Date.now()) {
  if (replaying) return { mode: "Replay", detail: "Recorded session; live DJ input is ignored.", tone: "replay" };
  const age = (kind) => signals[kind] ? Math.max(0, now - signals[kind]) : Infinity;
  const visualInput = age("rekordbox") <= age("controller") ? "rekordbox" : "controller";
  if (age(visualInput) <= FRESH_INPUT_MS) {
    const kind = visualInput === "rekordbox" ? "Rekordbox deck state" : "Mapped controller input";
    return { mode: "Live input", detail: `${kind} received ${Math.floor(age(visualInput) / 1000)}s ago.`, tone: "ready" };
  }
  if (age("link") <= FRESH_INPUT_MS) return { mode: "Link tempo only", detail: "Beat and tempo are live; deck and cue input is not confirmed.", tone: "warning" };
  if (age("midi") <= FRESH_INPUT_MS) return { mode: "Manual / emulator", detail: "Raw MIDI detected, but no recent mapped deck or cue input.", tone: "warning" };
  if (bridgeState === "running") {
    const latest = Math.max(0, ...Object.values(signals));
    return { mode: "Manual / emulator", detail: latest
      ? `Bridge is running, but DJ input is stale (${Math.floor((now - latest) / 1000)}s).`
      : "Bridge is running; waiting for Rekordbox, Link, or MIDI data.", tone: "warning" };
  }
  return { mode: "Manual / emulator", detail: `Bridge ${bridgeState}; live DJ input is not confirmed.`, tone: "warning" };
}

export function sceneMediaPlan(scene, baseUrl) {
  const localUrls = new Set();
  const remoteUrls = new Set();
  const missingUrls = [];
  for (const clip of scene?.clips ?? []) {
    if (!clip.src) { missingUrls.push(clip.id); continue; }
    try {
      const url = new URL(clip.src, baseUrl);
      if (url.origin === new URL(baseUrl).origin) localUrls.add(url.href);
      else remoteUrls.add(url.href);
    } catch {
      missingUrls.push(clip.id);
    }
  }
  return { localUrls: [...localUrls], remoteUrls: [...remoteUrls], missingUrls };
}
