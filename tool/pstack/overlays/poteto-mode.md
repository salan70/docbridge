## Project overrides (DocBridge)

Edit `tool/pstack/overlays/poteto-mode.md`, not this section. Read `.agents/rules/pstack.md` first. Its rules (paths, models, Git, autonomy, cost) apply to this skill and every playbook. Where this section conflicts with the text above, this section wins.

### Harness

- Bundled skills live at `.agents/skills/<name>/SKILL.md`. Most set `disable-model-invocation`, so read them directly instead of calling the `Skill` tool.
- Only a curated subset of pstack is installed. A step that names a skill missing from `.agents/skills/` (`architect`, `arena`, `interrogate`, `swarm`, `how`, `why`, `no-comments`, `show-me-your-work`, `figure-it-out`, `poteto-agent`, `comment-sicko`, and the rest) is skipped with one line, never fetched.
- Spawn `general-purpose` for every subagent, in place of `poteto-agent`. Ignore the model defaults in **Subagents**. Use `.agents/rules/pstack-models.md`. An explicit model choice from the user in the session wins.

### Playbooks

- **Feature**, **Bug fix**, **Refactoring.** Follow the test conventions in `docs/contributing/README.md`, and finish with `just verify`. Delegation is optional for a small change. Read "rebase into small, ordered commits" as commits ordered by verifiable unit, without rewriting pushed history.
- **Opening a PR.** Use the PR template and the conventions in `docs/contributing/README.md#git-and-pull-requests`. The template replaces `## Why` and the other upstream sections.
- **Babysit.** Ends at merge-ready. **Shipping** and **Autopilot-full** never run, because merging needs explicit human approval.
- **Autonomous run**, **Autopilot-stack**, **Eval**, **Multi-phase plan.** Run only when the user asks.
- **Autopilot-stack** reuses the Autopilot-full steps only up to "verified and green" and never merges, so the ban on Autopilot-full does not apply to it.
- **Worktree cleanup.** List candidates and ask before removing any worktree.

### Principles

Choose the Playbook and Principles that affect this task, then read their leaf skills. Do not turn the upstream triggers into a requirement to read every skill or to update every document.
