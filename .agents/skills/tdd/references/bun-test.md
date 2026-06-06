# Bun Test TDD Reference

Use this reference with the `tdd` skill when writing or reviewing SpecLink tests.

## Running

```bash
# Run the whole test suite through the repo-native command.
just test

# Run Bun tests directly.
bun test

# Run a specific test file.
bun test src/scanner/scanner.test.ts

# Run tests matching a name pattern.
bun test --test-name-pattern "reports missing Markdown anchors"
```

During Red-Green-Refactor, prefer the narrowest command that proves the current
behavior. Before completion, run the broader `just` command or commands relevant
to the changed surface.

## Modifiers

Use Bun's test API from `bun:test`:

```typescript
import { describe, expect, test } from "bun:test";
```

Use built-in modifiers instead of commenting out or deleting tests:

- `test.todo("description")` for a planned behavior.
- `test.skip("description", () => { ... })` only for a blocked test with a clear
  reason.
- `test.only("description", () => { ... })` only while focusing locally. Remove
  it before finishing.
- `describe(...)` to group tests by public API, command, or behavior family.

## Red-Green Example

```typescript
import { describe, expect, test } from "bun:test";
import { scanTypeScriptDocs } from "./scanner";

describe(scanTypeScriptDocs, () => {
	test.todo("collects @doc targets from exported functions");
	test.todo("reports a diagnostic for malformed @doc annotations");

	test("ignores files without JSDoc @doc annotations", () => {
		const source = "export function login() { return true; }";

		expect(scanTypeScriptDocs(source)).toEqual([]);
	});
});
```

## Expected Failures

Avoid `try`/`catch` when the expected behavior is an exception or rejection.
Assert the thrown error directly:

```typescript
test("rejects invalid configuration JSON", async () => {
	await expect(loadConfig("bad.json")).rejects.toThrow(Error);
});
```

## Branching

Avoid `if` branches inside test bodies. Split separate behaviors into separate
tests:

```typescript
test("prints diagnostics as human-readable text", () => {
	const output = formatDiagnostics(diagnostics, { json: false });

	expect(output).toContain("missing-doc-target");
});

test("prints diagnostics as JSON", () => {
	const output = formatDiagnostics(diagnostics, { json: true });

	expect(JSON.parse(output)).toEqual({ diagnostics });
});
```

Use table tests only when each row proves the same behavior:

```typescript
test.each([
	["@doc docs/specs/cli.md#check", "docs/specs/cli.md"],
	["@doc ./docs/specs/scanning.md", "./docs/specs/scanning.md"],
])("extracts the documentation target from %s", (annotation, expectedTarget) => {
	expect(parseDocAnnotation(annotation)?.target).toBe(expectedTarget);
});
```

## Helpers And Values

Avoid helper functions that hide the behavior or the assertion. Prefer explicit
setup in the test body:

```typescript
test("reports missing code targets referenced from Markdown", () => {
	const markdown = "<!-- @code src/core/missing.ts#missing -->";

	expect(scanMarkdownCodeLinks(markdown)).toEqual([
		{
			kind: "missing-code-target",
			target: "src/core/missing.ts#missing",
		},
	]);
});
```

Do not hoist one-off literals out of a test. Keep fixture data close to the
behavior it exercises. Shared builders are acceptable only when they remove
irrelevant noise without hiding assertions.
