# DocBridge

[![npm version](https://img.shields.io/npm/v/docbridge.svg)](https://www.npmjs.com/package/docbridge)
[![Japanese README](https://img.shields.io/badge/README-%E6%97%A5%E6%9C%AC%E8%AA%9E-blue)](docs/ja/README.md)
[![Ask DeepWiki](https://deepwiki.com/badge.svg)](https://deepwiki.com/salan70/docbridge)

DocBridge keeps Markdown documentation and the code that implements it linked
in both directions. It validates `@doc` annotations on supported TypeScript,
Swift, Dart, and Rust declarations against `@code` annotations on Markdown
headings, so humans and coding agents can find the right counterpart before a
change drifts.

## Requirements

- Node.js 22 or later, or Bun 1.1.31 or later
- A project containing Markdown and supported source files

Prebuilt Swift, Dart, and Rust scanners are included for supported macOS and
Linux platforms. See [Releases](https://github.com/salan70/docbridge/releases)
for packaged-platform details.

## Install

Add DocBridge to the project that owns the documentation:

```sh
npm install --save-dev docbridge
```

With Bun:

```sh
bun add --dev docbridge
```

## Run the first check

Create a starting configuration interactively:

```sh
npx docbridge init
```

Or write the minimal TypeScript configuration yourself:

```json
{
  "$schema": "./node_modules/docbridge/schemas/docbridge.schema.json",
  "include": {
    "code": {
      "typescript": {
        "patterns": ["src/**/*.ts"]
      }
    },
    "docs": ["docs/**/*.md"]
  }
}
```

Add a documentation target to a supported declaration:

```ts
/** @doc docs/auth.md#login-flow */
export function login(): void {}
```

Add the reciprocal code target immediately before the Markdown heading:

```md
<!-- @code src/auth.ts#login -->

## Login Flow
```

Then validate the pair:

```sh
npx docbridge check
```

A valid graph exits `0`. Invalid configuration, unresolved targets, and missing
backlinks produce diagnostics and exit `1`.

## Choose the next guide

- [Documentation hub](docs/README.md) — user guides, integration recipes,
  specifications, and contributor references
- [Getting started](docs/user/getting-started.md) — installation and project
  setup
- [Configuration](docs/user/configuration.md) — roots, include patterns,
  languages, and visibility
- [Linking](docs/user/linking.md) — choose, create, and semantically review
  links
- [Commands](docs/user/commands.md) — check, related, context, graph, docs, and
  upgrade
- [Automation](docs/user/automation.md) — coding agents, Git hooks, and CI
- [Troubleshooting](docs/user/troubleshooting.md) — diagnose configuration,
  scanning, and link failures
- [日本語ドキュメント](docs/ja/README.md)

The CLI ships the English task guides with its own version. Run
`npx docbridge docs list` and `npx docbridge docs show <name>` to read them
without a repository checkout.

## Contributing

Repository setup, tests, and pull-request policy are in
[CONTRIBUTING.md](CONTRIBUTING.md). Documentation ownership and writing rules
are in [Documentation Guidelines](docs/contributing/documentation.md).

DocBridge is not a documentation generator. It makes the relationship between
maintained prose and implementation explicit, navigable, and machine-readable.
