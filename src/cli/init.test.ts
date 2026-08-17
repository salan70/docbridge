import { expect, test } from "bun:test";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { resolvePackageRoot } from "../core/init-plan";
import { makeProject } from "../core/test-support";
import { run } from "./index";
import {
  InitCliError,
  parseInitOptions,
  runInit,
  runInitWithAgent,
  type InitPrompts,
} from "./init";
import { capture } from "./test-support";

const nonInteractivePrompts: InitPrompts = {
  isInteractive: false,
  confirm: () => true,
  select: (_message, _choices, defaultChoice) => defaultChoice,
};

const interactivePrompts: InitPrompts = {
  isInteractive: true,
  confirm: () => true,
  select: (_message, _choices, defaultChoice) => defaultChoice,
};

test("parseInitOptions accepts shared init options", () => {
  expect(
    parseInitOptions(
      ["--root", "examples/typescript", "--yes", "--dry-run", "--force", "--agent-target", "both"],
      "init",
    ),
  ).toEqual({
    root: "examples/typescript",
    yes: true,
    dryRun: true,
    force: true,
    agentTarget: "both",
  });
});

test("parseInitOptions rejects unknown options", () => {
  expect(() => parseInitOptions(["--bogus"], "init")).toThrow(InitCliError);
  expect(() => parseInitOptions(["--bogus"], "init")).toThrow("Unknown option");
});

test("parseInitOptions rejects missing option values", () => {
  expect(() => parseInitOptions(["--root"], "init")).toThrow("--root requires a path.");
  expect(() => parseInitOptions(["--agent-target"], "init")).toThrow(
    "--agent-target requires a value.",
  );
});

test("parseInitOptions rejects none for init-with-agent", () => {
  expect(() => parseInitOptions(["--agent-target", "none"], "init-with-agent")).toThrow(
    "init-with-agent requires an agent target other than none.",
  );
});

test("runInit --yes creates config and installs skills without writing in dry-run mode", () => {
  const project = makeProject({
    ".agents/skills/.keep": "",
    "docs/specs/cli.md": "# CLI\n",
    "src/app.ts": "export const app = 1;\n",
  });
  try {
    const c = capture();
    const code = runInit(
      { root: project, yes: true, dryRun: true, force: false, agentTarget: undefined },
      c.io,
      { prompts: nonInteractivePrompts, packageRoot: resolvePackageRoot() },
    );

    expect(code).toBe(0);
    expect(c.out).toContain("would create docbridge.config.json");
    expect(c.out).toContain(".agents/skills/docbridge");
    expect(existsSync(join(project, "docbridge.config.json"))).toBe(false);
  } finally {
    rmSync(project, { recursive: true, force: true });
  }
});

test("runInit --yes writes config and skills", () => {
  const project = makeProject({
    ".agents/skills/.keep": "",
    "docs/specs/cli.md": "# CLI\n",
    "src/app.ts": "export const app = 1;\n",
  });
  try {
    const c = capture();
    const code = runInit(
      { root: project, yes: true, dryRun: false, force: false, agentTarget: undefined },
      c.io,
      { prompts: nonInteractivePrompts, packageRoot: resolvePackageRoot() },
    );

    expect(code).toBe(0);
    expect(existsSync(join(project, "docbridge.config.json"))).toBe(true);
    expect(existsSync(join(project, ".agents/skills/docbridge/SKILL.md"))).toBe(true);
    expect(JSON.parse(readFileSync(join(project, "docbridge.config.json"), "utf8"))).toMatchObject({
      include: {
        code: { typescript: { patterns: ["src/**/*.ts"] } },
        docs: ["docs/specs/**/*.md"],
      },
    });
  } finally {
    rmSync(project, { recursive: true, force: true });
  }
});

