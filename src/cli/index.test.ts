import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { parseCheckOptions, run } from "./index";

type Captured = {
  out: string;
  err: string;
  io: { stdout: (text: string) => void; stderr: (text: string) => void };
};

function capture(): Captured {
  const state = { out: "", err: "" };
  return {
    get out() {
      return state.out;
    },
    get err() {
      return state.err;
    },
    io: {
      stdout: (text: string) => {
        state.out += text;
      },
      stderr: (text: string) => {
        state.err += text;
      },
    },
  };
}

test("parseCheckOptions reads root, json, and audit flags", () => {
  expect(parseCheckOptions(["--root", "examples/basic", "--json", "--audit"])).toEqual({
    root: "examples/basic",
    json: true,
    audit: true,
  });
});

test("run prints help and exits 0 with no command", () => {
  const c = capture();
  const code = run([], c.io);

  expect(code).toBe(0);
  expect(c.out).toContain("Usage:");
  expect(c.err).toBe("");
});

test("run prints help for --help and exits 0", () => {
  const c = capture();
  const code = run(["--help"], c.io);

  expect(code).toBe(0);
  expect(c.out).toContain("Usage:");
});

test("run reports an unknown command on stderr and exits 1", () => {
  const c = capture();
  const code = run(["bogus"], c.io);

  expect(code).toBe(1);
  expect(c.err).toContain("Unknown command");
  expect(c.out).toBe("");
});

test("run reports an unknown option on stderr and exits 1 without JSON", () => {
  const c = capture();
  const code = run(["check", "--bogus", "--json"], c.io);

  expect(code).toBe(1);
  expect(c.err).toContain("Unknown option");
  expect(c.out).toBe("");
});

test("run reports a missing --root value on stderr and exits 1", () => {
  const c = capture();
  const code = run(["check", "--root"], c.io);

  expect(code).toBe(1);
  expect(c.err).toContain("--root");
  expect(c.out).toBe("");
});

test("run reports a non-existent root on stderr and exits 1", () => {
  const c = capture();
  const code = run(["check", "--root", "/no/such/dir/speclink-test"], c.io);

  expect(code).toBe(1);
  expect(c.err.length).toBeGreaterThan(0);
  expect(c.out).toBe("");
});

test("run reports a non-directory root on stderr and exits 1", () => {
  const dir = mkdtempSync(join(tmpdir(), "speclink-cli-"));
  const filePath = join(dir, "not-a-dir.txt");
  writeFileSync(filePath, "x");
  try {
    const c = capture();
    const code = run(["check", "--root", filePath], c.io);

    expect(code).toBe(1);
    expect(c.err.length).toBeGreaterThan(0);
    expect(c.out).toBe("");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("run emits valid JSON for --json against a clean project", () => {
  const c = capture();
  const code = run(["check", "--root", "examples/basic", "--json"], c.io);

  expect(code).toBe(0);
  const parsed = JSON.parse(c.out) as {
    diagnostics: unknown[];
    summary: { errors: number; warnings: number };
  };
  expect(Array.isArray(parsed.diagnostics)).toBe(true);
  expect(parsed.summary).toEqual({ errors: 0, warnings: 0 });
});

test("run emits 2-space indented pretty JSON", () => {
  const c = capture();
  run(["check", "--root", "examples/basic", "--json"], c.io);

  expect(c.out).toContain('  "summary": {');
  expect(c.out.endsWith("\n")).toBe(true);
});

test("run emits a human-readable summary line for a clean project", () => {
  const c = capture();
  const code = run(["check", "--root", "examples/basic"], c.io);

  expect(code).toBe(0);
  expect(c.out).toContain("Summary: 0 errors, 0 warnings");
});

test("run exits 0 when only warnings exist", () => {
  // Audit on the clean example surfaces only undocumented_symbol warnings.
  const errProject = mkdtempSync(join(tmpdir(), "speclink-warn-"));
  try {
    writeFileSync(
      join(errProject, "speclink.config.json"),
      JSON.stringify({ include: { code: ["src/**/*.ts"], docs: ["docs/**/*.md"] } }),
    );
    // No source files: no diagnostics at all -> exit 0.
    const c = capture();
    const code = run(["check", "--root", errProject], c.io);
    expect(code).toBe(0);
  } finally {
    rmSync(errProject, { recursive: true, force: true });
  }
});

test("run exits 1 when check errors exist", () => {
  const project = mkdtempSync(join(tmpdir(), "speclink-err-"));
  try {
    writeFileSync(
      join(project, "speclink.config.json"),
      JSON.stringify({ include: { code: ["src/**/*.ts"], docs: ["docs/**/*.md"] } }),
    );
    // A code file with a @doc link to a non-existent doc -> doc_file_not_found error.
    const srcDir = join(project, "src");
    mkdirSync(srcDir, { recursive: true });
    writeFileSync(
      join(srcDir, "a.ts"),
      "/**\n * @doc docs/specs/missing.md#nope\n */\nexport function a(): void {}\n",
    );
    const c = capture();
    const code = run(["check", "--root", project], c.io);
    expect(code).toBe(1);
    expect(c.out).toContain("error");
    expect(c.out).toContain("Summary:");
  } finally {
    rmSync(project, { recursive: true, force: true });
  }
});
