import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { codeFileOwners, collectCodeFiles, type CodeInclude } from "./code-language";

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

test("collectCodeFiles drops a matched file with its language's excluded suffix", () => {
  withProject(
    { "src/app.ts": "export const app = 1;\n", "src/types.d.ts": "export {};\n" },
    (root) => {
      const files = collectCodeFiles(root, { typescript: { patterns: ["src/**/*.ts"] } });
      expect(files).toEqual([{ language: "typescript", relPath: "src/app.ts" }]);
    },
  );
});

test("collectCodeFiles drops a matched file that an exclude pattern selects", () => {
  withProject({ "lib/a.dart": "void a() {}\n", "lib/a.g.dart": "// generated\n" }, (root) => {
    const files = collectCodeFiles(root, {
      dart: { patterns: ["lib/**/*.dart"], exclude: ["lib/**/*.g.dart"] },
    });
    expect(files).toEqual([{ language: "dart", relPath: "lib/a.dart" }]);
  });
});

test("codeFileOwners gives no owner to a matched file that an exclude pattern selects", () => {
  withProject({ "lib/a.dart": "void a() {}\n", "lib/a.g.dart": "// generated\n" }, (root) => {
    const owners = codeFileOwners(root, {
      dart: { patterns: ["lib/**/*.dart"], exclude: ["lib/**/*.g.dart"] },
    });
    expect([...owners.keys()]).toEqual(["lib/a.dart"]);
  });
});

test("collectCodeFiles claims .tsx, .mts, and .cts files as typescript but no declaration file", () => {
  withProject(
    {
      "src/view.tsx": "export const view = 1;\n",
      "src/module.mts": "export const module = 1;\n",
      "src/common.cts": "export const common = 1;\n",
      "src/module.d.mts": "export {};\n",
      "src/common.d.cts": "export {};\n",
    },
    (root) => {
      const files = collectCodeFiles(root, {
        typescript: { patterns: ["src/**/*.tsx", "src/**/*.mts", "src/**/*.cts"] },
      });
      expect(files).toEqual([
        { language: "typescript", relPath: "src/common.cts" },
        { language: "typescript", relPath: "src/module.mts" },
        { language: "typescript", relPath: "src/view.tsx" },
      ]);
    },
  );
});

test("codeFileOwners gives no owner to a matched file with an excluded suffix", () => {
  withProject(
    { "src/app.ts": "export const app = 1;\n", "src/types.d.ts": "export {};\n" },
    (root) => {
      const owners = codeFileOwners(root, { typescript: { patterns: ["src/**/*.ts"] } });
      expect([...owners.keys()]).toEqual(["src/app.ts"]);
    },
  );
});
