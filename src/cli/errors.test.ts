import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { run } from "./index";

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

test("unknown commands list available commands and suggest a close match", () => {
  const c = capture();
  const code = run(["ctx"], c.io);

  expect(code).toBe(1);
  expect(c.err).toBe(
    [
      "Error: Unknown command: ctx",
      "",
      "Available commands:",
      "  check, related, context, graph, init, init-with-agent, lsp",
      "",
      "Did you mean `context`?",
      "",
      "Run `docbridge --help` for usage.",
      "",
    ].join("\n"),
  );
  expect(c.out).toBe("");
});

test("unknown commands do not include a false suggestion", () => {
  const c = capture();
  const code = run(["bogus"], c.io);

  expect(code).toBe(1);
  expect(c.err).toContain("Available commands:");
  expect(c.err).toContain("Run `docbridge --help` for usage.");
  expect(c.err).not.toContain("Did you mean");
  expect(c.out).toBe("");
});

test("unknown options identify the command-specific help", () => {
  const c = capture();
  const code = run(["check", "--bogus", "--json"], c.io);

  expect(code).toBe(1);
  expect(c.err).toBe(
    [
      "Error: Unknown option: --bogus",
      "",
      "Run `docbridge check --help` for command usage.",
      "",
    ].join("\n"),
  );
  expect(c.out).toBe("");
});

test("missing option values include a runnable project-root example", () => {
  const c = capture();
  const code = run(["check", "--root"], c.io);

  expect(code).toBe(1);
  expect(c.err).toBe(
    [
      "Error: --root requires a path.",
      "",
      "Provide a project root path:",
      "",
      "  docbridge check --root .",
      "",
      "Run `docbridge check --help` for command usage.",
      "",
    ].join("\n"),
  );
  expect(c.out).toBe("");
});

test("missing context input includes file and stdin examples", () => {
  const c = capture();
  const code = run(["context"], c.io);

  expect(code).toBe(1);
  expect(c.err).toBe(
    [
      "Error: No input files were provided.",
      "",
      "Provide file paths as arguments:",
      "",
      "  docbridge context src/auth.ts",
      "",
      "Or read newline-separated paths from stdin:",
      "",
      "  git diff --name-only | docbridge context --stdin",
      "",
      "Run `docbridge context --help` for command usage.",
      "",
    ].join("\n"),
  );
  expect(c.out).toBe("");
});

test("missing related input uses the related command in its examples", () => {
  const c = capture();
  const code = run(["related"], c.io);

  expect(code).toBe(1);
  expect(c.err).toContain("docbridge related src/auth.ts");
  expect(c.err).toContain("git diff --name-only | docbridge related --stdin");
  expect(c.err).toContain("Run `docbridge related --help` for command usage.");
  expect(c.out).toBe("");
});

test("missing check configuration sends setup guidance to stderr", () => {
  const project = mkdtempSync(join(tmpdir(), "docbridge-missing-config-"));
  try {
    const c = capture();
    const code = run(["check", "--root", project], c.io);

    expect(code).toBe(1);
    expect(c.out).toContain("config_file_invalid");
    expect(c.out).not.toContain("docbridge init");
    expect(c.err).toContain("docbridge init");
    expect(c.err).toContain("docbridge init --dry-run");
    expect(c.err).toContain("docbridge init-with-agent");
  } finally {
    rmSync(project, { recursive: true, force: true });
  }
});

test("missing check configuration keeps JSON output free of human guidance", () => {
  const project = mkdtempSync(join(tmpdir(), "docbridge-missing-config-json-"));
  try {
    const c = capture();
    const code = run(["check", "--root", project, "--json"], c.io);

    expect(code).toBe(1);
    expect(JSON.parse(c.out)).toEqual({
      diagnostics: [
        {
          severity: "error",
          code: "config_file_invalid",
          target: "docbridge.config.json",
          message: "docbridge.config.json was not found. DocBridge requires a configuration file.",
        },
      ],
      summary: { errors: 1, warnings: 0 },
    });
    expect(c.err).toBe("");
  } finally {
    rmSync(project, { recursive: true, force: true });
  }
});
