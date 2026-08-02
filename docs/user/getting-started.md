---
description: Set up DocBridge in an existing TypeScript, Swift, or Dart project.
---

# Getting Started

DocBridge checks that Markdown documentation and supported code declarations
link to each other. It scans only the files selected by
`docbridge.config.json`; it does not send source or documentation anywhere.

## Install

Add DocBridge to a project with the package manager used by that project:

```sh
npm install --save-dev docbridge
```

The CLI supports Node.js 22 or later and Bun 1.1.31 or later.

<!-- @code src/cli/init.ts#runInit -->

## Set up a project

Preview the files DocBridge would create:

```sh
npx docbridge init --dry-run
```

Then run `npx docbridge init` interactively, or use `--yes` when the detected
scope is unambiguous. The command can create `docbridge.config.json` and install
the distributable DocBridge skills for Codex, Claude Code, or both. It never
overwrites an existing configuration.

If a coding agent should choose the documentation and code scope, use:

```sh
npx docbridge init-with-agent
```

## Add the first reciprocal link

Add `@doc` to a supported declaration and `@code` before the matching Markdown
heading. Both targets are relative to the project root:

```ts
/** @doc docs/auth.md#login-flow */
export function login(): void {}
```

```md
<!-- @code src/auth.ts#login -->

## Login Flow
```

Run the quality gate:

```sh
npx docbridge check
```

A clean graph exits `0`. Broken links and invalid configuration exit `1`.

## Next steps

- Read `docbridge docs show configuration` before narrowing scan scope.
- Read `docbridge docs show annotations` for link target rules.
- Read `docbridge docs show commands` to choose an inspection command.
- Add `docbridge check` to CI after the local graph passes.
