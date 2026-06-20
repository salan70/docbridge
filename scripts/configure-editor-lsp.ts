import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

const [, , root, bunPath] = Bun.argv;

if (root === undefined || bunPath === undefined) {
  throw new Error("Usage: bun run scripts/configure-editor-lsp.ts <root> <bun-path>");
}

const settingsPath = join(root, ".vscode", "settings.json");
let settings: Record<string, unknown> = {};

try {
  settings = JSON.parse(readFileSync(settingsPath, "utf8")) as Record<string, unknown>;
} catch (error) {
  const code = (error as NodeJS.ErrnoException).code;
  if (code !== "ENOENT") {
    throw error;
  }
}

settings["docbridge.bunPath"] = bunPath;
settings["docbridge.trace.server"] = "verbose";

mkdirSync(dirname(settingsPath), { recursive: true });
writeFileSync(settingsPath, `${JSON.stringify(settings, null, 2)}\n`);
