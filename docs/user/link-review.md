---
description: Audit existing links for semantic correctness, not just resolution.
---

# Link Review

Audit the semantic validity of the entire DocBridge graph. This is not a
change-set or pull-request review, and it is not `related --gate` triage. It
checks whether valid links actually connect a docs section to the code symbol
that implements or represents that specification.

`docbridge check` proves link mechanics. This review judges meaning. Do not
rubber-stamp a link because the target resolves.

## Procedure

1. Build the graph:

   ```sh
   docbridge graph --json --include-content
   ```

   Read `diagnostics` first. Mechanical failures from `docbridge check`
   should be fixed or acknowledged before relying on semantic findings.

2. Batch by docs file. Review all links, but process them in batches:
   - the docs file is the default batch boundary
   - split a batch further when it contains too many sections or links
   - keep notes so repeated patterns are applied consistently across batches

3. Read both sides.
   - For docs nodes, use the graph range to read the full Markdown section.
   - For code nodes, start with graph content: documentation comment plus
     signature. Read the implementation only when necessary to judge the
     relationship.
   - Compare behavior, contract, input/output, constraints, and design
     intent.

4. Classify findings.
   - High: clearly wrong link, stale docs fixed in place by a link, or a
     link to a section that is not a specification.
   - Medium: partial overlap, unclear representative symbol, overly broad
     section, or multiple linked symbols with ambiguous roles.
   - Low: cleanup opportunity, duplicate docs, excessive links, or missing
     explanation of why multiple links are needed.

5. Report findings. For each finding include severity, the doc endpoint, the
   code endpoint, evidence from both sides, and a recommended fix.

Do not edit annotations automatically. Prefer fewer, clearer links over
broad many-to-many links without explicit roles. Do not delete annotations
merely to silence uncertainty; explain the uncertainty and ask for a
decision.
