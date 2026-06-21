import { expect, test } from "bun:test";
import { chmodSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { verifyDistPackage } from "./verify-dist";

test("verifyDistPackage rejects packaged scanner binaries without executable bits", async () => {
  const root = mkdtempSync(join(tmpdir(), "docbridge-verify-dist-"));
  try {
    const distCli = join(root, "dist/index.js");
    const scanner = join(
      root,
      "dist/bin/darwin-arm64/speclink-swift-scanner",
    );
    mkdirSync(join(distCli, ".."), { recursive: true });
    mkdirSync(join(scanner, ".."), { recursive: true });
    writeFileSync(distCli, "#!/usr/bin/env bun\n");
    chmodSync(distCli, 0o755);
    writeFileSync(scanner, "#!/bin/sh\n");
    chmodSync(scanner, 0o644);

    await expect(
      verifyDistPackage(root, {
        run: () => {},
      }),
    ).rejects.toThrow(
      "dist/bin/darwin-arm64/speclink-swift-scanner is not executable",
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
