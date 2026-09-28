import { expect, test } from "bun:test";
import {
  accessSync,
  chmodSync,
  constants,
  mkdtempSync,
  mkdirSync,
  realpathSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { pathToFileURL } from "node:url";

import { resolveScannerWorkerCommand, scannerRootsFromModuleUrl } from "./scanner-executable";

function withProject(files: Record<string, string>, run: (root: string) => void): void {
  const root = mkdtempSync(join(tmpdir(), "docbridge-lang-"));
  try {
    for (const [relPath, content] of Object.entries(files)) {
      const abs = join(root, relPath);
      mkdirSync(join(abs, ".."), { recursive: true });
      writeFileSync(abs, content);
    }
    run(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test("resolveScannerWorkerCommand selects the dist scanner for a supported platform", () => {
  withProject({ "dist/bin/darwin-arm64/docbridge-swift-scanner": "#!/bin/sh\n" }, (root) => {
    const scannerPath = join(root, "dist/bin/darwin-arm64/docbridge-swift-scanner");
    chmodSync(scannerPath, 0o755);

    const result = resolveScannerWorkerCommand("swift", {
      platformKey: "darwin-arm64",
      sourceRoot: join(root, "missing-source"),
      distRoot: join(root, "dist"),
    });

    expect(result).toEqual({ ok: true, command: [scannerPath] });
  });
});

test("resolveScannerWorkerCommand selects source scanners on unsupported dist platforms", () => {
  withProject(
    {
      "packages/swift-scanner/.build/release/docbridge-swift-scanner": "#!/bin/sh\n",
    },
    (root) => {
      const scannerPath = join(
        root,
        "packages/swift-scanner/.build/release/docbridge-swift-scanner",
      );
      chmodSync(scannerPath, 0o755);

      const result = resolveScannerWorkerCommand("swift", {
        platformKey: "darwin-x64",
        sourceRoot: root,
        distRoot: join(root, "missing-dist"),
      });

      expect(result).toEqual({ ok: true, command: [scannerPath] });
    },
  );
});

test("scannerRootsFromModuleUrl resolves through a symlinked bin shim", () => {
  // npm installs the CLI as `node_modules/.bin/<cli>`, a relative symlink to
  // the packaged `dist/index.js`. The dist scanner binaries sit next to that
  // real file, so the dist root must follow the symlink to its target — Bun
  // resolves this on macOS but not on Linux, where the bug surfaced.
  withProject({ "pkg/dist/index.js": "// cli\n" }, (root) => {
    const realCli = join(root, "pkg/dist/index.js");
    const binDir = join(root, "node_modules/.bin");
    mkdirSync(binDir, { recursive: true });
    const shim = join(binDir, "docbridge");
    symlinkSync(relative(binDir, realCli), shim);

    const { distRoot, sourceRoot } = scannerRootsFromModuleUrl(pathToFileURL(shim).href);

    // Compare against the canonical root: realpath also normalizes symlinks in
    // the temp path itself (e.g. macOS /var -> /private/var).
    const realRoot = realpathSync(root);
    expect(distRoot).toBe(join(realRoot, "pkg/dist"));
    expect(sourceRoot).toBe(realRoot);
  });
});

// Consumers install DocBridge with an installer that drops the executable bit
// on the bundled scanner binaries, so the CLI must restore it on its own
// artifacts instead of requiring a caller-side `chmod +x`. See issue #74.
test("resolveScannerWorkerCommand restores the executable bit on a bundled dist scanner", () => {
  withProject({ "dist/bin/linux-x64/docbridge_dart_scanner": "#!/bin/sh\n" }, (root) => {
    const scannerPath = join(root, "dist/bin/linux-x64/docbridge_dart_scanner");
    chmodSync(scannerPath, 0o644);

    const result = resolveScannerWorkerCommand("dart", {
      platformKey: "linux-x64",
      sourceRoot: join(root, "missing-source"),
      distRoot: join(root, "dist"),
    });

    expect(result).toEqual({ ok: true, command: [scannerPath] });
    expect(statSync(scannerPath).mode & 0o111).not.toBe(0);
  });
});

test("resolveScannerWorkerCommand restores the executable bit on a source-checkout scanner", () => {
  withProject(
    { "packages/swift-scanner/.build/release/docbridge-swift-scanner": "#!/bin/sh\n" },
    (root) => {
      const scannerPath = join(
        root,
        "packages/swift-scanner/.build/release/docbridge-swift-scanner",
      );
      chmodSync(scannerPath, 0o644);

      const result = resolveScannerWorkerCommand("swift", {
        platformKey: "darwin-arm64",
        sourceRoot: root,
        distRoot: join(root, "missing-dist"),
      });

      expect(result).toEqual({ ok: true, command: [scannerPath] });
      expect(statSync(scannerPath).mode & 0o111).not.toBe(0);
    },
  );
});

test("resolveScannerWorkerCommand leaves an already-executable scanner's mode untouched", () => {
  withProject({ "dist/bin/darwin-arm64/docbridge-swift-scanner": "#!/bin/sh\n" }, (root) => {
    const scannerPath = join(root, "dist/bin/darwin-arm64/docbridge-swift-scanner");
    // Owner-and-group only: repair must not widen permissions it did not need
    // to touch, so this must not become 0755.
    chmodSync(scannerPath, 0o750);

    const result = resolveScannerWorkerCommand("swift", {
      platformKey: "darwin-arm64",
      sourceRoot: join(root, "missing-source"),
      distRoot: join(root, "dist"),
    });

    expect(result.ok).toBe(true);
    expect(statSync(scannerPath).mode & 0o7777).toBe(0o750);
  });
});

// Slice 2 reports an EACCES at spawn time as a `noexec` mount on the grounds
// that resolution already made the binary executable. That only holds if the
// probe asks whether *this* process can execute the file, not whether any
// execute bit is set somewhere in the mode. Root bypasses the distinction.
const skipIfRoot =
  typeof process.getuid === "function" && process.getuid() === 0 ? test.skip : test;

skipIfRoot("resolveScannerWorkerCommand repairs a scanner the current user cannot execute", () => {
  withProject({ "dist/bin/linux-x64/docbridge_dart_scanner": "#!/bin/sh\n" }, (root) => {
    const scannerPath = join(root, "dist/bin/linux-x64/docbridge_dart_scanner");
    // Executable for group and other but not for the owner, which is us: the
    // mode has execute bits, yet this process still cannot run the file.
    chmodSync(scannerPath, 0o011);

    const result = resolveScannerWorkerCommand("dart", {
      platformKey: "linux-x64",
      sourceRoot: join(root, "missing-source"),
      distRoot: join(root, "dist"),
    });

    expect(result).toEqual({ ok: true, command: [scannerPath] });
    accessSync(scannerPath, constants.X_OK);
  });
});

test("resolveScannerWorkerCommand restores execution without widening read access", () => {
  withProject({ "dist/bin/linux-x64/docbridge_dart_scanner": "#!/bin/sh\n" }, (root) => {
    const scannerPath = join(root, "dist/bin/linux-x64/docbridge_dart_scanner");
    // A restrictive umask can install the scanner owner-only. Repair restores
    // execution and nothing else: group and other must not gain read access.
    chmodSync(scannerPath, 0o600);

    const result = resolveScannerWorkerCommand("dart", {
      platformKey: "linux-x64",
      sourceRoot: join(root, "missing-source"),
      distRoot: join(root, "dist"),
    });

    expect(result).toEqual({ ok: true, command: [scannerPath] });
    expect(statSync(scannerPath).mode & 0o7777).toBe(0o711);
  });
});

test("resolveScannerWorkerCommand reports an unrepairable executable bit", () => {
  withProject({ "dist/bin/linux-x64/docbridge_dart_scanner": "#!/bin/sh\n" }, (root) => {
    const scannerPath = join(root, "dist/bin/linux-x64/docbridge_dart_scanner");
    chmodSync(scannerPath, 0o644);

    const result = resolveScannerWorkerCommand("dart", {
      platformKey: "linux-x64",
      sourceRoot: join(root, "missing-source"),
      distRoot: join(root, "dist"),
      chmod: () => {
        throw new Error("EROFS: read-only file system");
      },
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.diagnostic.code).toBe("code_scanner_unavailable");
      expect(result.diagnostic.message).toContain(scannerPath);
      expect(result.diagnostic.message).toContain("0644");
      expect(result.diagnostic.message).toContain("EROFS");
      expect(result.diagnostic.message).toContain(`chmod +x ${scannerPath}`);
    }
  });
});

test("resolveScannerWorkerCommand reports unsupported scanner platforms", () => {
  const result = resolveScannerWorkerCommand("dart", {
    platformKey: "linux-arm64",
    sourceRoot: "/missing-source",
    distRoot: "/missing-dist",
  });

  expect(result.ok).toBe(false);
  if (!result.ok) {
    expect(result.diagnostic.code).toBe("code_scanner_unavailable");
    expect(result.diagnostic.message).toContain("linux-arm64");
    expect(result.diagnostic.message).toContain("darwin-arm64");
    expect(result.diagnostic.message).toContain("linux-x64");
  }
});
