import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
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
