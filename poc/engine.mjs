import { beatAt, nowEpochMs, phrasePosition } from "./scheduler.mjs";
import { createPhraseClock, phraseBeatAt } from "./phrase-transport.mjs";
import { filtersToCss, resolveVisualLoop } from "./sequencer.mjs";
import { sceneById } from "./scene-registry.mjs";
import { normalizeClipOrder, remapSceneClipId } from "./scene-variation.mjs";
import { beatFxFrame, effectAppliesToDeck } from "./effects.mjs";
import { combineTransforms, kenBurnsFrame, motionWithClipSubject } from "./motion.mjs";
import { mediaTimeForMusicalOffset } from "./media-time.mjs";

function createVideo(src, className, onEnded) {
  const video = document.createElement("video");
  video.className = className;
  video.hidden = true;
  video.src = src;
  video.muted = true;
  video.playsInline = true;
  video.preload = "auto";
  video.disablePictureInPicture = true;
  video.addEventListener("ended", () => onEnded(video));
  return video;
}

function seekVideo(video, source, elapsedBeats, bpm, token) {
  video.dataset.seekToken = token;
  const seek = () => {
    if (video.dataset.seekToken !== token) return;
    video.currentTime = mediaTimeForMusicalOffset(source, elapsedBeats, bpm, video.duration);
  };
  if (video.readyState >= 1) seek();
  else video.addEventListener("loadedmetadata", seek, { once: true });
}

class DeckRuntime {
  constructor(deckNumber, stage) {
    this.deckNumber = deckNumber;
    this.container = document.createElement("div");
    this.container.className = `deck-visual-layer deck-visual-${deckNumber}`;
    this.container.dataset.deckVisual = String(deckNumber);
    this.container.style.opacity = "0";
    stage.append(this.container);
    this.scene = null;
    this.runtimeScene = null;
    this.effectOverlay = null;
    this.eventNodes = new Map();
    this.loadToken = 0;
    this.loadedGeneration = -1;
    this.state = {
      loaded: false,
      playing: false,
      started: false,
      sceneId: "metropolis-machine",
      generation: 0,
      clipOrder: [],
      randomLoop: null,
      activeLoopId: "song-default",
      loopAnchorBeat: 0,
      loopGeneration: 0,
      opacity: 0,
      beatFx: { selected: "delay", enabled: false, target: "master", depth: 0.5, beatMultiplier: 1 },
      linkClock: { bpm: 100, playing: true, anchorBeat: 0, anchorEpochMs: nowEpochMs() },
      clock: { bpm: 100, playing: false, anchorBeat: 0, anchorEpochMs: nowEpochMs() },
    };
  }

  async applyState(nextState) {
    const previousPlaying = this.state.playing;
    this.state = { ...this.state, ...nextState, clock: { ...nextState.clock }, linkClock: { ...nextState.linkClock } };
    this.container.style.opacity = String(this.state.opacity ?? 0);
    this.container.hidden = !this.state.loaded;

    if (!this.state.loaded) {
      this.setTransport(false);
      return;
    }

    if (this.scene?.id !== this.state.sceneId || this.loadedGeneration !== this.state.generation) {
      await this.loadScene(this.state.sceneId, this.state.generation);
    } else {
      // Transport and cue changes should paint immediately instead of waiting for
      // the next animation frame, which may be throttled in a background window.
      this.render(nowEpochMs());
    }
    if (previousPlaying !== this.state.playing) this.setTransport(this.state.playing);
  }

