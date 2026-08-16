# Related-Gate CI Hardening Plan

This plan addresses [issue #77](https://github.com/salan70/docbridge/issues/77):
the published related-gate CI recipe derives the PR's changed-file list from a
single unretried `gh api .../pulls/<n>/files` call. When that call fails —
observed downstream in `teigiii_app` during a GitHub API incident returning
503 — the `related-gate-report` job goes red while the sticky comment still
shows the previous successful state. The failure is indistinguishable from a
real gate violation without reading the job logs.

Nothing about `docbridge related --gate` is at fault; the CLI behaved
correctly in the observed incident. The defect is entirely in the CI recipe:
`docs/integrations/ci.md` (what adopters copy) and
`.github/workflows/ci.yml:152-209` (this repository's copy of it).

The local agent hooks are already immune: both
`examples/hooks/claude-stop-related-gate.sh:27` and
`.claude/hooks/stop-verify.sh:119` derive their file list from
`git diff --name-only HEAD` and make no API call. They need no change.

Normative behavior is unaffected; no specification under `docs/specs/` changes.

## Status

- [x] Slice 1: Checkout-Local Changed-File Derivation
- [x] Slice 2: Infrastructure Failure as a Distinct Outcome
- [x] Slice 3: Recipe Publication and Drift Guard

## Goals

- A transient GitHub API failure does not turn the related-gate job into a
  false gate finding.
- The job's outcome states which of three things happened — clean, violation,
  or infrastructure failure — without opening the logs.
- The sticky comment never keeps showing an older success after a failed run.
- The recipe in `docs/integrations/ci.md` and this repository's workflow stay
  behaviorally identical, and drift between them is detected mechanically
  rather than by review attention.

## Non-Goals

- `docbridge related --gate` itself, its exit codes, output format, or the
  sticky comment's `<!-- docbridge-related-gate -->` marker contract.
- Retry policy for any other CI job.
- A third-party changed-files action. The recipe is copied into other people's
  repositories; adding a supply-chain dependency there is not DocBridge's call
  to make on their behalf.
- Updating the downstream copies (`teigiii_app/.github/workflows/docbridge.yml`
  and any other adopter). Tracked as follow-up; adopters re-copy on their own
  schedule.
- Making `related-gate-report` a required check. It stays informational.

## Decisions

### `git diff` Is Primary, the API Is the Fallback

The changed-file list is already present in the checkout. Deriving it locally
removes the external dependency from the common path instead of merely making
the dependency more patient.

```sh
git diff --name-only "${BASE_SHA}...${HEAD_SHA}"
```

Three-dot form, deliberately: it diffs `HEAD_SHA` against the merge base of the
two, which is the same set GitHub's Files tab and the `pulls/<n>/files`
endpoint report. Two-dot would include changes made on the base branch since
the fork point and would over-report on any PR whose base has moved.

`BASE_SHA` and `HEAD_SHA` come from the event payload
(`github.event.pull_request.base.sha` / `.head.sha`), not from `git merge-base`
against a branch name, so a base branch that moves mid-run cannot shift the
result.

The API call is kept as the fallback rather than deleted. It covers the cases
the checkout cannot serve — see the next decision — and retains a path that is
known to work today.

### A Shallow or Incomplete Checkout Must Fail Loudly, Never Silently

This is the one way the new primary source is worse than the old one: with
`actions/checkout`'s default `fetch-depth: 1`, `git diff BASE...HEAD` either
errors or produces a wrong list, and a wrong-but-nonempty list would be
reported as a gate result. That is a worse failure than the one being fixed.

Two guards, both required:

1. The job checks out with `fetch-depth: 0`.
2. The derivation verifies the objects exist before diffing —
   `git cat-file -e "${BASE_SHA}^{commit}"` and the same for `HEAD_SHA` — and
   treats a missing object, a nonzero `git diff`, or an **empty result** as a
   derivation failure rather than as "no files changed".

Empty is treated as failure because a pull request with zero changed files does
not occur in practice, while a shallow checkout producing empty output does.
The cost of the false positive is one fallback API call.

On any derivation failure the job falls back to the API call, and only if that
also fails does the run become an infrastructure failure.

### The API Fallback Retries With Backoff

`gh api` gets three attempts with 2s/4s backoff. Retry belongs on the fallback
too: the fallback exists precisely for runs where the checkout-local path is
unavailable, so it must not itself be a single point of failure.

The same retry wrapper is applied to the three `gh api` calls in the
sticky-comment step, which have identical exposure and are the remaining way a
stale success can survive.

### Three Outcomes, Not Two

The job currently carries one boolean, `GATE_STATUS`. It becomes a tri-state
`GATE_OUTCOME` of `clean`, `violation`, or `infra-error`, and every consumer
branches on all three:

| Outcome       | Meaning                                         | Sticky comment                                        | Step summary  |
| ------------- | ----------------------------------------------- | ----------------------------------------------------- | ------------- |
| `clean`       | gate exit 0                                     | "All linked counterparts … are part of this PR"       | same text     |
| `violation`   | gate exit 1                                     | violation list, existing wording                      | same text     |
| `infra-error` | changed-file list unobtainable, or gate crashed | "could not run — infrastructure failure", with reason | reason + logs |

`infra-error` is written to `$GITHUB_STEP_SUMMARY` as well as the comment, so
the reason is on the run's summary page without expanding a step.

A gate exit code other than 0 or 1 is `infra-error`, not `violation`: those
codes mean the CLI failed to produce a verdict.

### The Comment Is Rewritten on Every Outcome

The stale-comment half of the incident is fixed by making the comment step run
regardless of what happened, including `infra-error`, and by moving it out of
the derivation step's failure shadow (`if: always()` on the step, with the
outcome read from `$GITHUB_ENV`). An `infra-error` comment overwrites a prior
success with an explicit "could not run" state.

Residual risk, accepted: if the comment API calls themselves exhaust their
retries, the previous comment stays. The job then goes red with an
`infra-error` step summary, which is the same signal by a different channel.
Eliminating this would require a second reporting channel and is not worth the
surface.

### Rejected: Extracting the Recipe Into a Shared Script

A `scripts/pr-changed-files.sh` sourced by both `ci.yml` and the docs would
make drift structurally impossible. Rejected: the recipe's value is that an
adopter can paste one workflow step into their repository. A script turns that
into "copy this file too, and keep it in sync", which is exactly the burden
being avoided. The drift guard in Slice 3 buys the same safety without moving
the cost onto adopters.

## Slice 1: Checkout-Local Changed-File Derivation

Purpose: remove the GitHub API from the common path for obtaining the PR's
changed-file list.

Tasks:

- Add `with: fetch-depth: 0` to the `related-gate-report` job's checkout step.
- Split the current combined step into a derivation step and a gate step.
- In the derivation step, implement the primary path from
  [Decisions](#git-diff-is-primary-the-api-is-the-fallback), including the
  `git cat-file -e` object checks and the empty-result guard.
- Implement the retrying `gh api` fallback and record which source produced the
  list (`CHANGED_FILES_SOURCE=git|api`) so a run can be audited after the fact.
- Keep the gate invocation, its `continue-on-error: true` job setting, and the
  `permissions` block unchanged.

Verification:

- On a real multi-commit PR against this repository, confirm the `git`-derived
  list matches the API list exactly. Compare with:

  ```sh
  gh api "repos/salan70/docbridge/pulls/<n>/files" --paginate -q '.[].filename' \
    | sort > /tmp/api.txt
  git diff --name-only "$(gh pr view <n> --json baseRefOid -q .baseRefOid)...$(gh pr view <n> --json headRefOid -q .headRefOid)" \
    | sort > /tmp/git.txt
  diff /tmp/api.txt /tmp/git.txt
  ```

  Include a PR containing a rename and one containing a deletion: the API
  reports a rename as a single entry under the new path, and `git diff
--name-only` with default rename detection must be confirmed to agree. If it
  does not, add `--no-renames` so both paths are listed, and record the choice
  here.

  Confirmed on PR #80 (rename of the Dart scanner entrypoint): default
  `git diff --name-only` matched the API list exactly. `--no-renames` listed
  the old path as well and diverged, so the recipe keeps the default rename
  detection.

- Confirm `fetch-depth: 0` does not materially slow the job for this
  repository's history.

Done when:

- The job produces its changed-file list from the checkout on a normal run, and
  from the retried API call only when the checkout-local derivation fails its
  own guards.

## Slice 2: Infrastructure Failure as a Distinct Outcome

Purpose: make a failed run state whether the gate found something or the
plumbing broke.

Tasks:

- Replace `GATE_STATUS` with the tri-state `GATE_OUTCOME` and an
  `INFRA_REASON` string carrying the failing command and its stderr tail.
- Branch the sticky-comment body on all three outcomes; the `clean` and
  `violation` bodies keep their current wording and the existing marker.
- Write the outcome and, for `infra-error`, the reason to
  `$GITHUB_STEP_SUMMARY`.
- Apply the retry wrapper to the comment step's three `gh api` calls.
- Run the comment step with `if: always()` so an `infra-error` still overwrites
  a previous success.
- Classify a gate exit code outside `{0, 1}` as `infra-error`.

Verification:

- Simulate an API failure on a scratch PR by pointing the fallback at an
  unreachable endpoint (`GH_HOST=127.0.0.1:1`) **and** forcing the primary path
  to fail (an unset `BASE_SHA`). Confirm: the sticky comment reads as an
  infrastructure failure, the step summary names the failing command, and no
  gate-violation wording appears anywhere in the run.
- On the same PR, confirm a prior success comment is overwritten by the
  `infra-error` body.
- Confirm an ordinary violation still renders exactly as it does today.

Done when:

- The three outcomes are distinguishable from the PR comment alone, and a run
  that could not obtain a file list never renders as a gate result.

## Slice 3: Recipe Publication and Drift Guard

Purpose: ship the hardened recipe to adopters and stop the two copies from
diverging silently.

Tasks:

- Rewrite the `Gate the PR change set` section of
  [`docs/integrations/ci.md`](../../integrations/ci.md) with the hardened recipe,
  including the `fetch-depth: 0` requirement and the reason for it, and the
  three-outcome reporting. State plainly that a shallow checkout is the one
  configuration that breaks it.
- Make the doc's fenced YAML the canonical text, and make `ci.yml`'s step
  differ from it only by the documented invocation substitution
  (the `docbridge` command prefix becomes
  `nix develop -c bun run src/cli/index.ts`).
- Add a Bun test under `src/` that extracts the fenced block from `ci.md`,
  applies that single substitution, and asserts it equals the `run` body of the
  corresponding `ci.yml` step. If normalization proves brittle in practice,
  fall back to asserting on a stable subset (the derivation and outcome
  branches) rather than deleting the guard.
- Add a CHANGELOG entry under `[Unreleased]` telling adopters the recipe
  changed, that re-copying is required to pick it up, and that the new version
  needs `fetch-depth: 0`.
- Run the `docbridge-sync` triage over the changed counterparts.
- Check the final `## Status` box and `git mv` this plan into
  `docs/plans/done/` in the PR that lands this slice.

Verification:

```sh
just verify
```

Done when:

- An adopter copying `docs/integrations/ci.md` gets the hardened behavior, and
  a future edit to either copy that breaks the correspondence fails `just test`.

## Follow-up Work

- Re-copy the recipe into `teigiii_app/.github/workflows/docbridge.yml` after a
  release ships, and confirm the incident-day scenario now reports
  `infra-error`. The issue names this repository as the natural validation site.
- Revisit whether `related-gate-report` should stop being `continue-on-error`
  once `infra-error` is distinguishable — a red job would then carry meaning.
  Not part of this plan.
