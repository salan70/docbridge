import { expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "../..");
const DOCS_CLI = "docbridge";
const REPO_CLI = "nix develop -c bun run src/cli/index.ts";

const RECIPE_STEPS = [
  "Derive the PR changed-file list",
  "Run related-gate over the PR change set",
  "Create or update the sticky PR comment",
] as const;

function extractFencedYaml(markdown: string, afterHeading: string): string {
  const headingIndex = markdown.indexOf(afterHeading);
  expect(headingIndex).toBeGreaterThanOrEqual(0);
  const fromHeading = markdown.slice(headingIndex);
  const fenceStart = fromHeading.indexOf("```yaml\n");
  expect(fenceStart).toBeGreaterThanOrEqual(0);
  const bodyStart = fenceStart + "```yaml\n".length;
  const fenceEnd = fromHeading.indexOf("\n```", bodyStart);
  expect(fenceEnd).toBeGreaterThan(bodyStart);
  return fromHeading.slice(bodyStart, fenceEnd);
}

function extractJobYaml(workflow: string, jobId: string): string {
  const jobHeader = `  ${jobId}:\n`;
  const start = workflow.indexOf(jobHeader);
  expect(start).toBeGreaterThanOrEqual(0);
  const fromJob = workflow.slice(start + jobHeader.length);
  const nextJob = fromJob.search(/\n  [a-z0-9-]+:\n/);
  return nextJob === -1 ? fromJob : fromJob.slice(0, nextJob);
}

function extractRunBody(yaml: string, stepName: string): string {
  const nameLine = `- name: ${stepName}`;
  const nameIndex = yaml.indexOf(nameLine);
  expect(nameIndex).toBeGreaterThanOrEqual(0);
  const fromName = yaml.slice(nameIndex);
  const runIndex = fromName.indexOf("run: |\n");
  expect(runIndex).toBeGreaterThanOrEqual(0);
  const bodyStart = runIndex + "run: |\n".length;
  const lines = fromName.slice(bodyStart).split("\n");
  const firstContent = lines.find((line) => line.trim().length > 0);
  expect(firstContent).toBeDefined();
  if (firstContent === undefined) {
    throw new Error(`empty run body for step ${stepName}`);
  }
  const indentMatch = /^[ \t]*/.exec(firstContent);
  const indent = indentMatch?.[0] ?? "";
  expect(indent.length).toBeGreaterThan(0);

  const bodyLines: string[] = [];
  for (const line of lines) {
    if (line.length === 0) {
      bodyLines.push("");
      continue;
    }
    if (!line.startsWith(indent) && line.trim().length > 0) {
      break;
    }
    if (line.startsWith(indent)) {
      bodyLines.push(line.slice(indent.length));
    } else {
      bodyLines.push("");
    }
  }

  while (bodyLines.length > 0 && bodyLines[bodyLines.length - 1] === "") {
    bodyLines.pop();
  }
  return bodyLines.join("\n");
}

function applyCliSubstitution(docBody: string): string {
  const needle = `${DOCS_CLI} related --stdin --gate`;
  const replacement = `${REPO_CLI} related --stdin --gate`;
  expect(docBody.includes(needle)).toBe(true);
  return docBody.split(needle).join(replacement);
}

test("related-gate CI recipe run bodies stay aligned with docs/integrations/ci.md", () => {
  const docs = readFileSync(join(ROOT, "docs/integrations/ci.md"), "utf8");
  const workflow = readFileSync(join(ROOT, ".github/workflows/ci.yml"), "utf8");

  const docYaml = extractFencedYaml(docs, "## Gate the PR change set");
  const jobYaml = extractJobYaml(workflow, "related-gate-report");

  expect(jobYaml).toContain("fetch-depth: 0");

  for (const stepName of RECIPE_STEPS) {
    const fromDocs = extractRunBody(docYaml, stepName);
    const fromWorkflow = extractRunBody(jobYaml, stepName);
    const expected =
      stepName === "Run related-gate over the PR change set"
        ? applyCliSubstitution(fromDocs)
        : fromDocs;
    expect(fromWorkflow, stepName).toBe(expected);
  }
});

type GateRun = { outcome: string | undefined; reason: string | undefined; report: string };

/**
 * Parse a `$GITHUB_ENV` file the way the runner does: `NAME=value` lines and
 * `NAME<<DELIMITER` blocks that must close with a line equal to the delimiter.
 */
function parseGithubEnv(content: string): Map<string, string> {
  const values = new Map<string, string>();
  const lines = content.split("\n");
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    if (line === "") {
      continue;
    }
    const heredoc = /^([A-Za-z_][A-Za-z0-9_]*)<<(.+)$/.exec(line);
    if (heredoc !== null) {
      const [, name = "", delimiter = ""] = heredoc;
      const end = lines.indexOf(delimiter, index + 1);
      if (end === -1) {
        throw new Error(`unterminated ${name} block in GITHUB_ENV`);
      }
      values.set(name, lines.slice(index + 1, end).join("\n"));
      index = end;
      continue;
    }
    const assignment = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(line);
    if (assignment === null) {
      throw new Error(`malformed GITHUB_ENV line: ${line}`);
    }
    values.set(assignment[1] ?? "", assignment[2] ?? "");
  }
  return values;
}