  async loadScene(sceneId, generation) {
    const token = ++this.loadToken;
    this.scene = sceneById(sceneId);
    this.state.clipOrder = normalizeClipOrder(this.scene, this.state.clipOrder);
    this.runtimeScene = this.state.randomLoop
      ? { ...this.scene, visualLoops: [...this.scene.visualLoops, this.state.randomLoop] }
      : this.scene;
    this.loadedGeneration = generation;
    this.eventNodes.clear();
    this.container.replaceChildren();

    for (const visualLoop of this.runtimeScene.visualLoops) {
      for (const event of visualLoop.events) {
        const mappedClipId = remapSceneClipId(this.scene, this.state.clipOrder, event.clipId);
        const clip = this.scene.clips.find((candidate) => candidate.id === mappedClipId);
        if (!clip) continue;
        const key = `${visualLoop.id}:${event.id}`;
        const video = createVideo(clip.src, "visual-video visual-loop-event", (endedVideo) => this.restartInPointLoop(endedVideo));
        video.dataset.nodeKey = key;
        video.dataset.eventId = event.id;
        video.dataset.clipId = clip.id;
        video.dataset.subjectFocusX = String(clip.subjectFocus?.x ?? 0.5);
        video.dataset.subjectFocusY = String(clip.subjectFocus?.y ?? 0.44);
        this.eventNodes.set(key, video);
        this.container.append(video);
      }
    }
    this.effectOverlay = document.createElement("div");
    this.effectOverlay.className = "beat-fx-overlay";
    this.effectOverlay.setAttribute("aria-hidden", "true");
    this.container.append(this.effectOverlay);

    if (token !== this.loadToken) return;
    this.render(nowEpochMs());
    this.setTransport(this.state.playing);
  }

  restartInPointLoop(video) {
    if (video.dataset.loopFromInPoint !== "true" || !video.classList.contains("is-visible")) return;
    const startSeconds = Number(video.dataset.loopStartSeconds) || 0;
    const lastFrame = Number.isFinite(video.duration) ? Math.max(0, video.duration - 0.04) : startSeconds;
    video.currentTime = Math.min(startSeconds, lastFrame);
    if (this.state.playing) video.play().catch(() => {});
  }

  setTransport(playing) {
    for (const video of this.videos()) {
      if (playing && video.classList.contains("is-visible")) {
        if (video.paused) video.play().catch(() => {});
      } else {
        video.pause();
      }
    }

  }

  render(epochMs) {
    if (!this.state.loaded || !this.scene) return { active: 0, dropped: 0 };
    const beat = beatAt(this.state.clock, epochMs);
    const instances = resolveVisualLoop(this.runtimeScene, this.state.activeLoopId, beat, {
      started: this.state.started,
      loopAnchorBeat: this.state.loopAnchorBeat,
      loopGeneration: this.state.loopGeneration,
    });
    const visibleNodes = new Set();

    for (const video of this.eventNodes.values()) {
      video.classList.remove("is-visible");
      video.hidden = true;
    }
    for (const instance of instances) {
      const node = this.showInstance(instance);
      if (node) visibleNodes.add(node);
    }

    for (const video of this.videos()) {
      if (!visibleNodes.has(video)) {
        video.pause();
      } else if (this.state.playing && video.paused) {
        video.play().catch(() => {});
      } else if (!this.state.playing) {
        video.pause();
      }
    }

    this.applyBeatFx(beatAt(this.state.linkClock, epochMs), visibleNodes);

    const activeNodes = [...visibleNodes];
    const dropped = activeNodes.reduce((total, video) => {
      return total + (video.getVideoPlaybackQuality?.().droppedVideoFrames ?? 0);
    }, 0);
    return { active: activeNodes.length, dropped, beat };
  }

  showInstance(instance) {
    const node = this.eventNodes.get(instance.nodeKey);
    if (!node) return null;
    node.hidden = false;
    if (node.dataset.occurrenceKey !== instance.occurrenceKey) {
      node.dataset.occurrenceKey = instance.occurrenceKey;
      const loopsFromInPoint = Boolean(instance.source.loop) && instance.source.startSeconds > 0;
      node.loop = Boolean(instance.source.loop) && !loopsFromInPoint;
      node.dataset.loopFromInPoint = String(loopsFromInPoint);
      node.dataset.loopStartSeconds = String(instance.source.startSeconds);
      node.playbackRate = instance.source.rate ?? 1;
      seekVideo(node, instance.source, instance.elapsedBeats, this.state.clock.bpm, instance.occurrenceKey);
    }
    node.classList.add("is-visible");
    node.style.zIndex = String(instance.z);
    node.style.opacity = String(instance.opacity);
    node.dataset.baseOpacity = String(instance.opacity);
    node.dataset.baseFilter = filtersToCss(instance.filters);
    node.style.filter = node.dataset.baseFilter;
    node.style.mixBlendMode = instance.blendMode;
    node.dataset.baseBlendMode = instance.blendMode;
    node.style.objectFit = instance.fit;
    const motionProgress = instance.motion?.progress === "loop" ? instance.loopProgress : instance.progress;
    const motion = motionWithClipSubject(instance.motion, {
      x: Number(node.dataset.subjectFocusX),
      y: Number(node.dataset.subjectFocusY),
    });
    node.dataset.baseTransform = kenBurnsFrame(motion, motionProgress).transform;
    return node;
  }

