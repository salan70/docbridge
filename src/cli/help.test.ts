import { expect, test } from "bun:test";

import { commandOptionFlags } from "./help";
import { run } from "./index";
import { capture } from "./test-support";

const COMMANDS = [
  "check",
  "related",
  "context",
  "graph",
  "docs",
  "init",
  "init-with-agent",
  "lsp",
] as const;

for (const command of COMMANDS) {
  test(`run prints ${command} help for --help and exits 0`, () => {
    const c = capture();
    const code = run([command, "--help"], c.io);

    expect(code).toBe(0);
    expect(c.out).toContain(`docbridge ${command}`);
    expect(c.out).toContain("Usage:");
    expect(c.err).toBe("");
  });

  test(`run prints ${command} help for -h and exits 0`, () => {
    const c = capture();
    const code = run([command, "-h"], c.io);

    expect(code).toBe(0);
    expect(c.out).toContain(`docbridge ${command}`);
    expect(c.err).toBe("");
  });

  test(`${command} help states when to use the command`, () => {
    const c = capture();
    run([command, "--help"], c.io);

    const description = c.out.split("Description:")[1] ?? "";
    expect(description).toContain("Use ");
  });

  test(`${command} help documents --help itself`, () => {
    const c = capture();
    run([command, "--help"], c.io);

    expect(c.out).toContain("--help, -h");
  });
}

test("run honors --help before validating other options", () => {
  const c = capture();
  const code = run(["context", "--nonexistent", "--help"], c.io);

  expect(code).toBe(0);
  expect(c.out).toContain("docbridge context");
  expect(c.err).toBe("");
});

test("run honors --help before rejecting positional arguments", () => {
  const c = capture();
  const code = run(["init", "stray", "-h"], c.io);

  expect(code).toBe(0);
  expect(c.out).toContain("docbridge init");
  expect(c.err).toBe("");
});

test("run keeps global help for --help without a command", () => {
  const c = capture();
  const code = run(["--help"], c.io);

  expect(code).toBe(0);
  expect(c.out).toContain("docbridge check");
  expect(c.out).toContain("docbridge graph");
});

function globalCommandSummary(out: string, command: string): string {
  const commands = out.split("Commands:")[1]?.split("Run `docbridge")[0] ?? "";
  const line = commands.split("\n").find((entry) => entry.trim().startsWith(`${command} `));
  return (line ?? "").trim().slice(command.length).trim();
}

for (const command of COMMANDS) {
  test(`global help says when to use ${command}`, () => {
    const c = capture();
    run(["--help"], c.io);

    expect(globalCommandSummary(c.out, command)).toStartWith("Use ");
  });
}

test("global help gives related, context, and graph distinct when-to-use summaries", () => {
  const c = capture();
  run(["--help"], c.io);

  const summaries = ["related", "context", "graph"].map((command) =>
    globalCommandSummary(c.out, command),
  );

  expect(new Set(summaries).size).toBe(3);
  for (const summary of summaries) {
    expect(summary.length).toBeGreaterThan(20);
  }
});

test("run still rejects unknown commands", () => {
  const c = capture();
  const code = run(["nope", "--help"], c.io);

  expect(code).toBe(1);
  expect(c.err).toContain("Unknown command: nope");
});

for (const command of COMMANDS) {
  test(`${command} help renders every declared flag`, () => {
    const c = capture();
    run([command, "--help"], c.io);

    const flags = commandOptionFlags(command);
    for (const flag of flags) {
      expect(c.out).toContain(flag);
    }
  });
}
