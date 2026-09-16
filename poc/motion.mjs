const clamp = (value, minimum, maximum) => Math.min(maximum, Math.max(minimum, value));
const lerp = (from, to, progress) => from + (to - from) * progress;

function normalizeKeyframe(keyframe = {}, fallback = {}) {
  const fallbackFocus = fallback.focus ?? { x: 0.5, y: 0.5 };
  return {
    scale: Math.max(1, Number(keyframe.scale ?? fallback.scale ?? 1)),
    focus: {
      x: clamp(Number(keyframe.focus?.x ?? fallbackFocus.x), 0, 1),
      y: clamp(Number(keyframe.focus?.y ?? fallbackFocus.y), 0, 1),
    },
  };
}

function easedProgress(curve, progress) {
  const normalized = clamp(Number(progress) || 0, 0, 1);
  if (curve === "linear") return normalized;
  return normalized * normalized * (3 - 2 * normalized);
}

export function kenBurnsFrame(motion, progress) {
  if (motion?.type !== "ken-burns") {
    return { active: false, scale: 1, translateXPercent: 0, translateYPercent: 0, transform: "none" };
  }

  const start = normalizeKeyframe(motion.start);
  const end = normalizeKeyframe(motion.end, start);
  const time = easedProgress(motion.easing, progress);
  const scale = lerp(start.scale, end.scale, time);
  const focusX = lerp(start.focus.x, end.focus.x, time);
  const focusY = lerp(start.focus.y, end.focus.y, time);

  // Center the focus point while clamping translation to the overscan created
  // by the zoom. That guarantees the motion never exposes an empty edge.
  const maximumShift = Math.max(0, (scale - 1) / 2);
  const translateX = clamp((0.5 - focusX) * scale, -maximumShift, maximumShift);
  const translateY = clamp((0.5 - focusY) * scale, -maximumShift, maximumShift);
  const translateXPercent = translateX * 100;
  const translateYPercent = translateY * 100;
  const transform = `translate3d(${translateXPercent.toFixed(3)}%, ${translateYPercent.toFixed(3)}%, 0) scale(${scale.toFixed(4)})`;

  return { active: true, scale, translateXPercent, translateYPercent, transform };
}

export function combineTransforms(...transforms) {
  return transforms.filter((value) => value && value !== "none").join(" ") || "none";
}

export function motionWithClipSubject(motion, subjectFocus) {
  if (motion?.focusSource !== "clip-subject" || !subjectFocus) return motion;
  const subjectKeyframe = motion.start.scale > motion.end.scale ? "start" : "end";
  return {
    ...motion,
    [subjectKeyframe]: {
      ...motion[subjectKeyframe],
      focus: { x: subjectFocus.x, y: subjectFocus.y },
    },
  };
}
