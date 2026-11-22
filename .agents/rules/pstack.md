# pstack in this repository

For a multi-step task, read `.agents/skills/poteto-mode/SKILL.md`, including its project overrides, to choose the relevant Playbook and Principles. Read only the skills the task needs. Skip it for a pure question you can answer from context, a fully specified one-line edit, or when the user opts out.

The pstack skills in `.agents/skills/` are a curated subset of Cursor's pstack plugin, vendored verbatim and pinned by `tool/pstack/manifest.json`. See [pstack assets](../../docs/contributing/README.md#pstack-assets) for how to sync and update them.

## Precedence

1. The user's explicit instruction in the current session. It never overrides the approval requirements in `AGENTS.md`.
2. `AGENTS.md`, this file, `pstack-models.md`, and `docs/contributing/README.md`.
3. The vendored pstack skills.
4. The user's global rules, such as a personal `~/.claude/CLAUDE.md`.

When a global rule conflicts with this repository's rules, this repository wins. This file overrides a vendored skill wherever they conflict, whether the skill runs through poteto-mode or on its own.

## Paths, tools, and models

- A Cursor path maps to this repository. `.cursor/skills/` and `pstack/skills/` mean `.agents/skills/`. `pstack/docs/` means `tool/pstack/upstream/docs/`. In Claude Code, map tool names with `tool/pstack/upstream/docs/harness/claude-code.md`. Codex and Devin in T3 Code map them to the nearest tool they have, and use the T3 `delegate_task` tool for another provider's model.
- Model choices come from `.agents/rules/pstack-models.md`, never from a skill's default slugs or `~/.cursor/rules/pstack-models.mdc`. Pick a level (`high`, `mid`, `low`) by the work, and an effort inside that level's range.
- There are no cloud agents. Run every worker locally. Ignore `environment: "cloud"` and `cloud_base_branch`, and give a worker that needs isolation its own worktree.
- Temporary output goes to the session scratchpad directory, not `/tmp`.
- Only the skills in `.agents/skills/` exist. The skills that pstack bundles but this repository does not install (`architect`, `arena`, `interrogate`, `swarm`, `how`, `why`, `no-comments`, `show-me-your-work`, `figure-it-out`, `poteto-agent`, `comment-sicko`, and the rest) are unavailable. So are Bugbot, Cursor Automations, Origin, Graphite, `poteto-mode/scripts/`, `create-skill`, `audit-skills`, `deslop`, `control-ui`, `control-cli`, and Linear, Notion, Slack, Datadog, Sentry, or Databricks connectors. Skip a step that needs one with one line, or use the replacement below.

| Upstream                                      | Replacement                                                                                                            |
| --------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `create-skill`, `audit-skills`                | Edit a project-authored skill directly, following `poteto-mode/playbooks/authoring-a-skill.md` and `technical-writing` |
| `deslop`                                      | Review your own diff against `principle-subtract-before-you-add` and `unslop`                                          |
| `no-comments`                                 | Review your own diff for comments that restate the code                                                                |
| `watch-pr`, `check-plan`, `worktree-audit.sh` | `gh` and the host's PR tools, or a manual check                                                                        |
| A team tracker                                | GitHub Issues through `gh`, only when the user asks                                                                    |

## Stack

DocBridge is a Rust CLI and a Cargo workspace. Read TypeScript, React, or Electron examples in a skill as their Rust equivalents. Commands and verification follow `docs/contributing/README.md`: use the `justfile` recipes, test first for logic changes, and run `just verify` before you report completion. A prototype is a throwaway script in the scratchpad, never inside `crates/`.

## Git and PRs

- Branch from a freshly fetched `main`, and open PRs against `main`. Read "trunk" as `main`. The `git-workflow` skill owns the procedure.
- One Issue maps to one PR. Split the work into commits inside it. Stack PRs only when the user asks.
- Follow the branch, commit, and PR conventions in `docs/contributing/README.md#git-and-pull-requests`. Write them in English. Use the PR template.
- A force-push or any rewrite of a pushed branch needs explicit user approval. Bring in `main` with a merge. Never run `git reset --hard` on a branch that holds work you did not make.
- Never merge a PR and never arm auto-merge. Merging needs explicit human approval for each PR. The pstack Shipping and Autopilot-full playbooks never run. Never bypass the Git hooks.

## Autonomy and cost

- Proceed on reversible work. Merges, releases, deploys, force pushes, data deletion, and messages or tickets outside this repository need the user's explicit approval. This overrides `principle-never-block-on-the-human`.
- Product and taste decisions belong to the user. Ask with options, the recommended one first, instead of deciding them.
- Never write global settings (`~/.cursor`, `~/.claude`, `~/.codex`) or install plugins.
- Never edit a vendored skill. A change goes into `tool/pstack/overlays/` and `python3 tool/pstack/pstack.py sync`, and only with the user's approval, because the overlay changes what every contributor's agent reads.
- A mandatory fan-out, panel, or cross-model review runs at its smallest useful size: one subagent unless the risk of the task earns more. Run a cross-model review only when the user asks. Do not arm recurring loops unless the user asks.

## Context and delegation

Every request resends the whole thread, so cost follows thread length times the number of calls.

- Every spawn names the provider, model, and effort resolved from `pstack-models.md`. A native subagent and a T3 `delegate_task` inherit the parent's model when you omit it. The spawn guard blocks a spawn that omits it in Claude Code.
- A follow-up, a fix round, or the next step goes to a fresh delegate with a consolidated brief. Do not append "continue" to a finished delegate's thread.
- The main agent keeps design and judgment. It delegates mechanical work (rendering, verification runs, routine edits) at the `mid` level, or at `low` when the spec pins the work down.
- A small change runs in the main agent while the thread is short.
- Implementation delegates follow the `implement` line of `pstack-models.md`. With `implement: devin`, start them with T3 `delegate_task` on `acpRegistry_devin`, model `swe-2-high`, and `thought_level: max`.
- An implementer owns one unit: investigation, the change, and its verification. It may hand location searches and long verification to a `low` subagent. Nesting stops there: one level, `low` only.
- When the user asks a side question in a long thread, answer it, then say in one line that a new thread is cheaper for such questions.
