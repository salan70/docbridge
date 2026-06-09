import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import pkg from "../../package.json";
import { parseCheckOptions, parseRelatedOptions, run } from "./index";

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

test("run help documents global and check options separately", () => {
  const c = capture();
  run(["--help"], c.io);

  expect(c.out).toContain("speclink [--version] [--help]");
  expect(c.out).toContain("Global options:");
  expect(c.out).toContain("Check options:");
});

test("run prints the package version for --version and exits 0", () => {
  const c = capture();
  const code = run(["--version"], c.io);

  expect(code).toBe(0);
  expect(c.out).toBe(`${pkg.version}\n`);
  expect(c.err).toBe("");
});

test("run prints the package version for -v and exits 0", () => {
  const c = capture();
  const code = run(["-v"], c.io);

  expect(code).toBe(0);
  expect(c.out).toBe(`${pkg.version}\n`);
  expect(c.err).toBe("");
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

// --- related command ---------------------------------------------------------

test("parseRelatedOptions reads root, json, stdin, and positional files", () => {
  expect(
    parseRelatedOptions(["--root", "examples/basic", "--json", "--stdin", "src/a.ts", "docs/b.md"]),
  ).toEqual({
    root: "examples/basic",
    json: true,
    stdin: true,
    files: ["src/a.ts", "docs/b.md"],
  });
});

test("run help documents the related command", () => {
  const c = capture();
  run(["--help"], c.io);

  expect(c.out).toContain("speclink related");
  expect(c.out).toContain("Related options:");
});

test("run related without files or --stdin errors on stderr and exits 1", () => {
  const c = capture();
  const code = run(["related"], c.io);

  expect(code).toBe(1);
  expect(c.err).toContain("--stdin");
  expect(c.out).toBe("");
});

function makeRelatedProject(): string {
  const project = mkdtempSync(join(tmpdir(), "speclink-related-"));
  writeFileSync(
    join(project, "speclink.config.json"),
    JSON.stringify({ include: { code: ["src/**/*.ts"], docs: ["docs/**/*.md"] } }),
  );
  mkdirSync(join(project, "src", "auth"), { recursive: true });
  writeFileSync(
    join(project, "src", "auth", "login.ts"),
    "/**\n * @doc docs/auth.md#login-spec\n */\nexport function login() {}\n",
  );
  mkdirSync(join(project, "docs"), { recursive: true });
  writeFileSync(
    join(project, "docs", "auth.md"),
    "<!-- @code src/auth/login.ts#login -->\n## Login Spec\n",
  );
  return project;
}

test("run related prints endpoint counterparts with change-set marks and a summary", () => {
  const project = makeRelatedProject();
  try {
    const c = capture();
    const code = run(["related", "--root", project, "src/auth/login.ts"], c.io);

    expect(code).toBe(0);
    expect(c.out).toBe(
      [
        "src/auth/login.ts",
        "  login -> docs/auth.md#login-spec (not in change set)",
        "",
        "1 changed file, 1 with links",
        "",
      ].join("\n"),
    );
    expect(c.err).toBe("");
  } finally {
    rmSync(project, { recursive: true, force: true });
  }
});

test("run related marks counterparts that are in the change set", () => {
  const project = makeRelatedProject();
  try {
    const c = capture();
    const code = run(["related", "--root", project, "src/auth/login.ts", "docs/auth.md"], c.io);

    expect(code).toBe(0);
    expect(c.out).toContain("  login -> docs/auth.md#login-spec (in change set)");
    expect(c.out).toContain("  login-spec -> src/auth/login.ts#login (in change set)");
    expect(c.out).toContain("2 changed files, 2 with links");
  } finally {
    rmSync(project, { recursive: true, force: true });
  }
});

test("run related prints only the summary when no input file has links", () => {
  const project = makeRelatedProject();
  try {
    const c = capture();
    const code = run(["related", "--root", project, "bun.lock"], c.io);

    expect(code).toBe(0);
    expect(c.out).toBe("1 changed file, 0 with links\n");
  } finally {
    rmSync(project, { recursive: true, force: true });
  }
});

test("run related --stdin reads newline-separated paths from stdin", () => {
  const project = makeRelatedProject();
  try {
    const c = capture();
    const code = run(["related", "--root", project, "--stdin"], {
      ...c.io,
      stdin: () => "src/auth/login.ts\nbun.lock\n",
    });

    expect(code).toBe(0);
    expect(c.out).toContain("  login -> docs/auth.md#login-spec (not in change set)");
    expect(c.out).toContain("2 changed files, 1 with links");
  } finally {
    rmSync(project, { recursive: true, force: true });
  }
});

test("run related --stdin accepts empty input and exits 0", () => {
  const project = makeRelatedProject();
  try {
    const c = capture();
    const code = run(["related", "--root", project, "--stdin"], { ...c.io, stdin: () => "" });

    expect(code).toBe(0);
    expect(c.out).toBe("0 changed files, 0 with links\n");
  } finally {
    rmSync(project, { recursive: true, force: true });
  }
});

test("run related --json emits the result as machine-readable JSON", () => {
  const project = makeRelatedProject();
  try {
    const c = capture();
    const code = run(["related", "--root", project, "--json", "src/auth/login.ts"], c.io);

    expect(code).toBe(0);
    const parsed = JSON.parse(c.out) as {
      files: Array<{
        filePath: string;
        endpoints: Array<{
          endpoint: string;
          counterparts: Array<{ endpoint: string; filePath: string; inChangeSet: boolean }>;
        }>;
      }>;
      summary: { changedFiles: number; filesWithLinks: number };
    };
    expect(parsed.files).toEqual([
      {
        filePath: "src/auth/login.ts",
        endpoints: [
          {
            endpoint: "src/auth/login.ts#login",
            counterparts: [
              { endpoint: "docs/auth.md#login-spec", filePath: "docs/auth.md", inChangeSet: false },
            ],
          },
        ],
      },
    ]);
    expect(parsed.summary).toEqual({ changedFiles: 1, filesWithLinks: 1 });
  } finally {
    rmSync(project, { recursive: true, force: true });
  }
});

test("run related reports config errors on stderr and exits 1", () => {
  const project = mkdtempSync(join(tmpdir(), "speclink-related-badcfg-"));
  try {
    writeFileSync(join(project, "speclink.config.json"), "{ not json");
    const c = capture();
    const code = run(["related", "--root", project, "src/a.ts"], c.io);

    expect(code).toBe(1);
    expect(c.err.length).toBeGreaterThan(0);
    expect(c.out).toBe("");
  } finally {
    rmSync(project, { recursive: true, force: true });
  }
});
