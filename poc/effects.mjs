import { positiveModulo } from "./scheduler.mjs";

export const BEAT_FX_CATALOG = Object.freeze([
  { id: "delay", label: "Delay", description: "Beat-stepped frame displacement with a cool trailing wash." },
  { id: "echo", label: "Echo", description: "A receding image pulse that expands and fades each cycle." },
  { id: "low-cut-echo", label: "Low Cut Echo", description: "A darker, high-contrast echo with the visual weight stripped away." },
  { id: "spiral", label: "Spiral", description: "A rotating zoom tunnel that winds into the beat." },
  { id: "helix", label: "Helix", description: "Counter-rotating chromatic shear, like two image strands crossing." },
  { id: "reverb", label: "Reverb", description: "Soft bloom and luminous haze that linger around the frame." },
  { id: "flanger", label: "Flanger", description: "A fast lateral sweep with shifting color interference." },
  { id: "phaser", label: "Phaser", description: "A traveling color phase with a slow opposing rotation." },
  { id: "filter", label: "Filter", description: "The picture narrows into blur and contrast, then opens again." },
  { id: "trans", label: "Trans", description: "A hard rhythmic shutter that gates the picture on the selected beat." },
  { id: "pitch", label: "Pitch", description: "Vertical stretch and chromatic lift rise and fall together." },
  { id: "roll", label: "Roll", description: "Quantized jump cuts repeat the current image in tight visual steps." },
  { id: "mobius-saw", label: "Mobius Saw", description: "A one-way infinite zoom that snaps back at the beat boundary." },
  { id: "mobius-tri", label: "Mobius Tri", description: "An infinite zoom that travels out and back in a triangular cycle." },
]);

export const BEAT_FX_BEATS = Object.freeze([1 / 16, 1 / 8, 1 / 4, 1 / 2, 1, 2, 4, 8, 16]);

export function beatFxById(id) {
  return BEAT_FX_CATALOG.find((effect) => effect.id === id) ?? BEAT_FX_CATALOG[0];
}

export function formatBeatMultiplier(value) {
  if (value >= 1) return `${value} beat${value === 1 ? "" : "s"}`;
  return `1/${Math.round(1 / value)} beat`;
}

export function stepBeatMultiplier(current, direction) {
  const nearest = BEAT_FX_BEATS.reduce((best, value, index) => (
    Math.abs(value - current) < Math.abs(BEAT_FX_BEATS[best] - current) ? index : best
  ), 0);
  return BEAT_FX_BEATS[Math.min(BEAT_FX_BEATS.length - 1, Math.max(0, nearest + Math.sign(direction)))];
}

function bounded(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}

function pct(value) {
  return `${bounded(value, 0, 100).toFixed(1)}%`;
}

function offsetPct(value) {
  return `${value.toFixed(1)}%`;
}

function px(value) {
  return `${value.toFixed(2)}px`;
}

function deg(value) {
  return `${value.toFixed(2)}deg`;
}

export function effectAppliesToDeck(target, deckNumber) {
  return target === "master" || target === `deck${deckNumber}`;
}

