# DocBridge

[![Japanese README](https://img.shields.io/badge/README-%E6%97%A5%E6%9C%AC%E8%AA%9E-blue)](docs/ja/README.md)
[![Ask DeepWiki](https://deepwiki.com/badge.svg)](https://deepwiki.com/salan70/docbridge)

DocBridge keeps Markdown documentation and the code files that implement it
linked. A `<!-- @code path -->` line before a Markdown heading links that
section to a code file. `docbridge validate` checks the links, and
`docbridge links` and `docbridge unlinked` show what is related and what is not
covered, so humans and coding agents can find the right counterpart before a
change drifts.

DocBridge is a single native executable. It needs no language runtime and does
not parse code, so it works with any language.

## Install

Production releases are pending: the first release of the native CLI,
`0.17.0`, has not been published yet. Until then, build it from source.

- From a GitHub release (after `0.17.0` is published): download the
  executable for your platform from
  [GitHub Releases](https://github.com/salan70/docbridge/releases), put it on
  your `PATH`, and make it executable. Release assets cover Linux x64 and ARM64
  (static musl), macOS x64 and ARM64, and Windows x64.
- With Nix: `nix profile install github:salan70/docbridge`, or use the flake
  output `packages.<system>.docbridge`.
- From source with Rust 1.83 or later:
  `cargo install --locked --git https://github.com/salan70/docbridge docbridge`.

`docbridge upgrade` replaces only a standalone installation that carries an
installation receipt, after verifying the release signature. Nix and other
package-managed installations are updated through their package manager.

Upgrading from the npm package (`0.16.0` and earlier)? The native CLI has no
compatibility layer. Follow the Migration guide:
`docbridge docs show migration`, or
[`crates/docbridge/guides/migration.md`](crates/docbridge/guides/migration.md).

## Link the first section

In the project root, let DocBridge propose a configuration and install the
agent Skill, then review what it wrote:

```sh
docbridge init
```

The configuration selects code directories and extensions and documentation
directories:

```json
{
  "include": {
    "code": { "paths": ["src"], "extensions": [".ts"] },
    "docs": ["docs"]
  },
  "exclude": {}
}
```

Link a section to the file that implements it by placing the annotation
directly before its heading in `docs/auth.md`:

```md
<!-- @code src/auth.ts -->

## Login Flow
```

Then validate the links and review them:

```sh
docbridge validate
docbridge links docs/auth.md --include-content
docbridge unlinked
```

`validate` exits `0` when configuration and links are valid and `1` otherwise.
Structural validity does not prove that the code and the prose agree; review
the linked content, or have an agent review it.

## Guides

The CLI ships its English guides, so they work offline and match the installed
version:

```sh
docbridge docs list
docbridge docs show getting-started
```

Their sources are in [`crates/docbridge/guides/`](crates/docbridge/guides/):
getting started, configuration, linking, commands, troubleshooting,
automation, migration, and removal (`deinit`).

- [Documentation hub](docs/README.md) — specifications and contributor
  references
- [Changelog](CHANGELOG.md) — release history
- [日本語ドキュメント](docs/ja/README.md)

## Contributing

Repository setup, tests, and pull-request policy are in
[CONTRIBUTING.md](CONTRIBUTING.md). Documentation ownership and writing rules
are in [Documentation Guidelines](docs/contributing/documentation.md).

DocBridge is not a documentation generator. It makes the relationship between
maintained prose and implementation explicit, navigable, and machine-readable.
