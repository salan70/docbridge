---
name: docbridge-review
description: Review all existing DocBridge links for semantic validity. Use after adoption or periodically to find valid-but-wrong links, stale docs, excessive links, or ambiguous docs/code relationships.
---

# docbridge-review

Review the semantic validity of the entire DocBridge graph. This is not a
change-set or pull-request review. It checks whether valid links actually
connect a docs section to the code symbol that implements or represents that
specification.

This skill requires `docbridge graph --json --include-content`.

## Procedure

1. **Build the graph.**

   ```sh
   docbridge graph --json --include-content
   ```

   If the repository uses a wrapper, use the native invocation instead. Read
   `diagnostics` first. Mechanical failures from `docbridge check` should be
   fixed or acknowledged before relying on semantic findings.

2. **Batch by docs file.** Review all links, but process them in batches:
   - docs file is the default batch boundary
   - split a batch further when it contains too many sections or links
   - keep notes so repeated patterns are applied consistently across batches

3. **Read both sides.**
   - For docs nodes, use the graph range to read the full Markdown section.
   - For code nodes, start with graph content: JSDoc plus signature. Read the
     implementation only when necessary to judge the relationship.
   - Compare behavior, contract, input/output, constraints, and design intent.

4. **Classify findings.**
   - High: clearly wrong link, stale docs fixed in place by a link, or a link
     to a section that is not a specification.
   - Medium: partial overlap, unclear representative symbol, overly broad
     section, or multiple linked symbols with ambiguous roles.
   - Low: cleanup opportunity, duplicate docs, excessive links, or missing
     explanation of why multiple links are needed.

5. **Report findings and fixes.** For each finding include:
   - severity
   - doc endpoint and code endpoint
   - evidence from both sides
   - recommended fix

   Do not edit annotations automatically. If the user approves a fix, use
   `docbridge-link` or `docbridge-annotate` rules to make the change.

## Principles

- `docbridge check` proves link mechanics; this skill reviews meaning.
- Do not rubber-stamp links because the target resolves.
- Do not delete annotations merely to silence uncertainty. Explain the
  uncertainty and ask for a decision.
- Prefer fewer, clearer links over broad many-to-many links without explicit
  roles.
