import { expect, test } from "bun:test";
import { statSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "../..");

// Git silently skips a hook without an executable bit, which would turn the
// repository guardrail off without any error.
test("the pre-commit hook is executable", () => {
  const hook = join(ROOT, ".githooks/pre-commit");

  expect(statSync(hook).mode & 0o111).not.toBe(0);
});
