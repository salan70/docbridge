# pstack model configuration

Pick a level by the difficulty of the work, then an effort inside that level's range.

- Provider: the provider of the model that started the thread (Claude Code is `claude`, Codex is `codex`, a Devin session in T3 Code is `devin`). A delegate keeps the provider it was given.
- Use another provider only when the user says so in the session.
- A model name without a version (`opus`, `sonnet`, `sol`, ...) means the newest version of that family. In T3 Code, resolve it with `orchestrator_capabilities` (`search` is the family name) once per thread.
- When the chosen provider is out of quota, say so in one line and stop. Do not switch providers unless the user says so.
- The user's choice in the session beats this file.
- `tool/pstack/spawn_guard.py` reads the table below and blocks a spawn whose model or effort falls outside it. Edit the table to change what it allows.

## Levels

Format: `<provider>: <level>=<model> (<low effort>-<high effort>, *<default>)`.

```text
claude: high=opus (low-high, *medium), mid=sonnet (low-high, *medium), low=haiku (low-max, *xhigh)
codex: high=sol (low-xhigh, *high), mid=terra (low-high, *medium), low=luna (low-max, *xhigh)
devin: high=adaptive (medium-max, *max), mid=swe-2 (medium-max, *high), low=swe-2-flash (medium-max, *medium)
```

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
