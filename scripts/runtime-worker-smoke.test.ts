import { beforeEach, expect, test } from "bun:test";
import {
  chmodSync,
  mkdtempSync,
  mkdirSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { clearRuntimeProbeCache } from "../src/scan/code/worker/runtime-worker";
import {
  assertMissingRuntimeUnavailable,
  smokeRuntimeWorker,
  withReadOnlyTree,
} from "./runtime-worker-smoke";
import { stageRuntimeWorkers } from "./stage-runtime-workers";

const repoRoot = resolve(import.meta.dir, "..");

beforeEach(() => {
  clearRuntimeProbeCache();
});

function withTempRoot(run: (root: string) => void): void {
  const root = mkdtempSync(join(tmpdir(), "docbridge-runtime-smoke-"));
  try {
    run(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test.each(["python", "ruby", "java"] as const)(
  "smokeRuntimeWorker runs the staged %s worker on one file",
  (language) => {
    withTempRoot((root) => {
      // Stage from this checkout's workers without writing into its dist/.
      mkdirSync(join(root, "packages"));
      for (const name of ["python-scanner", "ruby-scanner", "java-scanner"]) {
        symlinkSync(join(repoRoot, "packages", name), join(root, "packages", name));
      }
      stageRuntimeWorkers(root);

      const summary = smokeRuntimeWorker(language, {
        distRoot: join(root, "dist"),
        projectRoot: root,
      });

      expect(summary).toContain(join(root, "dist/workers", language));
    });
  },
);

test("smokeRuntimeWorker rejects a worker whose scan output is not a response", () => {
  withTempRoot((root) => {
    mkdirSync(join(root, "dist/workers/python"), { recursive: true });
    writeFileSync(
      join(root, "dist/workers/python/docbridge_python_scanner.py"),
      [
        "import sys",
        'if sys.argv[1:] == ["--probe"]:',
        '    print(\'{"ok": true, "runtime": "cpython", "version": "3.12.0"}\')',
        "else:",
        '    print("not json")',
        "",
      ].join("\n"),
    );

    expect(() =>
      smokeRuntimeWorker("python", { distRoot: join(root, "dist"), projectRoot: root }),
    ).toThrow("python worker returned no link for src/auth.py#login");
  });
});

test("withReadOnlyTree removes every write bit while it runs and restores the modes after", () => {
  withTempRoot((root) => {
    const tree = join(root, "package");
    mkdirSync(join(tree, "bin"), { recursive: true });
    writeFileSync(join(tree, "bin/scanner"), "");
    chmodSync(join(tree, "bin/scanner"), 0o755);
    writeFileSync(join(tree, "README.md"), "");
    chmodSync(join(tree, "README.md"), 0o644);
    const paths = [tree, join(tree, "bin"), join(tree, "bin/scanner"), join(tree, "README.md")];
    const before = paths.map((path) => statSync(path).mode & 0o7777);

    let during: number[] = [];
    withReadOnlyTree(tree, () => {
      during = paths.map((path) => statSync(path).mode & 0o7777);
    });

    expect(during).toEqual(before.map((mode) => mode & ~0o222));
    expect(paths.map((path) => statSync(path).mode & 0o7777)).toEqual(before);
  });
});

test("withReadOnlyTree restores the modes when the callback throws", () => {
  withTempRoot((root) => {
    writeFileSync(join(root, "file"), "");
    chmodSync(join(root, "file"), 0o644);

    expect(() =>
      withReadOnlyTree(root, () => {
        throw new Error("smoke failed");
      }),
    ).toThrow("smoke failed");
    expect(statSync(join(root, "file")).mode & 0o7777).toBe(0o644);
  });
});

test("assertMissingRuntimeUnavailable passes when a missing configured runtime is unavailable", () => {
  withTempRoot((root) => {
    mkdirSync(join(root, "dist/workers/python"), { recursive: true });
    writeFileSync(join(root, "dist/workers/python/docbridge_python_scanner.py"), "");

    expect(() =>
      assertMissingRuntimeUnavailable({
        distRoot: join(root, "dist"),
        projectRoot: root,
        missingRuntime: join(root, "missing runtime", "python3"),
      }),
    ).not.toThrow();
  });
});
