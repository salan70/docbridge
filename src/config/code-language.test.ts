import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { codeFileOwners, type CodeInclude } from "./code-language";

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

test("codeFileOwners flags a file matched by more than one language", () => {
  withProject({ "shared/a.ts": "export const a = 1;\n" }, (root) => {
    // Construct an include where two languages glob the same file. This bypasses
    // config suffix validation to exercise the overlap-detection guard directly.
    const include: CodeInclude = {
      typescript: { patterns: ["shared/**/*.ts"] },
      swift: { patterns: ["shared/**/*.ts"] },
    };
    const owners = codeFileOwners(root, include);
    expect(owners.get("shared/a.ts")).toEqual(["typescript", "swift"]);
  });
});
