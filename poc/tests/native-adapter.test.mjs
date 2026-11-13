import test from "node:test";
import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const run = promisify(execFile);

test("macOS adapter discovers applications launched after startup and after relaunch", {
  skip: process.platform !== "darwin",
  timeout: 30_000,
}, async () => {
  const temporary = await mkdtemp(join(tmpdir(), "video-sync-adapter-test-"));
  try {
    const executable = join(temporary, "lifecycle-test");
    const source = fileURLToPath(new URL("../../bridge/tests/rekordbox_macos_lifecycle.m", import.meta.url));
    await run("clang", ["-fblocks", "-Wno-deprecated-declarations", "-framework", "AppKit",
      "-framework", "ApplicationServices", "-framework", "Foundation", source, "-o", executable]);
    await run(executable, [temporary], { timeout: 20_000 });
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});
