import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import pkg from "../../package.json";
import {
  parseCheckOptions,
  parseContextOptions,
  parseGraphOptions,
  parseRelatedOptions,
  run,
} from "./index";

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
  expect(parseCheckOptions(["--root", "examples/typescript", "--json", "--audit"])).toEqual({
    root: "examples/typescript",
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
  const code = run(["check", "--root", "examples/typescript", "--json"], c.io);

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
  run(["check", "--root", "examples/typescript", "--json"], c.io);

  expect(c.out).toContain('  "summary": {');
  expect(c.out.endsWith("\n")).toBe(true);
});

test("run emits a human-readable summary line for a clean project", () => {
  const c = capture();
  const code = run(["check", "--root", "examples/typescript"], c.io);

  expect(code).toBe(0);
  expect(c.out).toContain("Summary: 0 errors, 0 warnings");
});

test("run exits 0 when only warnings exist", () => {
  // Audit on the clean example surfaces only undocumented_symbol warnings.
  const errProject = mkdtempSync(join(tmpdir(), "speclink-warn-"));
  try {
    writeFileSync(
      join(errProject, "speclink.config.json"),
      JSON.stringify({ include: { code: { typescript: { patterns: ["src/**/*.ts"] } }, docs: ["docs/**/*.md"] } }),
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
      JSON.stringify({ include: { code: { typescript: { patterns: ["src/**/*.ts"] } }, docs: ["docs/**/*.md"] } }),
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
    parseRelatedOptions(["--root", "examples/typescript", "--json", "--stdin", "src/a.ts", "docs/b.md"]),
  ).toEqual({
    root: "examples/typescript",
    json: true,
    stdin: true,
    gate: false,
    files: ["src/a.ts", "docs/b.md"],
  });
});

test("parseRelatedOptions reads the --gate flag", () => {
  expect(parseRelatedOptions(["--gate", "src/a.ts"])).toEqual({
    root: ".",
    json: false,
    stdin: false,
    gate: true,
    files: ["src/a.ts"],
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
    JSON.stringify({ include: { code: { typescript: { patterns: ["src/**/*.ts"] } }, docs: ["docs/**/*.md"] } }),
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

test("run related --gate prints unchanged counterparts and exits 1", () => {
  const project = makeRelatedProject();
  try {
    const c = capture();
    const code = run(["related", "--root", project, "--gate", "src/auth/login.ts"], c.io);

    expect(code).toBe(1);
    expect(c.out).toBe(
      [
        "src/auth/login.ts#login -> docs/auth.md#login-spec (counterpart not in change set)",
        "",
        "1 changed file, 1 counterpart not in change set",
        "",
      ].join("\n"),
    );
    expect(c.err).toBe("");
  } finally {
    rmSync(project, { recursive: true, force: true });
  }
});

test("run related --gate exits 0 when every counterpart is in the change set", () => {
  const project = makeRelatedProject();
  try {
    const c = capture();
    const code = run(
      ["related", "--root", project, "--gate", "src/auth/login.ts", "docs/auth.md"],
      c.io,
    );

    expect(code).toBe(0);
    expect(c.out).toBe("2 changed files, 0 counterparts not in change set\n");
  } finally {
    rmSync(project, { recursive: true, force: true });
  }
});

test("run related --gate exits 0 when no changed file has links", () => {
  const project = makeRelatedProject();
  try {
    const c = capture();
    const code = run(["related", "--root", project, "--gate", "bun.lock"], c.io);

    expect(code).toBe(0);
    expect(c.out).toBe("1 changed file, 0 counterparts not in change set\n");
  } finally {
    rmSync(project, { recursive: true, force: true });
  }
});

test("run related --gate --json emits violations as machine-readable JSON", () => {
  const project = makeRelatedProject();
  try {
    const c = capture();
    const code = run(["related", "--root", project, "--gate", "--json", "src/auth/login.ts"], c.io);

    expect(code).toBe(1);
    expect(JSON.parse(c.out)).toEqual({
      violations: [
        {
          changedEndpoint: "src/auth/login.ts#login",
          changedFilePath: "src/auth/login.ts",
          counterpartEndpoint: "docs/auth.md#login-spec",
          counterpartFilePath: "docs/auth.md",
        },
      ],
      summary: { changedFiles: 1, violations: 1 },
    });
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

// --- context command ---------------------------------------------------------

test("parseContextOptions reads root, json, stdin, and positional files", () => {
  expect(
    parseContextOptions(["--root", "examples/typescript", "--json", "--stdin", "src/a.ts", "docs/b.md"]),
  ).toEqual({
    root: "examples/typescript",
    json: true,
    stdin: true,
    files: ["src/a.ts", "docs/b.md"],
  });
});

test("run help documents the context command", () => {
  const c = capture();
  run(["--help"], c.io);

  expect(c.out).toContain("speclink context");
  expect(c.out).toContain("Context options:");
});

test("run context without files or --stdin errors on stderr and exits 1", () => {
  const c = capture();
  const code = run(["context"], c.io);

  expect(code).toBe(1);
  expect(c.err).toContain("--stdin");
  expect(c.out).toBe("");
});

function makeContextProject(): string {
  const project = mkdtempSync(join(tmpdir(), "speclink-context-"));
  writeFileSync(
    join(project, "speclink.config.json"),
    JSON.stringify({ include: { code: { typescript: { patterns: ["src/**/*.ts"] } }, docs: ["docs/**/*.md"] } }),
  );
  mkdirSync(join(project, "src", "auth"), { recursive: true });
  writeFileSync(
    join(project, "src", "auth", "login.ts"),
    "/**\n * @doc docs/auth.md#login-spec\n */\nexport function login() {}\n",
  );
  mkdirSync(join(project, "docs"), { recursive: true });
  writeFileSync(
    join(project, "docs", "auth.md"),
    "<!-- @code src/auth/login.ts#login -->\n## Login Spec\n\nThe login flow.\n",
  );
  return project;
}

test("run context prints counterpart content blocks and a summary", () => {
  const project = makeContextProject();
  try {
    const c = capture();
    const code = run(["context", "--root", project, "src/auth/login.ts"], c.io);

    expect(code).toBe(0);
    expect(c.out).toBe(
      [
        "docs/auth.md#login-spec (linked from src/auth/login.ts#login)",
        "",
        "## Login Spec",
        "",
        "The login flow.",
        "",
        "1 input file, 1 context block",
        "",
      ].join("\n"),
    );
    expect(c.err).toBe("");
  } finally {
    rmSync(project, { recursive: true, force: true });
  }
});

test("run context prints only the summary when no input file has links", () => {
  const project = makeContextProject();
  try {
    const c = capture();
    const code = run(["context", "--root", project, "bun.lock"], c.io);

    expect(code).toBe(0);
    expect(c.out).toBe("1 input file, 0 context blocks\n");
  } finally {
    rmSync(project, { recursive: true, force: true });
  }
});

test("run context --stdin reads newline-separated paths from stdin", () => {
  const project = makeContextProject();
  try {
    const c = capture();
    const code = run(["context", "--root", project, "--stdin"], {
      ...c.io,
      stdin: () => "src/auth/login.ts\nbun.lock\n",
    });

    expect(code).toBe(0);
    expect(c.out).toContain("docs/auth.md#login-spec (linked from src/auth/login.ts#login)");
    expect(c.out).toContain("2 input files, 1 context block");
  } finally {
    rmSync(project, { recursive: true, force: true });
  }
});

test("run context --json emits contexts, diagnostics, and summary as JSON", () => {
  const project = makeContextProject();
  try {
    const c = capture();
    const code = run(["context", "--root", project, "--json", "src/auth/login.ts"], c.io);

    expect(code).toBe(0);
    expect(JSON.parse(c.out)).toEqual({
      contexts: [
        {
          endpoint: "docs/auth.md#login-spec",
          kind: "doc",
          filePath: "docs/auth.md",
          startLine: 2,
          endLine: 4,
          linkedFrom: ["src/auth/login.ts#login"],
          content: "## Login Spec\n\nThe login flow.",
        },
      ],
      diagnostics: [],
      summary: { inputFiles: 1, contexts: 1 },
    });
    expect(c.err).toBe("");
  } finally {
    rmSync(project, { recursive: true, force: true });
  }
});

test("run context reports broken links in input files on stderr but still exits 0", () => {
  const project = makeContextProject();
  try {
    writeFileSync(
      join(project, "src", "auth", "broken.ts"),
      "/**\n * @doc docs/auth.md#missing\n */\nexport function broken() {}\n",
    );
    const c = capture();
    const code = run(["context", "--root", project, "src/auth/broken.ts"], c.io);

    expect(code).toBe(0);
    expect(c.out).toBe("1 input file, 0 context blocks\n");
    expect(c.err).toContain("doc_anchor_not_found");
  } finally {
    rmSync(project, { recursive: true, force: true });
  }
});

// --- graph command -----------------------------------------------------------

test("parseGraphOptions reads root, json, include-content, stdin, and positional files", () => {
  expect(
    parseGraphOptions([
      "--root",
      "examples/typescript",
      "--json",
      "--include-content",
      "--stdin",
      "src/a.ts",
      "docs/b.md",
    ]),
  ).toEqual({
    root: "examples/typescript",
    json: true,
    includeContent: true,
    stdin: true,
    files: ["src/a.ts", "docs/b.md"],
  });
});

test("run graph --json emits nodes, edges, pairs, diagnostics, and summary", () => {
  const project = makeContextProject();
  try {
    const c = capture();
    const code = run(["graph", "--root", project, "--json"], c.io);

    expect(code).toBe(0);
    const parsed = JSON.parse(c.out) as {
      nodes: Array<{ endpoint: string; kind: string; filePath: string }>;
      edges: Array<{ kind: string; source: string; target: string }>;
      pairs: Array<{
        codeEndpoint: string;
        docEndpoint: string;
        hasDocEdge: boolean;
        hasCodeEdge: boolean;
      }>;
      diagnostics: unknown[];
      summary: {
        nodes: number;
        edges: number;
        codeNodes: number;
        docNodes: number;
        bidirectionalPairs: number;
        oneWayEdges: number;
        diagnostics: number;
      };
    };

    expect(parsed.nodes.map((node) => node.endpoint).sort()).toEqual([
      "docs/auth.md#login-spec",
      "src/auth/login.ts#login",
    ]);
    expect(
      parsed.edges
        .map((edge) => ({ kind: edge.kind, source: edge.source, target: edge.target }))
        .sort((left, right) => left.kind.localeCompare(right.kind)),
    ).toEqual([
      {
        kind: "code",
        source: "docs/auth.md#login-spec",
        target: "src/auth/login.ts#login",
      },
      {
        kind: "doc",
        source: "src/auth/login.ts#login",
        target: "docs/auth.md#login-spec",
      },
    ]);
    expect(parsed.pairs).toEqual([
      {
        codeEndpoint: "src/auth/login.ts#login",
        docEndpoint: "docs/auth.md#login-spec",
        hasDocEdge: true,
        hasCodeEdge: true,
      },
    ]);
    expect(parsed.diagnostics).toEqual([]);
    expect(parsed.summary).toEqual({
      nodes: 2,
      edges: 2,
      codeNodes: 1,
      docNodes: 1,
      bidirectionalPairs: 1,
      oneWayEdges: 0,
      diagnostics: 0,
    });
    expect(c.err).toBe("");
  } finally {
    rmSync(project, { recursive: true, force: true });
  }
});

test("run graph prints docs-oriented text output for the whole project", () => {
  const project = makeContextProject();
  try {
    const c = capture();
    const code = run(["graph", "--root", project], c.io);

    expect(code).toBe(0);
    expect(c.out).toBe(
      [
        "docs/auth.md",
        "  login-spec -> src/auth/login.ts#login (bidirectional)",
        "",
        "2 nodes, 2 edges, 1 bidirectional pair, 0 one-way edges, 0 diagnostics",
        "",
      ].join("\n"),
    );
    expect(c.err).toBe("");
  } finally {
    rmSync(project, { recursive: true, force: true });
  }
});

test("run graph text output scopes normalized input paths", () => {
  const project = makeContextProject();
  try {
    const c = capture();
    const code = run(["graph", "--root", project, "./src/auth/login.ts"], c.io);

    expect(code).toBe(0);
    expect(c.out).toBe(
      [
        "src/auth/login.ts",
        "  login -> docs/auth.md#login-spec (bidirectional)",
        "",
        "2 nodes, 2 edges, 1 bidirectional pair, 0 one-way edges, 0 diagnostics",
        "",
      ].join("\n"),
    );
    expect(c.err).toBe("");
  } finally {
    rmSync(project, { recursive: true, force: true });
  }
});

test("run graph text output reports scoped diagnostics on stderr", () => {
  const project = makeContextProject();
  try {
    writeFileSync(
      join(project, "src", "auth", "broken.ts"),
      "/**\n * @doc docs/auth.md#missing\n */\nexport function broken() {}\n",
    );
    const c = capture();
    const code = run(["graph", "--root", project, "src/auth/broken.ts"], c.io);

    expect(code).toBe(0);
    expect(c.out).toBe("0 nodes, 0 edges, 0 bidirectional pairs, 0 one-way edges, 1 diagnostic\n");
    expect(c.err).toContain("doc_anchor_not_found");
  } finally {
    rmSync(project, { recursive: true, force: true });
  }
});

test("run graph --json scopes output to input files and direct counterparts", () => {
  const project = makeContextProject();
  try {
    mkdirSync(join(project, "src", "billing"), { recursive: true });
    writeFileSync(
      join(project, "src", "billing", "charge.ts"),
      "/**\n * @doc docs/billing.md#charge-spec\n */\nexport function charge() {}\n",
    );
    writeFileSync(
      join(project, "docs", "billing.md"),
      "<!-- @code src/billing/charge.ts#charge -->\n## Charge Spec\n",
    );

    const c = capture();
    const code = run(["graph", "--root", project, "--json", "src/auth/login.ts"], c.io);

    expect(code).toBe(0);
    const parsed = JSON.parse(c.out) as {
      nodes: Array<{ endpoint: string }>;
      pairs: Array<{
        codeEndpoint: string;
        docEndpoint: string;
        hasDocEdge: boolean;
        hasCodeEdge: boolean;
      }>;
      summary: { nodes: number; edges: number };
    };
    expect(parsed.nodes.map((node) => node.endpoint).sort()).toEqual([
      "docs/auth.md#login-spec",
      "src/auth/login.ts#login",
    ]);
    expect(parsed.pairs).toEqual([
      {
        codeEndpoint: "src/auth/login.ts#login",
        docEndpoint: "docs/auth.md#login-spec",
        hasDocEdge: true,
        hasCodeEdge: true,
      },
    ]);
    expect(parsed.summary).toMatchObject({ nodes: 2, edges: 2 });
  } finally {
    rmSync(project, { recursive: true, force: true });
  }
});

test("run graph --json --include-content includes lightweight node content", () => {
  const project = makeContextProject();
  try {
    const c = capture();
    const code = run(["graph", "--root", project, "--json", "--include-content"], c.io);

    expect(code).toBe(0);
    const parsed = JSON.parse(c.out) as {
      nodes: Array<{
        kind: "code" | "doc";
        content?: { kind: "code"; symbolName: string; signature: string } | { kind: "doc"; headingText: string };
      }>;
    };
    const codeNode = parsed.nodes.find((node) => node.kind === "code");
    const docNode = parsed.nodes.find((node) => node.kind === "doc");

    expect(codeNode?.content).toEqual({
      kind: "code",
      symbolName: "login",
      signature: "/**\n * @doc docs/auth.md#login-spec\n */\nexport function login()",
    });
    expect(docNode?.content).toEqual({ kind: "doc", headingText: "Login Spec" });
  } finally {
    rmSync(project, { recursive: true, force: true });
  }
});

test("run graph --include-content without --json errors", () => {
  const c = capture();
  const code = run(["graph", "--include-content"], c.io);

  expect(code).toBe(1);
  expect(c.err).toContain("--json");
  expect(c.out).toBe("");
});

test("run graph includes resolvable one-way links and exits 0 with link diagnostics", () => {
  const project = makeContextProject();
  try {
    writeFileSync(join(project, "docs", "auth.md"), "## Login Spec\n\nThe login flow.\n");
    const c = capture();
    const code = run(["graph", "--root", project, "--json"], c.io);

    expect(code).toBe(0);
    const parsed = JSON.parse(c.out) as {
      pairs: Array<{
        codeEndpoint: string;
        docEndpoint: string;
        hasDocEdge: boolean;
        hasCodeEdge: boolean;
      }>;
      diagnostics: Array<{ code: string }>;
      summary: { oneWayEdges: number; diagnostics: number };
    };
    expect(parsed.pairs).toEqual([
      {
        codeEndpoint: "src/auth/login.ts#login",
        docEndpoint: "docs/auth.md#login-spec",
        hasDocEdge: true,
        hasCodeEdge: false,
      },
    ]);
    expect(parsed.diagnostics.map((diagnostic) => diagnostic.code)).toContain(
      "doc_backlink_not_found",
    );
    expect(parsed.summary.oneWayEdges).toBe(1);
    expect(parsed.summary.diagnostics).toBeGreaterThan(0);
    expect(c.err).toBe("");
  } finally {
    rmSync(project, { recursive: true, force: true });
  }
});

test("run context omits diagnostics located outside the input files", () => {
  const project = makeContextProject();
  try {
    writeFileSync(
      join(project, "src", "auth", "broken.ts"),
      "/**\n * @doc docs/auth.md#missing\n */\nexport function broken() {}\n",
    );
    const c = capture();
    const code = run(["context", "--root", project, "src/auth/login.ts"], c.io);

    expect(code).toBe(0);
    expect(c.err).toBe("");
  } finally {
    rmSync(project, { recursive: true, force: true });
  }
});

test("run context reports config errors on stderr and exits 1", () => {
  const project = mkdtempSync(join(tmpdir(), "speclink-context-badcfg-"));
  try {
    writeFileSync(join(project, "speclink.config.json"), "{ not json");
    const c = capture();
    const code = run(["context", "--root", project, "src/a.ts"], c.io);

    expect(code).toBe(1);
    expect(c.err.length).toBeGreaterThan(0);
    expect(c.out).toBe("");
  } finally {
    rmSync(project, { recursive: true, force: true });
  }
});