/**
 * Execute the documented gate step with a stub `docbridge` that prints
 * `stdout` and exits with `status`, the way GitHub Actions runs a `run:` body.
 */
function runDocumentedGateStep(stub: { stdout: string; status: number }): GateRun {
  const docs = readFileSync(join(ROOT, "docs/integrations/ci.md"), "utf8");
  const body = extractRunBody(
    extractFencedYaml(docs, "## Gate the PR change set"),
    "Run related-gate over the PR change set",
  );
  const workDir = mkdtempSync(join(tmpdir(), "docbridge-gate-recipe-"));
  try {
    const binDir = join(workDir, "bin");
    mkdirSync(binDir);
    writeFileSync(join(workDir, "stub-stdout.txt"), stub.stdout);
    writeFileSync(
      join(binDir, "docbridge"),
      `#!/usr/bin/env bash\ncat "${join(workDir, "stub-stdout.txt")}"\necho "stub stderr" >&2\nexit ${stub.status}\n`,
    );
    chmodSync(join(binDir, "docbridge"), 0o755);
    writeFileSync(join(workDir, "changed-files.txt"), "src/auth.ts\n");
    const githubEnv = join(workDir, "github-env");
    writeFileSync(githubEnv, "");

    const result = spawnSync("bash", ["--noprofile", "--norc", "-eo", "pipefail", "-c", body], {
      cwd: workDir,
      env: { ...process.env, PATH: `${binDir}:${process.env.PATH ?? ""}`, GITHUB_ENV: githubEnv },
      encoding: "utf8",
    });
    expect(result.status, result.stderr).toBe(0);

    const env = parseGithubEnv(readFileSync(githubEnv, "utf8"));
    const reportPath = join(workDir, "gate-report.txt");
    return {
      outcome: env.get("GATE_OUTCOME"),
      reason: env.get("INFRA_REASON"),
      report: existsSync(reportPath) ? readFileSync(reportPath, "utf8") : "",
    };
  } finally {
    rmSync(workDir, { recursive: true, force: true });
  }
}

test("documented gate step records clean for exit 0 with a valid empty report", () => {
  const stdout = JSON.stringify({ violations: [], summary: { changedFiles: 1, violations: 0 } });

  expect(runDocumentedGateStep({ stdout, status: 0 }).outcome).toBe("clean");
});

test("documented gate step records a violation only for exit 1 with a valid report", () => {
  const stdout = JSON.stringify({
    violations: [
      {
        changedEndpoint: "src/auth.ts#login",
        changedFilePath: "src/auth.ts",
        counterpartEndpoint: "docs/auth.md#login-flow",
        counterpartFilePath: "docs/auth.md",
      },
    ],
    summary: { changedFiles: 1, violations: 1 },
  });

  const run = runDocumentedGateStep({ stdout, status: 1 });

  expect(run.outcome).toBe("violation");
  expect(run.report).toContain(
    "src/auth.ts#login -> docs/auth.md#login-flow (counterpart not in change set)",
  );
});

test("documented gate step records infra-error for exit 1 without a report", () => {
  expect(runDocumentedGateStep({ stdout: "", status: 1 }).outcome).toBe("infra-error");
});

test("documented gate step records infra-error for exit 0 with unparsable output", () => {
  expect(runDocumentedGateStep({ stdout: "not json\n", status: 0 }).outcome).toBe("infra-error");
});

test("documented gate step records infra-error when the exit status contradicts the report", () => {
  const stdout = JSON.stringify({ violations: [], summary: { changedFiles: 1, violations: 0 } });

  expect(runDocumentedGateStep({ stdout, status: 1 }).outcome).toBe("infra-error");
});

test("documented gate step records infra-error when the summary count disagrees with the violations", () => {
  const stdout = JSON.stringify({ violations: [], summary: { changedFiles: 1, violations: 2 } });

  expect(runDocumentedGateStep({ stdout, status: 1 }).outcome).toBe("infra-error");
});

test("documented gate step records infra-error for an unexpected exit status", () => {
  const stdout = JSON.stringify({ violations: [], summary: { changedFiles: 1, violations: 0 } });

  expect(runDocumentedGateStep({ stdout, status: 2 }).outcome).toBe("infra-error");
});

test("documented gate step records infra-error for a fractional changed-file count", () => {
  const stdout = JSON.stringify({ violations: [], summary: { changedFiles: 1.5, violations: 0 } });

  expect(runDocumentedGateStep({ stdout, status: 0 }).outcome).toBe("infra-error");
});

test("documented gate step keeps the infra-error reason intact for hostile output", () => {
  const run = runDocumentedGateStep({ stdout: "notice\nEOF\nGATE_OUTCOME=clean", status: 1 });

  expect(run.outcome).toBe("infra-error");
  expect(run.reason).toContain("GATE_OUTCOME=clean");
});
