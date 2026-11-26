## Project overrides (DocBridge)

Edit `tool/pstack/overlays/poteto-mode.md`, not this section. Read `.agents/rules/pstack.md` first. Its rules (paths, models, Git, autonomy, cost) apply to this skill and every playbook. Where this section conflicts with the text above, this section wins.

### Harness

- Bundled skills live at `.agents/skills/<name>/SKILL.md`. Most set `disable-model-invocation`, so read them directly instead of calling the `Skill` tool.
- Only a curated subset of pstack is installed. A step that names a skill missing from `.agents/skills/` (`arena`, `interrogate`, `swarm`, `show-me-your-work`, `figure-it-out`, and the rest) is skipped with one line, never fetched. `deslop` is vendored from cursor-team-kit and lives at `.agents/skills/deslop/`; read it directly.
- Spawn `general-purpose` for every subagent, in place of `poteto-agent` and `comment-sicko` (its brief is vendored at `tool/pstack/upstream/agents/comment-sicko.md`). Ignore the model defaults in **Subagents**. Use `.agents/rules/pstack-models.md`. An explicit model choice from the user in the session wins.

### Devin free-model rate limit

- SWE-2 free models are rate-limited on concurrent sessions. The cap and the retry procedure live in `.agents/rules/pstack.md` (Autonomy and cost).
- The preferred baseline for Devin is `swe-2-max`, but acpRegistry does not advertise it, so `delegate_task` uses `swe-2-high`. Whether `swe-2-flash` variants or `adaptive` fall under the same limit is unverified.
- When the work does not require Devin and you will not wait for the reset, run the same level on the thread's provider instead of `delegate_task` to Devin, as the `implement` notes in `pstack-models.md` describe.
  When the work requires Devin, wait for the reset or report the block in one line and stop.
  No model table change is needed.

### Playbooks

- **Feature**, **Bug fix**, **Refactoring.** Follow the test conventions in `docs/contributing/README.md`, and finish with `just verify`. Delegation is optional for a small change. Read "rebase into small, ordered commits" as commits ordered by verifiable unit, without rewriting pushed history.
- **Opening a PR.** Use the PR template and the conventions in `docs/contributing/README.md#git-and-pull-requests`. The template replaces `## Why` and the other upstream sections.
- **Babysit.** Ends at merge-ready. **Shipping** and **Autopilot-full** never run, because merging needs explicit human approval.
- **Autonomous run**, **Autopilot-stack**, **Eval**, **Multi-phase plan.** Run only when the user asks.
- **Autopilot-stack** reuses the Autopilot-full steps only up to "verified and green" and never merges, so the ban on Autopilot-full does not apply to it.
- **Worktree cleanup.** List candidates and ask before removing any worktree.

### Principles

Choose the Playbook and Principles that affect this task, then read their leaf skills. Do not turn the upstream triggers into a requirement to read every skill or to update every document.
