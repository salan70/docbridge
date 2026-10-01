import { expect, test } from "bun:test";
import { existsSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { runtimeWorkerEntrypoints } from "../src/scan/code/worker/runtime-worker";
import { stageRuntimeWorkers } from "./stage-runtime-workers";

const WORKER_SOURCES = [
  "packages/python-scanner/docbridge_python_scanner.py",
  "packages/python-scanner/docbridge_python_scanner/__init__.py",
  "packages/python-scanner/docbridge_python_scanner/protocol.py",
  "packages/python-scanner/tests/test_protocol.py",
  "packages/ruby-scanner/bin/docbridge-ruby-scanner",
  "packages/ruby-scanner/lib/docbridge_ruby_scanner/cli.rb",
  "packages/ruby-scanner/test/run.rb",
  "packages/java-scanner/build/docbridge-java-scanner.jar",
];

function withRoot(files: string[], run: (root: string) => void): void {
  const root = mkdtempSync(join(tmpdir(), "docbridge-stage-workers-"));
  try {
    for (const relPath of files) {
      mkdirSync(join(root, relPath, ".."), { recursive: true });
      writeFileSync(join(root, relPath), "");
    }
    run(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test("stageRuntimeWorkers puts every entrypoint where dist resolution looks for it", () => {
  withRoot(WORKER_SOURCES, (root) => {
    stageRuntimeWorkers(root);

    for (const { dist } of Object.values(runtimeWorkerEntrypoints())) {
      expect(existsSync(join(root, "dist", dist)), dist).toBe(true);
    }
  });
});

test("stageRuntimeWorkers copies the worker modules but not tests or bytecode", () => {
  withRoot(
    [
      ...WORKER_SOURCES,
      "packages/python-scanner/docbridge_python_scanner/__pycache__/protocol.cpython-313.pyc",
    ],
    (root) => {
      stageRuntimeWorkers(root);

      expect(
        existsSync(join(root, "dist/workers/python/docbridge_python_scanner/protocol.py")),
      ).toBe(true);
      expect(existsSync(join(root, "dist/workers/ruby/lib/docbridge_ruby_scanner/cli.rb"))).toBe(
        true,
      );
      expect(
        existsSync(join(root, "dist/workers/python/docbridge_python_scanner/__pycache__")),
      ).toBe(false);
      expect(existsSync(join(root, "dist/workers/python/tests"))).toBe(false);
      expect(existsSync(join(root, "dist/workers/ruby/test"))).toBe(false);
    },
  );
});

test("stageRuntimeWorkers replaces workers staged by an earlier build", () => {
  withRoot([...WORKER_SOURCES, "dist/workers/python/stale.py"], (root) => {
    stageRuntimeWorkers(root);

    expect(existsSync(join(root, "dist/workers/python/stale.py"))).toBe(false);
  });
});

test("stageRuntimeWorkers names the JAR build when the Java worker is not built", () => {
  withRoot(
    WORKER_SOURCES.filter((path) => !path.endsWith(".jar")),
    (root) => {
      expect(() => stageRuntimeWorkers(root)).toThrow(
        "packages/java-scanner/build/docbridge-java-scanner.jar is missing; run `just build-java-scanner` first.",
      );
    },
  );
});
