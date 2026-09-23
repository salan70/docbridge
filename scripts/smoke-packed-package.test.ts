import { expect, test } from "bun:test";
import { chmodSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  assertDocumentationCommands,
  assertInstalledScannerExecutables,
  assertUpgradeCommand,
  type CommandResult,
} from "./smoke-packed-package";

test("assertInstalledScannerExecutables rejects installed scanner binaries without executable bits", () => {
  const root = mkdtempSync(join(tmpdir(), "docbridge-pack-smoke-"));
  try {
    const scanner = join(
      root,
      "node_modules/docbridge/dist/bin/darwin-arm64/docbridge-swift-scanner",
    );
    mkdirSync(join(scanner, ".."), { recursive: true });
    writeFileSync(scanner, "#!/bin/sh\n");
    chmodSync(scanner, 0o644);

    expect(() => assertInstalledScannerExecutables(root)).toThrow(
      "node_modules/docbridge/dist/bin/darwin-arm64/docbridge-swift-scanner is not executable",
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("assertDocumentationCommands covers canonical and rejected document names", () => {
  const commands: string[][] = [];
  const canonical = [
    "automation",
    "commands",
    "configuration",
    "getting-started",
    "linking",
    "troubleshooting",
  ];
  const legacyNames = ["annotations", "linking-workflow", "link-review", "agent-integration"];
  const execute = (args: string[]): CommandResult => {
    commands.push(args);
    if (args.join(" ") === "docs list --json") {
      return {
        exitCode: 0,
        stdout: JSON.stringify({
          documents: canonical.map((name) => ({ name, description: `${name} guide` })),
          help: "help",
        }),
        stderr: "",
      };
    }
    const name = args[2] ?? "";
    if (name === "missing" || legacyNames.includes(name)) {
      return {
        exitCode: 1,
        stdout: "",
        stderr: [
          `Error: Unknown documentation name: ${name}`,
          "",
          "Available names:",
          `  ${canonical.join(", ")}`,
          "",
          "Run `docbridge docs show <name>` to read a document.",
          "",
        ].join("\n"),
      };
    }
    return {
      exitCode: 0,
      stdout: `# ${name}\n`,
      stderr: "",
    };
  };

  assertDocumentationCommands(execute);

  expect(commands).toHaveLength(12);
  expect(commands).toContainEqual(["docs", "show", "annotations"]);
  expect(commands).toContainEqual(["docs", "show", "missing"]);
});

test("assertDocumentationCommands rejects noncanonical names exposed by docs list", () => {
  expect(() =>
    assertDocumentationCommands(
      (): CommandResult => ({
        exitCode: 0,
        stdout: JSON.stringify({
          documents: [
            { name: "getting-started", description: "Start" },
            { name: "annotations", description: "Legacy" },
          ],
          help: "help",
        }),
        stderr: "",
      }),
    ),
  ).toThrow("docs list returned non-canonical names");
});

const upgradeCheckOutput = [
  "DocBridge 0.8.0 (latest stable: unknown)",
  "Status: unknown",
  "",
  "Managed skills:",
  "- .claude/skills/docbridge: absent",
  "",
  "Legacy skills:",
  "- .claude/skills/docbridge-adopt (directory)",
  "",
].join("\n");

type UpgradeStubOptions = {
  checkStdout?: string;
  installsSkill?: boolean;
  removesLegacy?: boolean;
  applyExitCode?: number;
};

function upgradeStub(options: UpgradeStubOptions = {}) {
  const state = { legacy: true, managed: false };
  const commands: string[][] = [];
  const execute = (args: string[]): CommandResult => {
    commands.push(args);
    if (args.includes("--check")) {
      return { exitCode: 0, stdout: options.checkStdout ?? upgradeCheckOutput, stderr: "" };
    }
    state.managed = options.installsSkill ?? true;
    state.legacy = !(options.removesLegacy ?? true);
    return { exitCode: options.applyExitCode ?? 0, stdout: "", stderr: "" };
  };
  const exists = (path: string) =>
    path.endsWith("docbridge-adopt") ? state.legacy : state.managed;
  return { commands, execute, exists };
}

test("assertUpgradeCommand accepts a read-only check followed by a forced migration", () => {
  const stub = upgradeStub();

  assertUpgradeCommand({ execute: stub.execute, fixtureRoot: "/fixture", exists: stub.exists });

  expect(stub.commands).toEqual([
    ["upgrade", "--check", "--root", "/fixture"],
    ["upgrade", "--force", "--yes", "--root", "/fixture"],
  ]);
});

test("assertUpgradeCommand rejects a check that plans operations", () => {
  const stub = upgradeStub({ checkStdout: `${upgradeCheckOutput}\nOperations:\n- create x\n` });

  expect(() =>
    assertUpgradeCommand({ execute: stub.execute, fixtureRoot: "/fixture", exists: stub.exists }),
  ).toThrow("must stay read-only");
});

test("assertUpgradeCommand rejects a check that omits the managed skill state", () => {
  const stub = upgradeStub({ checkStdout: "DocBridge 0.8.0 (latest stable: unknown)\n" });

  expect(() =>
    assertUpgradeCommand({ execute: stub.execute, fixtureRoot: "/fixture", exists: stub.exists }),
  ).toThrow("upgrade --check did not report");
});

test("assertUpgradeCommand rejects a migration that installs no skill", () => {
  const stub = upgradeStub({ installsSkill: false });

  expect(() =>
    assertUpgradeCommand({ execute: stub.execute, fixtureRoot: "/fixture", exists: stub.exists }),
  ).toThrow("did not install the managed docbridge skill");
});

test("assertUpgradeCommand rejects a migration that keeps the legacy directory", () => {
  const stub = upgradeStub({ removesLegacy: false });

  expect(() =>
    assertUpgradeCommand({ execute: stub.execute, fixtureRoot: "/fixture", exists: stub.exists }),
  ).toThrow("did not remove the legacy skill directory");
});
