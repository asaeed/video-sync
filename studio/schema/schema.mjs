import { computeDeckOpacities } from "../../poc/mix.mjs";

const fragments = {
  clip: {
    description: "A clip is immutable source media with an optional default in-point. It has no permanent timeline role, loop assignment, or visual filter.",
    value: {
      id: "clip-2",
      label: "Robot reveal I",
      file: "../assets/scenes/metropolis/robot-reveal.mp4",
      durationSeconds: 8,
      startSeconds: 1,
      subjectFocus: { x: 0.458, y: 0.482 },
    },
  },
  loop: {
    description: "A visual loop has an explicit musical length and repeats its event timeline. The normal-playback loop holds Clip 1; cue-selected clips live in their own loops.",
    value: {
      id: "song-default",
      name: "Song default",
      length: { bars: 16 },
      repeat: true,
      events: [
        { at: { bars: 0 }, duration: { bars: 16 }, clipId: "clip-1" },
      ],
    },
  },
  event: {
    description: "Each event chooses a clip, source start, musical placement and duration, plus its appearance. Motion belongs to this clip instance, so the same source can be static elsewhere.",
    value: {
      id: "cue-a-clip-2",
      at: { bars: 0, beats: 0 },
      duration: { bars: 4 },
      clipId: "clip-2",
      source: { startSeconds: 1.5, loop: true, rate: 1 },
      appearance: {
        z: 0,
        opacity: 1,
        blendMode: "normal",
        fit: "cover",
        filters: [],
        motion: {
          type: "ken-burns",
          focusSource: "clip-subject",
          progress: "loop",
          easing: "ease-in-out",
          start: { scale: 1, focus: { x: 0.5, y: 0.5 } },
          end: { scale: 1.14, focus: { x: 0.38, y: 0.42 } },
        },
      },
    },
  },
  loopCue: {
    description: "A hot cue can activate a named visual loop. The loop remains active until another mapping or scene change replaces it.",
    value: {
      input: "hotCueA",
      cue: { type: "loop", length: { bars: 4 } },
      visual: { loopId: "cue-a-loop", retrigger: "audio-loop-cycle" },
    },
  },
  jumpCue: {
    description: "An audio jump cue still selects a persistent visual loop. Here C chooses a layered four-bar loop; its videos repeat from their configured in-points until another cue replaces it.",
    value: {
      input: "hotCueC",
      cue: { type: "jump" },
      visual: { loopId: "cue-c-loop", retrigger: "cue-trigger" },
    },
  },
};

const code = document.querySelector("#schema-code");
const description = document.querySelector("#fragment-description");
const fragmentButtons = [...document.querySelectorAll("[data-fragment]")];

function showFragment(id) {
  const fragment = fragments[id];
  code.textContent = JSON.stringify(fragment.value, null, 2);
  description.textContent = fragment.description;
  fragmentButtons.forEach((button) => button.setAttribute("aria-pressed", String(button.dataset.fragment === id)));
}

fragmentButtons.forEach((button) => button.addEventListener("click", () => showFragment(button.dataset.fragment)));
showFragment("clip");

const crossfader = document.querySelector("#mix-cross");
const levelOne = document.querySelector("#mix-level-1");
const levelTwo = document.querySelector("#mix-level-2");
const loadedOne = document.querySelector("#mix-loaded-1");
const loadedTwo = document.querySelector("#mix-loaded-2");

function renderMix() {
  const cross = Number(crossfader.value) / 100;
  const levels = [Number(levelOne.value) / 100, Number(levelTwo.value) / 100];
  const loaded = [loadedOne.checked, loadedTwo.checked];
  const opacity = computeDeckOpacities([
    { loaded: loaded[0], level: levels[0] },
    { loaded: loaded[1], level: levels[1] },
  ], cross);
  const percentages = opacity.map((value) => Math.round(value * 100));
  document.querySelector("#mix-one").style.width = `${percentages[0]}%`;
  document.querySelector("#mix-two").style.width = `${percentages[1]}%`;
  document.querySelector("#mix-one strong").textContent = `${percentages[0]}%`;
  document.querySelector("#mix-two strong").textContent = `${percentages[1]}%`;
  document.querySelector("#mix-cross-value").textContent = crossfader.value;
  document.querySelector("#mix-level-1-value").textContent = `${levelOne.value}%`;
  document.querySelector("#mix-level-2-value").textContent = `${levelTwo.value}%`;
  const rawOne = loaded[0] ? levels[0] * (1 - cross) : 0;
  const rawTwo = loaded[1] ? levels[1] * cross : 0;
  document.querySelector("#mix-equation").textContent = `raw ${rawOne.toFixed(2)} : ${rawTwo.toFixed(2)}  →  opacity ${percentages[0]}% : ${percentages[1]}%`;
}

[crossfader, levelOne, levelTwo, loadedOne, loadedTwo].forEach((control) => control.addEventListener("input", renderMix));
renderMix();
