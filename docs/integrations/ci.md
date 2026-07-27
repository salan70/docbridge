# CI integration

How to run the DocBridge gate in CI so the pull request — not the agent
session — is the enforcement point for linked counterparts.

The local agent hooks ([Claude Code](claude-code.md), [Codex](codex.md)) are
informational by design: they raise awareness during a session but never
block. CI re-runs the same gate over the whole PR change set, and the human
merge approval enforces the outcome.

## Validate the link graph

Run the checker as a required status check:

```yaml
- name: DocBridge check
  run: docbridge check
```

`docbridge check` exits `1` on any error diagnostic, so a broken link fails the
job. Add `--json` when a later step consumes the diagnostics.

## Gate the PR change set

Run `docbridge related --gate` over the files the PR changes and report the
result as one of three outcomes: `clean`, `violation`, or `infra-error`.

Derive the changed-file list from the checkout with
`git diff --name-only "${BASE_SHA}...${HEAD_SHA}"` (three-dot form against the
event payload SHAs). Fall back to a retried `gh api .../pulls/<n>/files` call
only when the checkout-local path fails its guards. The checkout step must use
`fetch-depth: 0`: a shallow checkout is the one configuration that breaks this
recipe, because `git diff` then errors or yields an empty list.

This repository's [`ci.yml`](../../.github/workflows/ci.yml)
(`related-gate-report` job) is the same recipe with the `docbridge` command
prefix replaced by `nix develop -c bun run src/cli/index.ts`.

````yaml
# fetch-depth: 0 is required: the primary changed-file derivation is
# `git diff BASE_SHA...HEAD_SHA`, which needs both commit objects. A
# shallow checkout is the one configuration that breaks this recipe.
- uses: actions/checkout@v4
  with:
    fetch-depth: 0

- name: Derive the PR changed-file list
  env:
    GH_TOKEN: ${{ github.token }}
    PR_NUMBER: ${{ github.event.pull_request.number }}
    BASE_SHA: ${{ github.event.pull_request.base.sha }}
    HEAD_SHA: ${{ github.event.pull_request.head.sha }}
  run: |
    gh_api_with_retry() {
      local attempt=1
      local delay=2
      local stderr_file
      stderr_file="$(mktemp)"
      while [ "$attempt" -le 3 ]; do
        if gh api "$@" 2>"$stderr_file"; then
          rm -f "$stderr_file"
          return 0
        fi
        if [ "$attempt" -eq 3 ]; then
          cat "$stderr_file" >&2
          rm -f "$stderr_file"
          return 1
        fi
        sleep "$delay"
        delay=$((delay * 2))
        attempt=$((attempt + 1))
      done
    }

    record_infra_error() {
      local reason="$1"
      {
        echo "GATE_OUTCOME=infra-error"
        echo "INFRA_REASON<<EOF"
        printf '%s\n' "$reason"
        echo "EOF"
      } >> "$GITHUB_ENV"
    }

    derived=0
    if [ -n "${BASE_SHA:-}" ] && [ -n "${HEAD_SHA:-}" ] \
      && git cat-file -e "${BASE_SHA}^{commit}" 2>/dev/null \
      && git cat-file -e "${HEAD_SHA}^{commit}" 2>/dev/null; then
      git_diff_err_file="$(mktemp)"
      if git diff --name-only "${BASE_SHA}...${HEAD_SHA}" \
        >changed-files.txt 2>"$git_diff_err_file"; then
        if [ -s changed-files.txt ]; then
          echo "CHANGED_FILES_SOURCE=git" >> "$GITHUB_ENV"
          derived=1
        fi
      else
        printf 'git diff failed: %s\n' "$(cat "$git_diff_err_file")" >&2
      fi
      rm -f "$git_diff_err_file"
    fi

    if [ "$derived" -ne 1 ]; then
      rm -f changed-files.txt
      api_err_file="$(mktemp)"
      if gh_api_with_retry "repos/${GITHUB_REPOSITORY}/pulls/${PR_NUMBER}/files" --paginate \
        -q '.[].filename' >changed-files.txt 2>"$api_err_file" \
        && [ -s changed-files.txt ]; then
        echo "CHANGED_FILES_SOURCE=api" >> "$GITHUB_ENV"
        rm -f "$api_err_file"
      else
        api_err="$(cat "$api_err_file" 2>/dev/null || true)"
        rm -f "$api_err_file" changed-files.txt
        record_infra_error "changed-file list unobtainable (git derivation failed; gh api fallback failed): ${api_err:-no stderr}"
      fi
    fi

- name: Run related-gate over the PR change set
  if: ${{ env.GATE_OUTCOME != 'infra-error' }}
  run: |
    gate_status=0
    docbridge related --stdin --gate \
      < changed-files.txt > gate-output.txt 2>&1 || gate_status=$?
    if [ "$gate_status" = "0" ]; then
      echo "GATE_OUTCOME=clean" >> "$GITHUB_ENV"
    elif [ "$gate_status" = "1" ]; then
      echo "GATE_OUTCOME=violation" >> "$GITHUB_ENV"
    else
      {
        echo "GATE_OUTCOME=infra-error"
        echo "INFRA_REASON<<EOF"
        echo "docbridge related --gate exited ${gate_status}"
        tail -n 40 gate-output.txt
        echo "EOF"
      } >> "$GITHUB_ENV"
    fi
    cat gate-output.txt

