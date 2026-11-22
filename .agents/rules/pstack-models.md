# pstack model configuration

Pick a level by the difficulty of the work, then an effort inside that level's range.

- Provider: the provider of the model that started the thread (Claude Code is `claude`, Codex is `codex`, a Devin session in T3 Code is `devin`). A delegate keeps the provider it was given.
- Use another provider only when the user says so in the session, or when the `implement` line below routes the work.
- A model name without a version (`opus`, `sonnet`, `sol`, ...) means the newest version of that family. In T3 Code, resolve it with `orchestrator_capabilities` (`search` is the family name) once per thread.
- When the chosen provider is out of quota, say so in one line and stop. Do not switch providers unless the user says so. The `implement` line below is the one exception.
- The user's choice in the session beats this file.
- `tool/pstack/spawn_guard.py` reads the table below and blocks a spawn whose model or effort falls outside it. Edit the table to change what it allows. When the user's choice falls outside the table and the hook blocks it, tell the user to start the agent with `PSTACK_SPAWN_GUARD=off`; an agent never sets it itself.

## Levels

Format: `<provider>: <level>=<model> (<low effort>-<high effort>, *<default>)`.

```text
claude: high=opus (low-high, *medium), mid=sonnet (low-high, *medium), low=haiku (low-max, *xhigh)
codex: high=sol (low-xhigh, *high), mid=terra (low-high, *medium), low=luna (low-max, *xhigh)
devin: high=adaptive (medium-max, *max), mid=swe-2-high (max-max, *max), low=swe-2-high (max-max, *max)
```

The `devin` models run through T3 `delegate_task` on the provider instance `acpRegistry_devin`. SWE-2 always runs with `thought_level: max`.

SWE-2 free models are rate-limited on concurrent sessions; the cap and the retry procedure live in `pstack.md` (Autonomy and cost). The preferred baseline is `swe-2-max`, but acpRegistry does not advertise it, so `delegate_task` uses `swe-2-high` (measured 2026-11). Whether `swe-2-flash` variants or `adaptive` fall under the same limit is unverified.

## Implementation delegates

```text
implement: devin
```

- Implementation delegates (code changes and fixes at the `mid` level, and small implementations at the `low` level) run on `devin` with `swe-2-high`, whatever the thread's provider.
- Location searches, verification runs, judgment, reviews, and work the main agent does itself stay on the thread's provider.
- A Devin implementer runs its own searches and verification and starts no subagents.
- If Devin cannot start or is out of quota, say so in one line and run the same level on the thread's provider.
- A review of a Devin implementation runs on a provider other than `devin`.

## Which level

- high: design, bugs of unknown cause, judgment and prose, panels and reviews.
- mid: implementation and fixes to a settled spec.
- low: location searches, verification runs, mechanical rewrites, and small implementations that the spec fully pins down (exact files, behavior, and acceptance command).
- A pstack skill that names a role (arena runners, swarm workers, ...) maps the same way: judgment roles to high, code work to mid, routine fan-out to low.

## Which effort

- Start at the default. Go one step up for an unknown cause, wide impact, an earlier failure, or a large open judgment. Go one step down for a fixed procedure, a small diff, or a cheap retry.
- If the top of the range is not enough, move up a level instead of past the range.
- Write the reason in one line when you delegate ("effort: high, one failed attempt").
- Devin names the same setting `thought_level`, and Codex names it `reasoningEffort`. Pass the value your tool calls `effort`.