test("runInitWithAgent prints agent guidance and skips config creation", () => {
  const project = makeProject({ ".claude/skills/.keep": "" });
  try {
    const c = capture();
    const code = runInitWithAgent(
      { root: project, yes: true, dryRun: true, force: false, agentTarget: undefined },
      c.io,
      { prompts: nonInteractivePrompts, packageRoot: resolvePackageRoot() },
    );

    expect(code).toBe(0);
    expect(c.out).toContain(".claude/skills/docbridge/");
    expect(c.out).toContain("/docbridge adopt DocBridge in this repository");
    expect(c.out).toContain("docbridge");
    expect(c.out).not.toContain("Config:");
    expect(c.out).not.toContain("would create docbridge.config.json");
  } finally {
    rmSync(project, { recursive: true, force: true });
  }
});

test("runInitWithAgent --yes without an agent directory exits with a target-required message", () => {
  const project = makeProject({});
  try {
    const c = capture();
    const code = runInitWithAgent(
      { root: project, yes: true, dryRun: true, force: false, agentTarget: undefined },
      c.io,
      { prompts: nonInteractivePrompts, packageRoot: resolvePackageRoot() },
    );

    expect(code).toBe(1);
    expect(c.out).toContain("explicit agent target");
  } finally {
    rmSync(project, { recursive: true, force: true });
  }
});

test("run enters interactive init setup without --yes", () => {
  const project = makeProject({
    ".agents/skills/.keep": "",
    "docs/specs/cli.md": "# CLI\n",
    "src/app.ts": "export const app = 1;\n",
  });
  try {
    const c = capture();
    const code = run(["init", "--root", project, "--dry-run", "--agent-target", "codex"], c.io, {
      prompts: interactivePrompts,
    });

    expect(code).toBe(0);
    expect(c.out).toContain("would create docbridge.config.json");
    expect(c.err).not.toContain("Interactive setup requires a TTY");
  } finally {
    rmSync(project, { recursive: true, force: true });
  }
});

test("runInitWithAgent enters interactive setup without confirming docs scope", () => {
  const project = makeProject({ ".agents/skills/.keep": "" });
  try {
    const c = capture();
    const code = runInitWithAgent(
      { root: project, yes: false, dryRun: true, force: false, agentTarget: undefined },
      c.io,
      { prompts: interactivePrompts, packageRoot: resolvePackageRoot() },
    );

    expect(code).toBe(0);
    expect(c.out).toContain(".agents/skills/docbridge/");
    expect(c.out).not.toContain("Config:");
  } finally {
    rmSync(project, { recursive: true, force: true });
  }
});

test("run dispatches init commands through the CLI boundary", () => {
  const project = makeProject({
    ".agents/skills/.keep": "",
    "docs/specs/cli.md": "# CLI\n",
    "src/app.ts": "export const app = 1;\n",
  });
  try {
    const c = capture();
    const code = run(
      ["init", "--root", project, "--yes", "--dry-run", "--agent-target", "codex"],
      c.io,
    );

    expect(code).toBe(0);
    expect(c.out).toContain("would create docbridge.config.json");
    expect(c.out).toContain(".agents/skills/docbridge");
  } finally {
    rmSync(project, { recursive: true, force: true });
  }
});

test("run help documents init commands", () => {
  const c = capture();
  run(["--help"], c.io);
  expect(c.out).toContain("docbridge init");
  expect(c.out).toContain("docbridge init-with-agent");
  expect(c.out).toContain("Init options:");
});

test("runInit --force removes leftover legacy skill directories", () => {
  const project = makeProject({
    ".agents/skills/docbridge-adopt/SKILL.md": "# legacy\n",
    ".agents/skills/docbridge-annotate/SKILL.md": "# legacy\n",
    ".agents/skills/docbridge-link/SKILL.md": "# legacy\n",
    ".agents/skills/docbridge-review/SKILL.md": "# legacy\n",
    ".agents/skills/docbridge-sync/SKILL.md": "# legacy\n",
    "docs/specs/cli.md": "# CLI\n",
    "src/app.ts": "export const app = 1;\n",
  });
  try {
    const c = capture();
    const code = runInit(
      { root: project, yes: true, dryRun: false, force: true, agentTarget: "codex" },
      c.io,
      { prompts: nonInteractivePrompts, packageRoot: resolvePackageRoot() },
    );

    expect(code).toBe(0);
    expect(existsSync(join(project, ".agents/skills/docbridge/SKILL.md"))).toBe(true);
    expect(existsSync(join(project, ".agents/skills/docbridge-adopt"))).toBe(false);
    expect(existsSync(join(project, ".agents/skills/docbridge-annotate"))).toBe(false);
    expect(c.out).toContain("remove .agents/skills/docbridge-adopt");
  } finally {
    rmSync(project, { recursive: true, force: true });
  }
});

