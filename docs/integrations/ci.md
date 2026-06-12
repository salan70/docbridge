# CI integration

How to run the SpecLink gate in CI so the pull request — not the agent
session — is the enforcement point for linked counterparts.

The local agent hooks ([Claude Code](claude-code.md), [Codex](codex.md)) are
informational by design: they raise awareness during a session but never
block. CI re-runs the same gate over the whole PR change set, and the human
merge approval enforces the outcome.

## Validate the link graph

Run the checker as a required status check:

```yaml
- name: SpecLink check
  run: speclink check
```

`speclink check` exits `1` on any error diagnostic, so a broken link fails the
job. Add `--json` when a later step consumes the diagnostics.

## Gate the PR change set

Run `speclink related --gate` over the files the PR changes and report the
result. Use the PR file list (not a local diff) so the gate sees exactly what
the reviewer sees:

```yaml
- name: Run related-gate over the PR change set
  env:
    GH_TOKEN: ${{ github.token }}
    PR_NUMBER: ${{ github.event.pull_request.number }}
  run: |
    gh api "repos/${GITHUB_REPOSITORY}/pulls/${PR_NUMBER}/files" --paginate \
      -q '.[].filename' > changed-files.txt
    speclink related --stdin --gate < changed-files.txt
```

The gate exits `1` when a changed file has a linked counterpart that the PR
does not also change. A violation does not necessarily mean the counterpart
must change; it means nobody has decided yet. Two reporting styles:

- **Informational (recommended)** — let the step fail without failing the
  workflow (`continue-on-error: true`) and post the output as a sticky PR
  comment, so the human approving the merge sees which counterparts were not
  updated and can weigh the PR's justification. This repository's
  [`ci.yml`](../../.github/workflows/ci.yml) (`related-gate-report` job)
  implements this, including the create-or-update comment logic.
- **Blocking** — make the step required, forcing every PR to either update
  counterparts or carve them out of the gate. Only adopt this once the link
  graph is dense enough that violations are rare; with a sparse graph it
  mostly trains people to bypass the check.

## Attach counterpart content to the report

To let the reviewer judge divergence without opening files, enrich the gate
report with the flagged counterparts' content:

```sh
speclink context --stdin --json < changed-files.txt > context.json
```

Filter the `contexts` array to the endpoints reported as gate violations
(`related --gate --json`, field `counterpartEndpoint`) and append each block's
`content` to the comment body. The JSON shape is specified by
[`schemas/context-output.schema.json`](../../schemas/context-output.schema.json);
the Stop-hook script in
[`examples/hooks/claude-stop-related-gate.sh`](../../examples/hooks/claude-stop-related-gate.sh)
shows the same filtering in ~20 lines of Bun.

## Exit-code summary

| Command | `0` | `1` |
| --- | --- | --- |
| `speclink check` | warnings or clean | any error diagnostic |
| `speclink related --gate` | no violations | at least one violation |
| `speclink context` | always on success | invocation/configuration errors only |