- name: Create or update the sticky PR comment
  if: always()
  env:
    GH_TOKEN: ${{ github.token }}
    PR_NUMBER: ${{ github.event.pull_request.number }}
  run: |
    gh_api_with_retry() {
      local attempt=1
      local delay=2
      local stderr_file
      stderr_file="$(mktemp)"
      while [ "$attempt" -le 3 ]; do
        if gh api "$@" 2>"$stderr_file"; then
          rm -f "$stderr_file"
          return 0
        fi
        if [ "$attempt" -eq 3 ]; then
          cat "$stderr_file" >&2
          rm -f "$stderr_file"
          return 1
        fi
        sleep "$delay"
        delay=$((delay * 2))
        attempt=$((attempt + 1))
      done
    }

    outcome="${GATE_OUTCOME:-infra-error}"
    reason="${INFRA_REASON:-GATE_OUTCOME was unset; prior step likely aborted before recording an outcome}"

    marker='<!-- docbridge-related-gate -->'
    {
      echo "$marker"
      echo "## DocBridge related-gate"
      echo
      if [ "$outcome" = "clean" ]; then
        echo "All linked counterparts of the changed files are part of this PR's change set."
      elif [ "$outcome" = "violation" ]; then
        echo "Changed files have linked counterparts that this PR does not update."
        echo "For each entry, either update the counterpart or make sure the PR explains why no update is needed."
        echo
        echo '```'
        cat gate-output.txt
        echo '```'
      else
        echo "DocBridge related-gate could not run — infrastructure failure."
        echo
        echo "Reason:"
        echo '```'
        printf '%s\n' "$reason"
        echo '```'
      fi
    } > comment.md

    {
      echo "## DocBridge related-gate"
      echo
      echo "Outcome: \`${outcome}\`"
      if [ "$outcome" = "infra-error" ]; then
        echo
        echo "Reason:"
        echo '```'
        printf '%s\n' "$reason"
        echo '```'
      elif [ "$outcome" = "clean" ]; then
        echo
        echo "All linked counterparts of the changed files are part of this PR's change set."
      else
        echo
        echo "Changed files have linked counterparts that this PR does not update."
        echo
        echo '```'
        cat gate-output.txt
        echo '```'
      fi
    } >> "$GITHUB_STEP_SUMMARY"

    comment_id="$(gh_api_with_retry "repos/${GITHUB_REPOSITORY}/issues/${PR_NUMBER}/comments" --paginate \
      -q ".[] | select(.body | startswith(\"${marker}\")) | .id" | head -n 1)"
    if [ -n "$comment_id" ]; then
      gh_api_with_retry -X PATCH "repos/${GITHUB_REPOSITORY}/issues/comments/${comment_id}" -F body=@comment.md
    else
      gh_api_with_retry -X POST "repos/${GITHUB_REPOSITORY}/issues/${PR_NUMBER}/comments" -F body=@comment.md
    fi

    if [ "$outcome" = "infra-error" ]; then
      exit 1
    fi
````

The gate exits `1` when a changed file has a linked counterpart that the PR
does not also change. A violation does not necessarily mean the counterpart
must change; it means nobody has decided yet. Two reporting styles:

- **Informational (recommended)** — set `continue-on-error: true` on the job so
  a `violation` or `infra-error` does not block merge, and post the outcome as
  a sticky PR comment (`if: always()` so an infrastructure failure overwrites
  a prior success). The three outcomes are distinguishable from the comment
  alone.
- **Blocking** — make the job required, forcing every PR to either update
  counterparts or carve them out of the gate. Only adopt this once the link
  graph is dense enough that violations are rare; with a sparse graph it
  mostly trains people to bypass the check. Prefer leaving `infra-error`
  distinguishable even when blocking violations.

## Attach counterpart content to the report

To let the reviewer judge divergence without opening files, enrich the gate
report with the flagged counterparts' content:

```sh
docbridge context --stdin --json < changed-files.txt > context.json
```

Filter the `contexts` array to the endpoints reported as gate violations
(`related --gate --json`, field `counterpartEndpoint`) and append each block's
`content` to the comment body. The JSON shape is specified by
[`schemas/context-output.schema.json`](../../schemas/context-output.schema.json);
the Stop-hook script in
[`examples/hooks/claude-stop-related-gate.sh`](../../examples/hooks/claude-stop-related-gate.sh)
shows the same filtering in ~20 lines of Bun.

## Exit-code summary

| Command                    | `0`               | `1`                                  |
| -------------------------- | ----------------- | ------------------------------------ |
| `docbridge check`          | warnings or clean | any error diagnostic                 |
| `docbridge related --gate` | no violations     | at least one violation               |
| `docbridge context`        | always on success | invocation/configuration errors only |