test("runInit leaves leftover legacy skill directories without --force", () => {
  const project = makeProject({
    ".agents/skills/docbridge-adopt/SKILL.md": "# legacy\n",
    "docs/specs/cli.md": "# CLI\n",
    "src/app.ts": "export const app = 1;\n",
  });
  try {
    const c = capture();
    const code = runInit(
      { root: project, yes: true, dryRun: false, force: false, agentTarget: "codex" },
      c.io,
      { prompts: nonInteractivePrompts, packageRoot: resolvePackageRoot() },
    );

    expect(code).toBe(0);
    expect(existsSync(join(project, ".agents/skills/docbridge/SKILL.md"))).toBe(true);
    expect(existsSync(join(project, ".agents/skills/docbridge-adopt/SKILL.md"))).toBe(true);
    expect(c.out).toContain("docbridge-adopt");
    expect(c.out).not.toContain("remove .agents/skills/docbridge-adopt");
  } finally {
    rmSync(project, { recursive: true, force: true });
  }
});

test("runInit --force leaves a symlinked legacy skill directory in place", () => {
  const project = makeProject({
    "docs/specs/cli.md": "# CLI\n",
    "src/app.ts": "export const app = 1;\n",
  });
  const target = mkdtempSync(join(tmpdir(), "docbridge-legacy-link-"));
  try {
    mkdirSync(join(project, ".agents/skills"), { recursive: true });
    writeFileSync(join(target, "SKILL.md"), "# linked\n");
    symlinkSync(target, join(project, ".agents/skills/docbridge-adopt"));

    const c = capture();
    const code = runInit(
      { root: project, yes: true, dryRun: false, force: true, agentTarget: "codex" },
      c.io,
      { prompts: nonInteractivePrompts, packageRoot: resolvePackageRoot() },
    );

    expect(code).toBe(0);
    expect(existsSync(join(project, ".agents/skills/docbridge-adopt/SKILL.md"))).toBe(true);
    expect(c.out).toContain("symlink");
  } finally {
    rmSync(project, { recursive: true, force: true });
    rmSync(target, { recursive: true, force: true });
  }
});

test("runInit --force leaves a symlinked docbridge skill directory in place", () => {
  const project = makeProject({
    "docs/specs/cli.md": "# CLI\n",
    "src/app.ts": "export const app = 1;\n",
  });
  const target = mkdtempSync(join(tmpdir(), "docbridge-skill-link-"));
  try {
    mkdirSync(join(project, ".agents/skills"), { recursive: true });
    writeFileSync(join(target, "SKILL.md"), "# linked\n");
    symlinkSync(target, join(project, ".agents/skills/docbridge"));

    const c = capture();
    const code = runInit(
      { root: project, yes: true, dryRun: false, force: true, agentTarget: "codex" },
      c.io,
      { prompts: nonInteractivePrompts, packageRoot: resolvePackageRoot() },
    );

    expect(code).toBe(0);
    expect(readFileSync(join(project, ".agents/skills/docbridge/SKILL.md"), "utf8")).toBe(
      "# linked\n",
    );
    expect(c.out).toContain("symlink");
    expect(existsSync(join(project, "docbridge.config.json"))).toBe(true);
  } finally {
    rmSync(project, { recursive: true, force: true });
    rmSync(target, { recursive: true, force: true });
  }
});
