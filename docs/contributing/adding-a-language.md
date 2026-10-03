# Adding a Language

This checklist lists every place a new code language touches. The contracts
stay where they are: the worker protocol in
[Scanning](../specs/scanning.md#code-scanning), the conformance suite in
[Testing](testing.md#scanner-workers), and the layer rules in
[Module architecture](architecture.md). The completed
[Go](../plans/done/go-language-support-plan.md) and
[Rust](../plans/done/rust-language-support-plan.md) plans show the full
sequence and its decisions.

Whether the work needs a plan follows the [Writing Guidelines](writing.md).
`<lang>` below is the lowercase language ID.

## Worker

- [ ] Implement the worker under `packages/<lang>-scanner/` so that it speaks
      the protocol in `schemas/scanner-worker.schema.json`.
- [ ] Pin its toolchain in `flake.nix`, or document why the Nix shell cannot
      provide it, as for Swift.
- [ ] Add `build-<lang>-scanner` and `test-<lang>-scanner` recipes to the
      `justfile`, and add the build to `build-test-scanners`, which
      `just setup` runs.
- [ ] Add format and lint recipes for the worker sources to `format`,
      `format-check`, and `lint`.

## Core

- [ ] Add the ID to `CodeLanguage` in `src/model/types.ts` and
      `KNOWN_CODE_LANGUAGES` in `src/config/code-language.ts`.
- [ ] Add the extension and the accepted visibility values to
      `src/config/config.ts`. The worker applies the default visibility.
- [ ] Register the worker adapter in `src/scan/code/dispatch.ts`.
- [ ] Add the binary name and its source-checkout and package paths to
      `src/scan/code/worker/scanner-executable.ts`, or, for a worker that runs
      on an installed runtime, its runtime spec to
      `src/scan/code/worker/runtime-worker.ts`.
- [ ] Add candidate patterns and excluded files to
      `src/setup/init-discovery.ts`.
- [ ] Add the code-fence language to `src/lsp/hover.ts` and
      `src/cli/render/context.ts`.
- [ ] Register the language in `schemas/docbridge.schema.json`: an
      `include.code.properties.<lang>` reference and a `$defs.<lang>Entry`
      with its pattern suffix and visibility values.
- [ ] Add the ID to the language enum in each output schema and in
      `schemas/scanner-worker.schema.json`.

## Tests

- [ ] Add `src/scan/code/worker/<lang>-integration.test.ts` and cover the
      worker in `scanner-worker-conformance.test.ts`.
- [ ] Add a `<lang>` directory to every case under
      `test-fixtures/scanner-conformance/`, and add the language's input file
      name to `src/scan/code/conformance.test.ts`.
- [ ] Extend the per-diagnostic fixtures under `test-fixtures/diagnostics/`
      whose behavior depends on the language.
- [ ] Cover configuration acceptance and rejection in `src/config/config.test.ts`
      and discovery in `src/setup/init-discovery.test.ts`.
- [ ] Refresh `test-fixtures/self-audit/baseline.json` as
      [Self-audit](self-audit.md) describes.

## Distribution

- [ ] Build, test, and stage the worker in `.github/workflows/ci.yml` and
      `.github/workflows/release-publish.yml`.
- [ ] Stage the binary in `scripts/stage-scanner-binaries.ts` and smoke-test it
      in `scripts/smoke-packed-package.ts`.
- [ ] Bind the editor language in `editors/vscode/src/extension.ts`, and add
      its activation event to `editors/vscode/package.json` and
      `scripts/vscode-extension.ts`.

## Documentation

- [ ] Add `examples/<lang>/`, which `just check-example <lang>` checks.
- [ ] Specify the scanner in `docs/specs/scanning.md`, and update
      `configuration.md`, `annotations.md`, `diagnostics.md`, and `lsp.md`
      under `docs/specs/`.
- [ ] Update the English and Japanese user guides, including the language table
      in `configuration.md`, the declaration rules in `linking.md`, and
      `troubleshooting.md`.
- [ ] Update both READMEs, `editors/vscode/README.md`, `CONTRIBUTING.md`, and
      [Testing](testing.md).
- [ ] Add the user-facing change under `## [Unreleased]` in `CHANGELOG.md` and
      release it with `release: minor`.
