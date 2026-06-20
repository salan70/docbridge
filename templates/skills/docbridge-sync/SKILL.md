---
name: docbridge-sync
description: Triage DocBridge related-gate findings — linked counterparts of changed files that were not themselves updated. Use when a Stop-hook message, CI comment, or docbridge related --gate run flags unchanged counterparts, to judge divergence with docbridge context and then update or justify each one.
---

# docbridge-sync

Resolve `docbridge related --gate` findings. A gate violation means a changed
file has a linked counterpart that nobody updated — it does **not** mean the
counterpart must change; it means nobody has decided yet. This skill makes
that decision explicit, per counterpart.

Run DocBridge with the project's native invocation: `docbridge` on `PATH`, a
repo recipe such as `just related-gate`, or
`bun run /path/to/docbridge/src/cli/index.ts`.

## Procedure

1. **Collect the violations.** Use the gate report you were given (Stop-hook
   message, CI comment), or produce one over the change set:

   ```sh
   git diff --name-only HEAD | docbridge related --stdin --gate
   ```

   Each violation names a changed endpoint and its unchanged counterpart
   endpoint.

2. **Fetch the counterpart content.** If the report did not include it, run
   the context command over the changed files; its output is the counterparts'
   content:

   ```sh
   git diff --name-only HEAD | docbridge context --stdin
   ```

   Read the block for each flagged counterpart: the full spec section for a
   doc counterpart, the full declaration including JSDoc for a code one.

3. **Judge divergence, per counterpart.** Compare what the counterpart says
   with what the change did:
   - Behavior, contract, format, or constraint described by the counterpart no
     longer matches → **update the counterpart** in the same change set.
   - The change is internal (refactoring, comments, test-only, formatting) and
     every documented statement still holds → **no update**, with a written
     justification.
   - The link itself is wrong (points at the wrong section or symbol) → fix
     the annotation pair instead; follow the `docbridge-annotate` skill.

4. **Re-run the gate** after updates. Counterparts you edited leave the
   violation list; what remains must be covered by justifications.

5. **Report every decision.** In the final response (and the PR description
   when one exists), list each flagged counterpart with either the update made
   or the justification. A justification must reference the counterpart's
   actual content ("the section documents the exit codes, which this change
   does not alter"), not just assert irrelevance.

## Principles

- Never silence a violation by deleting or rewriting annotations to detach
  the link; that defeats the graph the gate protects.
- Do not rubber-stamp: if the counterpart content was not read, the judgment
  has no basis.
- Updating a spec section to match changed code is a *decision about the
  contract*, not bookkeeping — when the change contradicts an explicit
  documented promise, surface it to the user instead of quietly rewriting the
  promise.
