# Automation

Use `docbridge validate` to check structural consistency in CI or a hook. Its success and error exit values are 0 and 1. Unlinked items are not errors, so inspect `docbridge unlinked` separately when coverage matters.

Use `docbridge links` to provide directly related files and sections for a human or AI semantic review. `--include-content` includes full, untruncated content. For structured consumers, `--json` returns nodes and edges. Handle partial success exit 2 and stderr warnings before treating the result as complete.

The old `related --gate` workflow is not part of vNext. Structural checks cannot decide whether code and documentation mean the same thing. Keep semantic review as an explicit separate step. JSON warnings and errors go to stderr, leaving stdout valid JSON; query output includes diagnostics and a `complete` flag.
