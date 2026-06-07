# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0] - 2026-06-07

Initial release of the SpecLink CLI.

### Added

- `@doc` annotation parsing from TypeScript JSDoc via the TypeScript Compiler API.
- `@code` annotation parsing from Markdown HTML comments.
- Markdown scanner with v0.1 heading anchor generation.
- Configuration loading (`speclink.config.json`) with `*`/`**` glob scanning.
- Bidirectional link resolution between code and documentation.
- Deterministic, machine-readable diagnostics.
- `speclink check` command with `--root`, `--json`, and `--audit` options.
- `speclink --version` (alias `-v`) and `speclink --help` (alias `-h`).

[0.1.0]: https://github.com/salan70/spec-link/releases/tag/v0.1.0
