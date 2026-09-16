import { spawnSync } from "node:child_process";
import { stat } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { PLAYABLE_SCENES, SCENES } from "../poc/scene-registry.mjs";

const errors = [];

for (const scene of SCENES) {
  if (scene.clips.length < 8 || scene.clips.length > 16) errors.push(`${scene.id}: expected 8 to 16 clips`);
  if (!scene.visualLoops.some((loop) => loop.id === scene.defaultLoopId)) errors.push(`${scene.id}: missing default loop`);
  if (!scene.randomLoop || scene.randomLoop.candidateClipIds?.length < 2) errors.push(`${scene.id}: missing random-loop configuration`);
  const clipIds = new Set(scene.clips.map((clip) => clip.id));
  if (scene.randomLoop?.candidateClipIds?.some((clipId) => !clipIds.has(clipId))) errors.push(`${scene.id}: random loop references an unknown clip`);
  for (const [index, clip] of scene.clips.entries()) {
    if (clip.id !== `clip-${index + 1}`) errors.push(`${scene.id}: non-sequential clip id ${clip.id}`);
    if (!scene.visualLoops.some((loop) => loop.events.some((event) => event.clipId === clip.id))) {
      errors.push(`${scene.id}: ${clip.id} has no visual loop`);
    }
    if (!(clip.startSeconds >= 0 && clip.startSeconds < clip.durationSeconds)) errors.push(`${scene.id}: ${clip.id} has an invalid default start time`);
    if (scene.availability === "ready" && !(clip.subjectFocus?.x >= 0 && clip.subjectFocus.x <= 1 && clip.subjectFocus?.y >= 0 && clip.subjectFocus.y <= 1)) {
      errors.push(`${scene.id}: ${clip.id} is missing a normalized subject focus`);
    }
  }
}

const readyPaths = new Set();
for (const scene of PLAYABLE_SCENES) {
  for (const clip of scene.clips) {
    const mediaPath = fileURLToPath(clip.src);
    try {
      const info = await stat(mediaPath);
      if (info.size < 1024) errors.push(`${scene.id}: ${clip.id} is empty`);
      readyPaths.add(mediaPath);
    } catch {
      errors.push(`${scene.id}: ${clip.id} media is missing`);
    }
  }
}

for (const mediaPath of readyPaths) {
  const probe = spawnSync("ffprobe", [
    "-v", "error", "-show_entries", "stream=codec_type,width,height:format=duration", "-of", "json", mediaPath,
  ], { encoding: "utf8" });
  if (probe.status !== 0) {
    errors.push(`${mediaPath}: ffprobe failed`);
    continue;
  }
  const detail = JSON.parse(probe.stdout);
  const video = detail.streams?.find((stream) => stream.codec_type === "video");
  const duration = Number(detail.format?.duration);
  if (!(video?.width > 0 && video?.height > 0)) errors.push(`${mediaPath}: missing video dimensions`);
  if (!(duration >= 5)) errors.push(`${mediaPath}: duration is shorter than five seconds`);
}

if (errors.length) {
  console.error(errors.join("\n"));
  process.exit(1);
}

const readyClipCount = PLAYABLE_SCENES.reduce((total, scene) => total + scene.clips.length, 0);
console.log(`${SCENES.length} scenes valid · ${PLAYABLE_SCENES.length} playable · ${readyClipCount} ready clip definitions · ${readyPaths.size} media files probed`);
