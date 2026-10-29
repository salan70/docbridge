# DocBridge

[![Ask DeepWiki](https://deepwiki.com/badge.svg)](https://deepwiki.com/salan70/docbridge)

DocBridge keeps Markdown documentation and the code files that implement it
linked. A `<!-- @code path -->` line before a Markdown heading links that
section to a code file. `docbridge validate` checks the links, and
`docbridge links` and `docbridge unlinked` show what is related and what is not
covered.

DocBridge is a single native executable. It does not parse code, so it works
with any language.

## Install

Production releases are pending: the first native release, `0.17.0`, has not
been published yet. Until then, build it from source.

- From a GitHub release (after `0.17.0`): download the executable for your
  platform from [GitHub Releases](https://github.com/salan70/docbridge/releases)
  and put it on your `PATH`, and make it executable. Assets cover Linux x64 and
  ARM64 (static musl), macOS x64 and ARM64, and Windows x64.
- With Nix: `nix profile install github:salan70/docbridge`, or use the flake
  output `packages.<system>.docbridge`.
- From source with Rust 1.83 or later:
  `cargo install --locked --git https://github.com/salan70/docbridge docbridge`.

`docbridge upgrade` replaces only a standalone installation that carries an
installation receipt. Nix and other package-managed installations are updated
through their package manager.

Upgrading from the npm package (`0.16.0` and earlier)? There is no
compatibility layer; see
[`crates/docbridge/guides/migration.md`](crates/docbridge/guides/migration.md)
(`docbridge docs show migration`).

## Guides

The CLI ships its guides, so they work offline:

```sh
docbridge docs list
docbridge docs show getting-started
```

Sources: [`crates/docbridge/guides/`](crates/docbridge/guides/).

- [Public contracts](docs/specs/vnext-contracts.md) — developer behavior contract
- [Release readiness and operations](docs/contributing/releasing.md)
- [Changelog](CHANGELOG.md)

## Contributing

See the [Contributor guide](docs/contributing/README.md).
