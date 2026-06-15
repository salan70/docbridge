set shell := ["bash", "-eu", "-o", "pipefail", "-c"]

default:
    just --list

check:
    bun run src/cli/index.ts check

check-example:
    bun run src/cli/index.ts check --root examples/basic

check-swift-example:
    bun run src/cli/index.ts check --root fixtures/multilanguage/swift-basic

check-dart-example:
    bun run src/cli/index.ts check --root fixtures/multilanguage/dart-basic

check-example-json:
    bun run src/cli/index.ts check --root examples/basic --json

audit:
    bun run src/cli/index.ts check --audit

# Run check against one diagnostic fixture (see fixtures/diagnostics/). The
# fixture is expected to report its diagnostic, so a non-zero exit is ignored.
check-fixture code:
    -bun run src/cli/index.ts check --root fixtures/diagnostics/{{ code }} {{ if code == "undocumented_symbol" { "--audit" } else { "" } }}

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
    cd packages/dart-scanner && dart pub get && dart test

build-dart-scanner:
    cd packages/dart-scanner && dart pub get && dart compile exe bin/speclink_dart_scanner.dart -o bin/speclink_dart_scanner

# Type-check the whole project with the TypeScript compiler (no emit). This is
# the gate that catches type drift `bun build` silently ignores.
typecheck:
    bunx tsc --noEmit

build:
    bun build src/cli/index.ts --outdir dist --target bun

# Exercise the language server (hover, definition, references, diagnostics) over stdio.
verify-lsp:
    bun run scripts/lsp-verify.ts

# Install the SpecLink editor extension into VS Code and open this workspace.
vscode-lsp:
    scripts/install-vscode-compatible-lsp.sh code

# Install the same VS Code-compatible extension into Cursor and open this workspace.
cursor-lsp:
    scripts/install-vscode-compatible-lsp.sh cursor

flake-check:
    nix flake check

install-git-hooks:
    git config core.hooksPath .githooks
