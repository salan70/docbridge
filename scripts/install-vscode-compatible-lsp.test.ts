import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dir, "..");
const installer = readFileSync(join(root, "scripts/install-vscode-compatible-lsp.sh"), "utf8");

describe("install-vscode-compatible-lsp.sh", () => {
  test("assembles the VSIX with the same implementation release packaging uses", () => {
    expect(installer).toContain('scripts/vscode-extension.ts" package --local');
  });

  test("verifies the artifact before handing it to the editor", () => {
    expect(installer).toContain('scripts/vscode-extension.ts" verify "$VSIX" --local');
  });

  test("installs the artifact it just assembled", () => {
    expect(installer).toContain('--install-extension "$VSIX" --force');
  });

  test("keeps no second server-copying algorithm", () => {
    expect(existsSync(join(root, "scripts/package-editor-vsix.sh"))).toBe(false);
    expect(installer).not.toContain("package-editor-vsix");
  });
});
