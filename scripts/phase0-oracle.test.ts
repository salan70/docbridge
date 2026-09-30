import { describe, expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

import { runPhase0, type Phase0Input } from "./phase0-fixtures";

/**
 * The hand-written Phase 0 cases are the independent oracle for the resolver
 * and the graph: `expected.json` was written from the specs, not from the
 * TypeScript implementation. A failure here is a finding against the current
 * core (or a wrong expectation) and is never fixed by regenerating the file.
 */
const REPO_ROOT = resolve(import.meta.dir, "..");
const ORACLE_ROOTS = [
  "test-fixtures/phase0/specified",
  // Held-out cases are excluded from `just phase0-parity` but the TypeScript
  // baseline must still satisfy them. The directory may be absent during a
  // Slice B run, so it is only checked when present.
  "test-fixtures/phase0-heldout",
];

for (const relRoot of ORACLE_ROOTS) {
  const root = join(REPO_ROOT, relRoot);
  if (!existsSync(root)) {
    continue;
  }
  const cases = readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .toSorted();

  describe(relRoot, () => {
    test("has cases", () => {
      expect(cases.length).toBeGreaterThan(0);
    });

    for (const name of cases) {
      test(`${name} matches its hand-written expectation`, () => {
        const caseDir = join(root, name);
        const input = JSON.parse(readFileSync(join(caseDir, "input.json"), "utf8")) as Phase0Input;
        const expected = JSON.parse(readFileSync(join(caseDir, "expected.json"), "utf8"));
        expect(runPhase0(input)).toEqual(expected);
      });
    }
  });
}
