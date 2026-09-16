import { mkdir, writeFile } from "node:fs/promises";
import { dirname, relative, join, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { SCENES } from "../poc/scene-registry.mjs";

const projectRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const outputDir = join(projectRoot, "scenes", "catalog");
await mkdir(outputDir, { recursive: true });

for (const scene of SCENES) {
  const contract = {
    $schema: "../../schema/scene.schema.json",
    schemaVersion: scene.schemaVersion,
    id: scene.id,
    name: scene.name,
    clips: scene.clips.map((clip) => ({
      id: clip.id,
      label: clip.label,
      file: relative(outputDir, fileURLToPath(clip.src)).split(sep).join("/"),
      durationSeconds: clip.durationSeconds,
      startSeconds: clip.startSeconds ?? 0,
      subjectFocus: clip.subjectFocus,
    })),
    visualLoops: scene.visualLoops,
    defaultLoopId: scene.defaultLoopId,
    cueBindings: scene.cueBindings,
    randomLoop: scene.randomLoop,
    advance: scene.advance,
  };
  await writeFile(join(outputDir, `${scene.id}.scene.json`), `${JSON.stringify(contract, null, 2)}\n`);
  if (scene.id === "metropolis-machine") {
    const rootContract = {
      ...contract,
      $schema: "../schema/scene.schema.json",
      clips: contract.clips.map((clip) => ({ ...clip, file: clip.file.replace(/^\.\.\//, "") })),
    };
    await writeFile(join(projectRoot, "scenes", "metropolis-machine.scene.json"), `${JSON.stringify(rootContract, null, 2)}\n`);
  }
}

console.log(`Exported ${SCENES.length} scene contracts to ${outputDir}`);
