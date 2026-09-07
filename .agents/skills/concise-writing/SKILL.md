---
name: concise-writing
description: Create, compress, or review DocBridge issues, pull requests, plans, documentation, and release notes so each artifact is complete without repeating facts owned elsewhere. Do not use for casual conversation or code-only edits.
---

# concise-writing

Produce an artifact whose reader can find the result, evidence, and next action
without rereading the same claim.

## Workflow

1. Read the repository [writing guidelines](../../../docs/contributing/writing.md).
2. Identify the artifact, its reader, and the decision or action it supports.
3. Inspect its sources of truth. For a pull request, read the accepted issue, any
   implementation plan, the diff, and actual verification results. Never infer a
   result that was not observed.
4. Assign each claim to its owning artifact. Link to facts owned elsewhere with
   only enough context to route the reader.
5. Draft the result first. Preserve evidence, safety boundaries, compatibility,
   failure behavior, and verification details that affect decisions.
6. Remove duplicated claims, meta narration, generic openings, repeated
   conclusions, and optional sections with no new information.
7. Recheck the applicable repository template and factual sources.

For issues and pull requests, draft through a body file and run
`just prose-report <kind> <body-file>` before publishing. Treat every warning as
an editing prompt, never as a gate or a reason to delete necessary detail.

Use the matching source for artifact-specific structure:

- Issues: `.github/ISSUE_TEMPLATE/`
- Pull requests: `.github/pull_request_template.md`
- Documentation: `docs/contributing/documentation.md`
- Plans and changelog entries: the ownership rules in the writing guidelines

Do not use AI-word blacklists or authorship detectors. Do not optimize prose to
pass a metric, impose a uniform voice, or invent facts to complete a template.
