# npm Distribution Plan

This plan defines the first public npm distribution for SpecLink. The goal is
to make the CLI runnable through `bunx speclink` while keeping the package
layout, binary support, and release workflow explicit enough for small,
reviewable implementation slices.

Normative behavior will be reflected in these specs and docs as the slices
land:

- [CLI](../specs/cli.md)
- [Scanning](../specs/scanning.md)
- [Configuration](../specs/configuration.md)
- [Testing](../contributing/testing.md)

## Status

- [ ] Slice 1: Package Metadata and Dist Entry Point
- [ ] Slice 2: Dist Bundle Verification
- [ ] Slice 3: Scanner Binary Layout
- [ ] Slice 4: Platform-Aware Scanner Resolution
- [ ] Slice 5: Release Artifact Build Matrix
- [ ] Slice 6: npm Publish Workflow
- [ ] Slice 7: Documentation and Release Readiness

## Goals

- Publish the public npm package as `speclink`.
- Make `bunx speclink ...` the primary distribution path for the CLI.
- Keep the first npm release Bun-only; Node.js runtime compatibility is not a
  requirement.
- Ship `dist/` output rather than TypeScript source as the package executable.
- Point the npm `bin` entry directly at `./dist/index.js`.
- Include prebuilt first-party Swift and Dart scanner binaries in the main
  package.
- Officially support scanner binaries for `darwin-arm64` and `linux-x64` in
  the initial npm release.
- Keep the package tarball deterministic and small enough to inspect with
  `npm pack --dry-run`.

## Non-Goals

- Node.js runtime compatibility.
- Single-file or single-binary CLI distribution.
- Homebrew, Docker, system package manager, VS Code Marketplace, or PyPI
  distribution.
- Optional platform packages such as `@speclink/scanner-darwin-arm64`.
- Windows, `darwin-x64`, `linux-arm64`, or other platform support in the first
  npm release.
- Building Swift or Dart scanners on the user's machine during `npm install`.
- Publishing the package under a scoped name such as `@indee/speclink`, except
  as a future fallback if the unscoped npm name becomes unavailable.

## Decisions

### Package Name and Command

The public package name is `speclink`. The command name remains `speclink`.
The primary install-free invocation is:

```sh
bunx speclink check
```

The name is intentionally optimized for CLI discoverability and directness. It
is not treated as a globally unique commercial brand. The npm package and
repository documentation should make the product scope concrete: a CLI that
links Markdown specifications and code declarations.

### Runtime

The initial npm package is Bun-only. `dist/index.js` must keep a Bun shebang:

```sh
#!/usr/bin/env bun
```

The package should fail clearly when invoked without Bun rather than carrying a
Node compatibility wrapper. Node support can be designed later if demand
appears.

### Package Entry Point

The package executable is the built dist file:

```json
{
  "bin": {
    "speclink": "./dist/index.js"
  }
}
```

No separate wrapper script is planned for the first npm release.

### Package Contents

The package should include only files needed at runtime and for npm metadata.
The expected high-level package layout is:

```text
dist/
  index.js
  bin/
    darwin-arm64/
      speclink-swift-scanner
      speclink_dart_scanner
    linux-x64/
      speclink-swift-scanner
      speclink_dart_scanner
schemas/
  speclink.schema.json
  context-output.schema.json
  graph-output.schema.json
templates/
  skills/
README.md
CHANGELOG.md
LICENSE
package.json
```

Source files, tests, fixture projects, `.build/`, `.dart_tool/`, and other
development outputs should not be published.

### Scanner Binary Distribution

Swift and Dart scanner workers are distributed as prebuilt binaries. The first
supported platform set is:

- `darwin-arm64`
- `linux-x64`

The main package includes those binaries directly. Optional platform packages
are deferred until the supported platform set or package size makes them
necessary.

Runtime scanner resolution should derive the platform key from Bun's
Node-compatible process metadata:

```text
${process.platform}-${process.arch}
```

Only configured Swift or Dart projects require the corresponding scanner
binary. TypeScript and Markdown checks should continue to run on unsupported
platforms because they do not need scanner worker binaries.

If a configured Swift or Dart project runs on an unsupported platform, SpecLink
should report `code_scanner_unavailable` with a message that names the missing
platform key and the supported keys.

### Release Workflow

The existing release flow creates a GitHub Release and currently publishes
nothing to npm. This plan extends the release flow so merging a release PR can
publish the npm package after CI passes.

The release workflow should:

- Install Bun and project dependencies.
- Build `dist/index.js`.
- Build scanner binaries for `darwin-arm64` and `linux-x64`.
- Stage scanner binaries into the `dist/bin/<platform>/` layout.
- Run package verification against the staged dist.
- Run `npm pack --dry-run` and record the file list in CI output.
- Publish to npm only after all verification passes.

The implementation may use one workflow or split artifact build and publish
steps across jobs. The publish step must consume verified artifacts rather than
rebuilding unverified outputs.

## Agent Workflow