export function beatFxFrame(state, beat) {
  const off = {
    active: false,
    filter: "none",
    transform: "none",
    opacity: 1,
    clipPath: "none",
    overlayOpacity: 0,
    overlayBackground: "none",
    overlayBlendMode: "normal",
    overlayTransform: "none",
    overlayFilter: "none",
  };
  if (!state?.enabled || !(state.depth > 0)) return off;

  const effect = beatFxById(state.selected).id;
  const depth = bounded(state.depth, 0, 1);
  const cycleBeats = Math.max(1 / 16, state.beatMultiplier || 1);
  const phase = positiveModulo(beat, cycleBeats) / cycleBeats;
  const sine = Math.sin(phase * Math.PI * 2);
  const triangle = 1 - Math.abs((phase * 2) - 1);
  const pulse = Math.pow(1 - phase, 2);
  const step = Math.floor(phase * 8) / 7;
  const frame = { ...off, active: true };

  switch (effect) {
    case "delay": {
      const offset = (Math.floor(phase * 4) - 1.5) * 7 * depth;
      frame.transform = `translate(${px(offset)}, ${px(-offset * 0.45)}) scale(${(1 + pulse * depth * 0.025).toFixed(4)})`;
      frame.filter = `saturate(${(1 + depth * 0.45).toFixed(3)}) contrast(${(1 + pulse * depth * 0.18).toFixed(3)})`;
      frame.overlayOpacity = depth * pulse * 0.36;
      frame.overlayBackground = "repeating-linear-gradient(90deg, rgba(50,210,255,.75) 0 2px, transparent 2px 8%)";
      frame.overlayBlendMode = "screen";
      break;
    }
    case "echo":
      frame.transform = `scale(${(1 + phase * depth * 0.13).toFixed(4)})`;
      frame.filter = `brightness(${(1 + pulse * depth * 0.25).toFixed(3)}) saturate(${(1 + depth * 0.25).toFixed(3)})`;
      frame.overlayOpacity = depth * pulse * 0.42;
      frame.overlayBackground = "repeating-radial-gradient(circle at center, transparent 0 12%, rgba(190,230,255,.7) 13% 14%, transparent 15% 25%)";
      frame.overlayBlendMode = "screen";
      frame.overlayTransform = `scale(${(0.8 + phase * 0.55).toFixed(3)})`;
      break;
    case "low-cut-echo":
      frame.transform = `translateY(${px(-phase * depth * 8)}) scale(${(1 + phase * depth * 0.09).toFixed(4)})`;
      frame.filter = `brightness(${(1 - depth * 0.32).toFixed(3)}) grayscale(${(depth * 0.62).toFixed(3)}) contrast(${(1 + depth * 0.8).toFixed(3)}) sepia(${(depth * 0.32).toFixed(3)})`;
      frame.overlayOpacity = depth * pulse * 0.38;
      frame.overlayBackground = "linear-gradient(0deg, rgba(255,118,30,.45), transparent 60%), repeating-linear-gradient(0deg, rgba(255,220,170,.3) 0 1px, transparent 1px 6px)";
      frame.overlayBlendMode = "screen";
      break;
    case "spiral":
      frame.transform = `scale(${(1 + triangle * depth * 0.18).toFixed(4)}) rotate(${deg((phase - 0.5) * depth * 28)})`;
      frame.filter = `contrast(${(1 + depth * 0.35).toFixed(3)}) saturate(${(1 + depth * 0.65).toFixed(3)})`;
      frame.overlayOpacity = depth * 0.35;
      frame.overlayBackground = "repeating-conic-gradient(from 0deg, transparent 0deg 18deg, rgba(180,90,255,.45) 20deg 23deg, transparent 25deg 45deg)";
      frame.overlayBlendMode = "screen";
      frame.overlayTransform = `rotate(${deg(phase * 180)}) scale(${(1 + pulse * 0.35).toFixed(3)})`;
      break;
    case "helix":
      frame.transform = `perspective(900px) rotateY(${deg(sine * depth * 12)}) rotateZ(${deg(-sine * depth * 3)}) skewY(${deg(sine * depth * 4)}) scale(${(1 + depth * 0.05).toFixed(3)})`;
      frame.filter = `hue-rotate(${deg(sine * depth * 90)}) saturate(${(1 + depth).toFixed(3)})`;
      frame.overlayOpacity = depth * 0.45;
      frame.overlayBackground = "repeating-linear-gradient(115deg, rgba(255,30,150,.7) 0 2px, transparent 2px 8%, rgba(0,210,255,.6) 8% 9%, transparent 9% 16%)";
      frame.overlayBlendMode = "screen";
      frame.overlayTransform = `translateX(${offsetPct(sine * 8)})`;
      break;
    case "reverb":
      frame.transform = `scale(${(1 + triangle * depth * 0.035).toFixed(4)})`;
      frame.filter = `blur(${px(depth * (1.5 + triangle * 5))}) brightness(${(1 + depth * 0.32).toFixed(3)}) saturate(${(1 - depth * 0.2).toFixed(3)})`;
      frame.overlayOpacity = depth * (0.16 + triangle * 0.28);
      frame.overlayBackground = "radial-gradient(ellipse at center, rgba(255,255,255,.55), rgba(110,150,255,.2) 38%, transparent 72%)";
      frame.overlayBlendMode = "screen";
      frame.overlayFilter = `blur(${px(8 + depth * 26)})`;
      break;
    case "flanger":
      frame.transform = `translateX(${px(sine * depth * 14)}) scaleX(${(1 + sine * depth * 0.025).toFixed(4)})`;
      frame.filter = `hue-rotate(${deg(sine * depth * 55)}) contrast(${(1 + depth * 0.4).toFixed(3)}) saturate(${(1 + depth * 0.8).toFixed(3)})`;
      frame.overlayOpacity = depth * (0.25 + Math.abs(sine) * 0.3);
      frame.overlayBackground = "repeating-linear-gradient(0deg, rgba(0,220,255,.55) 0 1px, transparent 1px 4px)";
      frame.overlayBlendMode = "difference";
      frame.overlayTransform = `translateY(${px(sine * 16)})`;
      break;
    case "phaser":
      frame.transform = `scale(${(1 + depth * 0.035).toFixed(3)}) rotate(${deg(sine * depth * 2.5)})`;
      frame.filter = `hue-rotate(${deg(phase * 360 * depth)}) saturate(${(1 + depth * 1.2).toFixed(3)}) contrast(${(1 + triangle * depth * 0.3).toFixed(3)})`;
      frame.overlayOpacity = depth * 0.34;
      frame.overlayBackground = "conic-gradient(from 90deg, rgba(255,0,145,.6), transparent 24%, rgba(0,230,255,.55) 48%, transparent 72%, rgba(255,220,0,.5))";
      frame.overlayBlendMode = "color-dodge";
      frame.overlayTransform = `rotate(${deg(-phase * 360)})`;
      break;
    case "filter":
      frame.transform = `scale(${(1 + triangle * depth * 0.04).toFixed(4)})`;
      frame.filter = `blur(${px((1 - triangle) * depth * 9)}) grayscale(${((1 - triangle) * depth * 0.7).toFixed(3)}) contrast(${(1 + triangle * depth * 1.25).toFixed(3)}) brightness(${(0.75 + triangle * depth * 0.45).toFixed(3)})`;
      frame.overlayOpacity = depth * (1 - triangle) * 0.42;
      frame.overlayBackground = "linear-gradient(90deg, rgba(0,0,0,.8), transparent 35% 65%, rgba(0,0,0,.8))";
      frame.overlayBlendMode = "multiply";
      break;
    case "trans": {
      const open = positiveModulo(beat, cycleBeats) < cycleBeats * (0.18 + (1 - depth) * 0.62);
      frame.opacity = open ? 1 : Math.max(0.015, 0.18 * (1 - depth));
      frame.filter = `contrast(${(1 + depth * 0.8).toFixed(3)})`;
      frame.overlayOpacity = open ? 0 : 0.88 * depth;
      frame.overlayBackground = "#000";
      frame.overlayBlendMode = "normal";
      break;
    }
    case "pitch":
      frame.transform = `translateY(${px(-sine * depth * 18)}) scaleY(${(1 + sine * depth * 0.16).toFixed(4)}) scaleX(${(1 - sine * depth * 0.045).toFixed(4)})`;
      frame.filter = `hue-rotate(${deg(sine * depth * 105)}) saturate(${(1 + depth * 0.8).toFixed(3)})`;
      frame.overlayOpacity = depth * Math.abs(sine) * 0.28;
      frame.overlayBackground = sine >= 0 ? "linear-gradient(0deg, transparent, rgba(255,50,170,.75))" : "linear-gradient(180deg, transparent, rgba(50,180,255,.75))";
      frame.overlayBlendMode = "screen";
      break;
    case "roll": {
      const jump = Math.floor(phase * 8);
      const direction = jump % 2 ? 1 : -1;
      frame.transform = `translate(${px(direction * depth * (3 + jump * 1.8))}, ${px((jump - 3.5) * depth * 2)}) scale(${(1 + (jump % 3) * depth * 0.018).toFixed(4)})`;
      frame.filter = `contrast(${(1 + depth * 0.75).toFixed(3)}) saturate(${(1 + step * depth).toFixed(3)})`;
      frame.clipPath = `inset(${pct((jump % 4) * depth * 2)} 0 ${pct(((jump + 2) % 4) * depth * 2)} 0)`;
      frame.overlayOpacity = depth * 0.28;
      frame.overlayBackground = "repeating-linear-gradient(90deg, rgba(255,255,255,.5) 0 1px, transparent 1px 12.5%)";
      frame.overlayBlendMode = "difference";
      break;
    }
    case "mobius-saw":
      frame.transform = `scale(${(0.88 + phase * depth * 0.38).toFixed(4)}) rotate(${deg((phase - 0.5) * depth * 8)}) translateX(${px((phase - 0.5) * depth * 14)})`;
      frame.filter = `contrast(${(1 + depth * 0.55).toFixed(3)}) hue-rotate(${deg(phase * depth * 70)})`;
      frame.overlayOpacity = depth * 0.32;
      frame.overlayBackground = "repeating-linear-gradient(135deg, transparent 0 10%, rgba(255,90,30,.55) 10.5% 11.5%, transparent 12% 20%)";
      frame.overlayBlendMode = "screen";
      frame.overlayTransform = `translate(${offsetPct(-phase * 20)}, ${offsetPct(phase * 20)})`;
      break;
    case "mobius-tri":
      frame.transform = `scale(${(0.88 + triangle * depth * 0.38).toFixed(4)}) rotate(${deg((triangle - 0.5) * depth * 9)})`;
      frame.filter = `contrast(${(1 + triangle * depth * 0.65).toFixed(3)}) hue-rotate(${deg((triangle - 0.5) * depth * 120)})`;
      frame.overlayOpacity = depth * 0.32;
      frame.overlayBackground = "repeating-linear-gradient(45deg, transparent 0 9%, rgba(75,230,255,.55) 9.5% 10.5%, transparent 11% 18%)";
      frame.overlayBlendMode = "screen";
      frame.overlayTransform = `scale(${(0.8 + triangle * 0.45).toFixed(3)}) rotate(${deg((phase < 0.5 ? 1 : -1) * triangle * 20)})`;
      break;
  }
  return frame;
}