  applyBeatFx(beat, visibleNodes) {
    const frame = beatFxFrame(this.state.beatFx, beat);
    for (const video of visibleNodes) {
      const baseFilter = video.dataset.baseFilter ?? "none";
      video.style.filter = [baseFilter, frame.filter].filter((value) => value && value !== "none").join(" ") || "none";
      video.style.transform = combineTransforms(video.dataset.baseTransform, frame.transform);
      video.style.opacity = String((Number(video.dataset.baseOpacity) || 0) * frame.opacity);
      video.style.clipPath = frame.clipPath;
      video.style.mixBlendMode = video.dataset.baseBlendMode ?? "normal";
    }

    if (!this.effectOverlay) return;
    this.effectOverlay.hidden = !frame.active || frame.overlayOpacity <= 0;
    this.effectOverlay.style.opacity = String(frame.overlayOpacity);
    this.effectOverlay.style.background = frame.overlayBackground;
    this.effectOverlay.style.mixBlendMode = frame.overlayBlendMode;
    this.effectOverlay.style.transform = frame.overlayTransform;
    this.effectOverlay.style.filter = frame.overlayFilter;
  }

  videos() {
    return [...this.container.querySelectorAll("video")];
  }
}

export class VisualEngine {
  constructor(stage, onMetrics = () => {}) {
    this.stage = stage;
    this.onMetrics = onMetrics;
    this.linkClock = { bpm: 100, playing: true, anchorBeat: 0, anchorEpochMs: nowEpochMs() };
    this.phraseClock = createPhraseClock(100, nowEpochMs());
    this.frameTimes = [];
    this.lastFrameAt = 0;
    this.running = true;
    this.decks = [new DeckRuntime(1, stage), new DeckRuntime(2, stage)];
    requestAnimationFrame((timestamp) => this.tick(timestamp));
  }

  applySnapshot(snapshot) {
    if (snapshot.linkClock) this.linkClock = { ...snapshot.linkClock };
    if (snapshot.phraseClock) this.phraseClock = { ...snapshot.phraseClock };
    snapshot.decks?.forEach((deck, index) => {
      const beatFx = snapshot.effects?.beatFx ?? {};
      this.decks[index]?.applyState({
        ...deck,
        opacity: snapshot.opacities?.[index] ?? 0,
        linkClock: this.linkClock,
        beatFx: {
          ...beatFx,
          enabled: Boolean(beatFx.enabled) && effectAppliesToDeck(beatFx.target, index + 1),
        },
      });
    });
  }

  tick(timestamp) {
    if (!this.running) return;
    const epochMs = performance.timeOrigin + timestamp;
    const deckMetrics = this.decks.map((deck) => deck.render(epochMs));
    if (this.lastFrameAt) this.frameTimes.push(timestamp - this.lastFrameAt);
    this.lastFrameAt = timestamp;
    if (this.frameTimes.length > 240) this.frameTimes.shift();

    const phraseBeat = phraseBeatAt(this.phraseClock, epochMs);
    const phrase = phrasePosition(phraseBeat, 16);
    this.onMetrics({
      phraseActive: this.phraseClock.playing,
      phraseBar: phrase.bar,
      phraseBarProgress: phrase.barProgress,
      phraseProgress: phrase.phraseProgress,
      phraseCycle: Math.floor(phraseBeat / 64),
      frameIntervalMs: this.percentile(this.frameTimes, 0.95),
      droppedFrames: deckMetrics.reduce((total, deck) => total + deck.dropped, 0),
      activeVideos: deckMetrics.reduce((total, deck) => total + deck.active, 0),
    });
    requestAnimationFrame((nextTimestamp) => this.tick(nextTimestamp));
  }

  percentile(values, percentile) {
    if (!values.length) return 0;
    const sorted = [...values].sort((a, b) => a - b);
    return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * percentile))];
  }
}