AI agents should work one slice at a time. Each slice should leave the
repository in a working state.

For each slice:

1. Read this plan and the relevant specs before editing code.
2. Add or update focused tests first for logic changes.
3. Keep generated binaries out of normal source commits unless the slice is
   explicitly about checked-in release fixtures.
4. Run `just test`.
5. Run the slice-specific verification commands.
6. Keep unrelated formatting, refactors, and generated output out of the diff.

## Slice 1: Package Metadata and Dist Entry Point

Purpose: make `package.json` describe a publishable Bun-only npm package.

Tasks:

- Remove or flip `"private": true`.
- Point `bin.speclink` at `./dist/index.js`.
- Add package metadata required for npm publication: description, license,
  repository, bugs, homepage, keywords, and runtime expectations.
- Add a `files` allowlist that excludes source, tests, fixtures, and local
  build caches.
- Keep local development scripts using source entry points where appropriate.

Verification:

```sh
just test
bun build src/cli/index.ts --outdir dist --target bun
npm pack --dry-run
```

Done when:

- npm metadata is publication-ready.
- `npm pack --dry-run` shows only expected runtime and metadata files.

## Slice 2: Dist Bundle Verification

Purpose: prove the built CLI works from `dist/index.js`.

Tasks:

- Add a repo-native verification command for the built CLI.
- Verify `dist/index.js --version`, `--help`, and `check --root examples/basic`.
- Verify the shebang is preserved and the file is executable after build.
- Decide whether `just build` should clean stale `dist/` before rebuilding.

Verification:

```sh
just build
dist/index.js --version
dist/index.js --help
dist/index.js check --root examples/basic
```

Done when:

- The built CLI passes the same basic smoke checks as the source CLI.

## Slice 3: Scanner Binary Layout

Purpose: stage prebuilt scanner workers into a stable package layout.

Tasks:

- Add a script or `just` recipe that stages scanner binaries under
  `dist/bin/<platform>/`.
- Ensure `.build/`, `.dart_tool/`, source scanner package internals, and test
  outputs are not staged.
- Preserve executable bits.
- Fail when an expected scanner binary is missing.

Verification:

```sh
just build
just build-swift-scanner
just build-dart-scanner
```

Then inspect the staged output:

```sh
find dist/bin -type f
```

Done when:

- `dist/bin/darwin-arm64/` contains both scanner workers on the current macOS
  development machine.

## Slice 4: Platform-Aware Scanner Resolution

Purpose: make runtime scanner lookup work from both source checkouts and npm
dist packages.

Tasks:

- Resolve scanner binaries from the source checkout during local development.
- Resolve scanner binaries from `dist/bin/<platform>/` when running from the
  npm package.
- Report `code_scanner_unavailable` for configured Swift/Dart projects on
  unsupported platforms or when a binary is missing.
- Keep TypeScript-only projects independent from scanner binary availability.

Tests:

- Source-layout scanner resolution still finds locally built Swift/Dart
  workers.
- Dist-layout scanner resolution selects the current platform key.
- Unsupported platform resolution returns a diagnostic that lists supported
  platforms.
- TypeScript-only scans do not require scanner binaries.

Verification:

```sh
just test
just check-example
```

Done when:

- Scanner resolution is deterministic across source and dist layouts.

## Slice 5: Release Artifact Build Matrix

Purpose: build verified scanner binaries for every initially supported
platform.

Tasks:

- Add CI jobs for `darwin-arm64` and `linux-x64` scanner builds.
- Build the Swift scanner in release mode for each platform.
- Build the Dart scanner executable for each platform.
- Upload platform scanner artifacts with stable names.
- Add checksum generation for the artifacts.

Verification:

```sh
just build-swift-scanner
just build-dart-scanner
```

Done when:

- CI produces verified scanner artifacts for both initial platforms.

## Slice 6: npm Publish Workflow

Purpose: extend release automation to publish the verified npm package.

Tasks:

- Add npm trusted publishing or an npm token secret.
- Wire release publish to consume the verified `dist/` and scanner artifacts.
- Run `npm pack --dry-run` before `npm publish`.
- Ensure publish only runs from the release approval path.
- Keep GitHub Release creation and npm publishing tied to the same version.

Verification:

```sh
npm pack --dry-run
```

Done when:

- A release merge can publish the npm package without local tagging or manual
  artifact assembly.

## Slice 7: Documentation and Release Readiness

Purpose: make the public docs match the npm distribution behavior.

Tasks:

- Document `bunx speclink ...` in `README.md`.
- Document supported platforms and Bun runtime requirements.
- Document Swift/Dart scanner support and unsupported-platform behavior.
- Update Japanese docs under `docs/ja/` after the English docs settle.
- Add release notes under `CHANGELOG.md`.
- Verify package contents and local tarball execution.

Verification:

```sh
just check
just test
npm pack --dry-run
```

Done when:

- A user can discover the npm package, run it through `bunx`, and understand
  the Swift/Dart platform support boundaries.
