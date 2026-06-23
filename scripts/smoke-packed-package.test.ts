import { expect, test } from "bun:test";
import { chmodSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { assertInstalledScannerExecutables } from "./smoke-packed-package";

test("assertInstalledScannerExecutables rejects installed scanner binaries without executable bits", () => {
  const root = mkdtempSync(join(tmpdir(), "docbridge-pack-smoke-"));
  try {
    const scanner = join(
      root,
      "node_modules/docbridge/dist/bin/darwin-arm64/speclink-swift-scanner",
    );
    mkdirSync(join(scanner, ".."), { recursive: true });
    writeFileSync(scanner, "#!/bin/sh\n");
    chmodSync(scanner, 0o644);

    expect(() => assertInstalledScannerExecutables(root)).toThrow(
      "node_modules/docbridge/dist/bin/darwin-arm64/speclink-swift-scanner is not executable",
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
