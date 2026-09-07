import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dir, "..");

function read(path: string): string {
  return readFileSync(join(root, path), "utf8");
}

function fieldIds(path: string): string[] {
  return [...read(path).matchAll(/^\s{4}id: (.+)$/gm)].map((match) => match[1] ?? "");
}

type IssueForm = {
  body?: Array<{
    id?: string;
    validations?: { required?: boolean };
  }>;
};

test.each([
  [
    ".github/ISSUE_TEMPLATE/bug_report.yml",
    [
      "existing-issues",
      "problem",
      "reproduction",
      "expected",
      "version",
      "runtime",
      "environment",
      "notes",
      "contribution",
    ],
  ],
  [
    ".github/ISSUE_TEMPLATE/feature_proposal.yml",
    [
      "existing-issues",
      "problem-evidence",
      "desired-outcome",
      "alternatives",
      "boundaries",
      "acceptance",
      "notes",
    ],
  ],
  [
    ".github/ISSUE_TEMPLATE/technical_proposal.yml",
    [
      "existing-issues",
      "area",
      "problem-constraints",
      "proposal-tradeoffs",
      "boundaries-compatibility",
      "acceptance-verification",
      "notes",
    ],
  ],
  [
    ".github/ISSUE_TEMPLATE/documentation_issue.yml",
    [
      "existing-issues",
      "location-audience",
      "problem-evidence",
      "reader-outcome",
      "acceptance-counterparts",
      "notes",
    ],
  ],
  [
    ".github/ISSUE_TEMPLATE/maintenance_task.yml",
    ["existing-issues", "objective-evidence", "boundaries", "acceptance-verification", "risks"],
  ],
] as const)("%s exposes only distinct information fields", (path, expectedIds) => {
  expect(fieldIds(path)).toEqual([...expectedIds]);
});

test("optional issue notes and risks do not force filler", () => {
  for (const path of [
    ".github/ISSUE_TEMPLATE/bug_report.yml",
    ".github/ISSUE_TEMPLATE/feature_proposal.yml",
    ".github/ISSUE_TEMPLATE/technical_proposal.yml",
    ".github/ISSUE_TEMPLATE/documentation_issue.yml",
    ".github/ISSUE_TEMPLATE/maintenance_task.yml",
  ]) {
    const source = read(path);
    const optionalSection =
      /\n  - type: textarea\n    id: (?:notes|risks)\n([\s\S]*?)(?=\n  - type:|$)/.exec(
        source,
      )?.[1];

    expect(optionalSection).toBeDefined();
    expect(optionalSection).not.toContain("required: true");
  }
});

test("all issue forms are valid YAML with required decision fields", () => {
  for (const path of [
    ".github/ISSUE_TEMPLATE/bug_report.yml",
    ".github/ISSUE_TEMPLATE/feature_proposal.yml",
    ".github/ISSUE_TEMPLATE/technical_proposal.yml",
    ".github/ISSUE_TEMPLATE/documentation_issue.yml",
    ".github/ISSUE_TEMPLATE/maintenance_task.yml",
  ]) {
    const form = Bun.YAML.parse(read(path)) as IssueForm;
    const fields = form.body?.filter(({ id }) => id !== undefined) ?? [];

    expect(fields.length).toBeGreaterThan(0);
    for (const field of fields) {
      if (field.id === "existing-issues" || field.id === "notes" || field.id === "risks") {
        continue;
      }
      expect(field.validations?.required).toBeTrue();
    }
  }
});

test("the pull request template keeps issue context out of its summary", () => {
  const template = read(".github/pull_request_template.md");

  expect(template).toContain("Describe the delivered result in no more than three bullets");
  expect(template).toContain("Do not repeat the issue background or acceptance criteria");
  expect(template).toContain("## Verification");
  expect(template).toContain("## Review notes");
  expect(template).not.toContain("## Notes");
});
