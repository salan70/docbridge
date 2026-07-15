set shell := ["bash", "-eu", "-o", "pipefail", "-c"]

default:
    just --list

# Install locked dependencies and configure this repository's Git hooks.
setup:
    bun install --frozen-lockfile
    cd packages/dart-scanner && dart pub get --enforce-lockfile
    just install-git-hooks

# Run every formatter in write mode. This is always an explicit operation.
format:
    bun run oxfmt .
    swift format format --configuration .swift-format --in-place --recursive packages/swift-scanner/Sources packages/swift-scanner/Tests examples/swift
    dart format packages/dart-scanner/bin packages/dart-scanner/lib packages/dart-scanner/test
    git ls-files -z '*.sh' | xargs -0 shfmt -w -ln bash -i 2 -ci -bn
    nixfmt flake.nix

# Check formatting without modifying the worktree.
format-check: format-check-ox format-check-swift format-check-dart format-check-shell format-check-nix

format-check-ox:
    bun run oxfmt --check .

format-check-swift:
    swift --version | rg 'Swift version 6\.2\.1'
    swift format lint --configuration .swift-format --strict --recursive packages/swift-scanner/Sources packages/swift-scanner/Tests examples/swift

format-check-dart:
    dart format --output=none --set-exit-if-changed packages/dart-scanner/bin packages/dart-scanner/lib packages/dart-scanner/test

format-check-shell:
    git ls-files -z '*.sh' | xargs -0 shfmt -d -ln bash -i 2 -ci -bn

format-check-nix:
    nixfmt --check flake.nix

# Run every linter over the whole repository.
lint: lint-ox lint-markdown lint-swift lint-dart lint-shell lint-nix lint-actions

lint-ox:
    bun run oxlint . --deny-warnings

lint-markdown:
    rumdl check .

lint-swift: format-check-swift

lint-dart:
    cd packages/dart-scanner && dart analyze --fatal-infos --fatal-warnings

lint-shell:
    git ls-files -z '*.sh' | xargs -0 shellcheck --severity=style

lint-nix:
    statix check flake.nix
    deadnix --fail flake.nix

lint-actions:
    actionlint

# Apply only Oxlint's safe fixes; suggestions and dangerous fixes stay opt-in.
lint-fix:
    bun run oxlint . --fix --deny-warnings

# Offline, read-only common gate for local hooks and AI-agent Stop hooks.
verify: format-check lint check typecheck test

check:
    bun run src/cli/index.ts check

check-example:
    bun run src/cli/index.ts check --root examples/typescript

check-swift-example:
    bun run src/cli/index.ts check --root examples/swift

check-dart-example:
    bun run src/cli/index.ts check --root examples/dart

check-example-json:
    bun run src/cli/index.ts check --root examples/typescript --json

audit:
    bun run src/cli/index.ts check --audit

# Run check against one diagnostic fixture (see test-fixtures/diagnostics/). The
# fixture is expected to report its diagnostic, so a non-zero exit is ignored.
check-fixture code:
    -bun run src/cli/index.ts check --root test-fixtures/diagnostics/{{ code }} {{ if code == "undocumented_symbol" { "--audit" } else { "" } }}

# List counterparts of uncommitted changes that are themselves unchanged; exit 1 if any.
related-gate:
    { git diff --name-only HEAD; git ls-files --others --exclude-standard; } | bun run src/cli/index.ts related --stdin --gate

# Print the linked counterpart content of the uncommitted changes.
context:
    { git diff --name-only HEAD; git ls-files --others --exclude-standard; } | bun run src/cli/index.ts context --stdin

test:
    bun test

test-swift-scanner:
    swift test --package-path packages/swift-scanner

build-swift-scanner:
    swift build --package-path packages/swift-scanner -c release

test-dart-scanner:
    cd packages/dart-scanner && dart pub get --enforce-lockfile && dart test

build-dart-scanner:
    cd packages/dart-scanner && dart pub get --enforce-lockfile && dart compile exe bin/speclink_dart_scanner.dart -o bin/speclink_dart_scanner

# Type-check the whole project with the TypeScript compiler (no emit). This is
# the gate that catches type drift `bun build` silently ignores.
typecheck:
    bun run tsc --noEmit

build:
    rm -rf dist
    bun build src/cli/index.ts --outdir dist --target node
    chmod +x dist/index.js

stage-scanner-binaries *ARGS:
    bun run scripts/stage-scanner-binaries.ts {{ ARGS }}

verify-dist:
    bun run scripts/verify-dist.ts

pack-smoke *ARGS:
    bun run scripts/smoke-packed-package.ts {{ ARGS }}

# Build a release VSIX under editors/vscode/.tmp/out.
package-vsix:
    bun run scripts/vscode-extension.ts package

# Verify a release VSIX. Pass a path to verify a non-default artifact.
verify-vsix *ARGS:
    bun run scripts/vscode-extension.ts verify {{ ARGS }}

# Publish a verified VSIX to VS Code Marketplace. Requires VSCE_PAT.
publish-vscode-extension *ARGS:
    bun run scripts/vscode-extension.ts publish-vscode {{ ARGS }}

# Exercise the language server (hover, definition, references, diagnostics) over stdio.
verify-lsp:
    bun run scripts/lsp-verify.ts

# Install the DocBridge editor extension into VS Code and open this workspace.
vscode-lsp:
    scripts/install-vscode-compatible-lsp.sh code

# Install the same VS Code-compatible extension into Cursor and open this workspace.
cursor-lsp:
    scripts/install-vscode-compatible-lsp.sh cursor

flake-check:
    nix flake check

install-git-hooks:
    git config core.hooksPath .githooks
