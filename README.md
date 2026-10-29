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

To verify a downloaded executable, download `SHA256SUMS` from the same release
and run, in the download directory:

```sh
gh attestation verify docbridge-<target> --repo salan70/docbridge \
  --signer-workflow salan70/docbridge/.github/workflows/release-vnext.yml \
  --source-ref refs/heads/main
sha256sum -c --ignore-missing SHA256SUMS
```

On macOS, use `shasum -a 256 -c --ignore-missing SHA256SUMS` for the second
command. `gh attestation verify` checks that the file was built from `main` by
this repository's release workflow; the checksum command checks it against the
release checksums.

### Update

DocBridge does not update itself. Update it the way you installed it:

- GitHub release: download the new executable and replace the old one.
- Nix: `nix profile upgrade docbridge` (see `nix profile list` for the entry
  name).
- Cargo:
  `cargo install --locked --force --git https://github.com/salan70/docbridge docbridge`.

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
