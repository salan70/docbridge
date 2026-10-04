import { expect, test } from "bun:test";
import { chmodSync, existsSync, readFileSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";

import { makeProject } from "../test-support";

const CLI = resolve(import.meta.dir, "index.ts");

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/** Poll `condition` until it holds; bounded so a broken contract fails instead of hanging. */
async function eventually(condition: () => boolean, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!condition()) {
    if (Date.now() > deadline) {
      throw new Error("condition did not hold in time");
    }
    await new Promise<void>((done) => {
      setTimeout(done, 10);
    });
  }
}

test.skipIf(process.platform === "win32")(
  "a terminated check kills the running worker and the processes it started",
  async () => {
    // A runtime that passes the probe, then starts a child and waits on it.
    const runtime = [
      "#!/bin/sh",
      'dir="$(dirname "$0")"',
      'for arg in "$@"; do last="$arg"; done',
      'if [ "$last" = "--probe" ]; then',
      '  echo \'{"ok": true, "runtime": "cpython", "version": "3.12.0"}\'',
      "  exit 0",
      "fi",
      "sleep 300 &",
      'echo "$$ $!" > "$dir/pids.tmp" && mv "$dir/pids.tmp" "$dir/pids"',
      "wait",
      "",
    ].join("\n");
    const root = makeProject({
      "docbridge.config.json": JSON.stringify({
        include: { code: { python: { patterns: ["src/**/*.py"] } }, docs: ["docs/**/*.md"] },
        scanners: { python: { command: ["./runtime.sh"] } },
      }),
      "src/app.py": "def run():\n    pass\n",
      "runtime.sh": runtime,
    });
    chmodSync(join(root, "runtime.sh"), 0o755);
    const pidFile = join(root, "pids");
    let pids: number[] = [];
    const cli = Bun.spawn(["bun", "run", CLI, "check", "--root", root], {
      stdout: "ignore",
      stderr: "ignore",
    });
    try {
      await eventually(() => existsSync(pidFile), 10_000);
      pids = readFileSync(pidFile, "utf8").trim().split(" ").map(Number);
      expect(pids.every(isAlive)).toBe(true);

      cli.kill("SIGTERM");
      await cli.exited;

      expect(cli.signalCode).toBe("SIGTERM");
      await eventually(() => !pids.some(isAlive), 2_000);
    } finally {
      cli.kill("SIGKILL");
      for (const pid of pids.filter(isAlive)) {
        process.kill(pid, "SIGKILL");
      }
      rmSync(root, { recursive: true, force: true });
    }
  },
);
