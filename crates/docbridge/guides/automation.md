# Automation

Use `docbridge validate` to check structural consistency in CI or a hook. It exits 0 on success and 1 on errors. Unlinked items are not errors, so inspect `docbridge unlinked` separately when coverage matters.

Use `docbridge links` to provide directly related files and sections for a human or AI semantic review. `--include-content` includes full, untruncated content. For structured consumers, `--json` returns nodes and edges. Handle partial success exit 2 and stderr warnings before treating the result as complete.

The old `related --gate` workflow is not part of vNext. Structural checks cannot decide whether code and documentation mean the same thing, so keep semantic review as an explicit separate step. With `--json`, warnings and errors go to stderr and stdout stays valid JSON.
