---
name: speclink-link
description: Link existing Markdown specification sections to existing TypeScript exports. Use for docs-first candidate discovery, section-level confirmation, and adding @doc/@code annotations to existing projects.
---

# speclink-link

Create SpecLink annotations for existing docs and code. Work docs-first: choose
Markdown sections that look like specifications, then propose TypeScript
exported symbols that implement or represent each section.

Run SpecLink with the project's native invocation: `speclink` on `PATH`, a
repo recipe such as `just check`, or
`bun run /path/to/spec-link/src/cli/index.ts`.

## Procedure

1. **Determine docs scope.** Use the scope confirmed by `speclink-adopt` when
   available. Otherwise, inspect the repository and ask the user to confirm the
   docs directories/files before proposing links.

2. **Find section candidates.**
   - Prioritize unlinked sections.
   - Include already linked sections at lower priority when an additional link
     may be justified.
   - Ignore sections that are clearly prose-only, changelog entries, runbook
     steps, or project process unless the user says they are specifications.

3. **For each candidate section, propose up to three code symbols.** Base the
   ranking on:
   - heading text and section body
   - exported symbol names
   - existing JSDoc and nearby comments
   - file paths and directory names
   - implementation body only when the surrounding information is insufficient

   Include both:
   - why the symbol may match
   - what remains uncertain

4. **Ask for section-level decisions.** Present 5-10 section candidates at a
   time. For each section the user can choose:
   - adopt: select one or more code symbols to link
   - exclude: do not link this section
   - hold: keep undecided for later

   The user may also name a symbol not in the proposed top three.

5. **Classify no-match sections.** If no reasonable exported symbol exists,
   report the likely reason instead of forcing a link:
   - not implemented yet
   - spans multiple symbols without a clear public representative
   - likely stale docs
   - not a specification section
   - target appears internal or not exported

6. **Add annotations only after confirmation.**
   - Add `@code` directly above the Markdown heading, as the nearest comment
     to the heading.
   - Add `@doc` to the TypeScript declaration JSDoc.
   - If the declaration has no JSDoc, create a minimal JSDoc block containing
     only `@doc`.
   - If the pair already exists on one side, show it and, after confirmation,
     add the missing backlink.
   - Preserve existing annotations; do not replace or clean up suspicious links
     in this skill.

7. **Verify.** Run `speclink check`, then inspect the affected links with
   `speclink context` or `speclink graph --json --include-content` for the
   changed files. Report any remaining diagnostics or semantic uncertainty.

## Boundaries

- Do not split Markdown sections or rename headings. If a section is too broad
  or ambiguous, classify it as held or no-match.
- Multiple code symbols may link to one docs section when each role is clear.
- One code symbol may link to multiple docs sections when each section covers a
  distinct specification aspect.
- Do not link solely because names are similar.
