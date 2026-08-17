---
description: Choose what to link and propose candidates docs-first.
---

# Linking Workflow

Choose Markdown sections that look like specifications, then propose supported
code declarations that implement or represent each section. Add annotations
only after a section-level decision.

## What to link

Prefer sections that state behavior, contracts, inputs/outputs, constraints,
user-visible behavior, or design decisions.

Treat README files, changelogs, contribution docs, runbooks, logs, and
release notes as exclusions by default unless a specific section is identified
as a specification.

Prefer supported public API declarations as link targets. TypeScript starts
with top-level exported declarations; Swift, Dart, and Rust also support
member endpoints. Use the scanner-produced canonical ID exactly; see
`docbridge docs show annotations`.

Do not decide project workflow policy such as branch or pull-request
strategy.

## Propose candidates

1. Confirm docs scope first. Inspect the repository and agree the
   documentation directories before proposing links.
2. Find section candidates. Prioritize unlinked sections. Include already
   linked sections at lower priority when an additional link may be justified.
   Ignore prose-only sections, changelog entries, runbook steps, and project
   process unless they are specifications.
3. For each candidate section, propose at most three code symbols. Rank them
   from heading text and section body, exported symbol names, existing
   documentation comments, file paths, and the implementation body only when
   that surrounding information is insufficient. For each symbol, state why it
   may match and what remains uncertain.
4. Present 5–10 section candidates per round. For each section, choose:
   - adopt: select one or more code symbols to link
   - exclude: do not link this section
   - hold: keep undecided for later

   A symbol that is not in the proposed top three may still be named.

5. Classify no-match sections instead of forcing a link:
   - not implemented yet
   - spans multiple symbols without a clear public representative
   - likely stale docs
   - not a specification section
   - target appears internal or not exported

## After confirmation

Add `@code` directly above the Markdown heading and `@doc` on the chosen
declaration. If the declaration has no documentation comment, create a
minimal one containing only `@doc`. If one side already exists, show it and
add the missing backlink after confirmation. Preserve existing annotations;
do not replace or clean up suspicious links in this pass.

Do not split Markdown sections or rename headings. If a section is too broad
or ambiguous, classify it as held or no-match. Multiple code symbols may link
to one docs section when each role is clear. One code symbol may link to
multiple docs sections when each section covers a distinct specification
aspect. Do not link solely because names are similar.

Verify with `docbridge check`, then inspect the affected links with
`docbridge context` or `docbridge graph --json --include-content`.
