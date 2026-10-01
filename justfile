set shell := ["bash", "-eu", "-o", "pipefail", "-c"]

# The required Swift toolchain version. `.swift-version` is its only source.
swift_version := trim(read(".swift-version"))

# The required Go toolchain version. The `go` directive in the worker's
# `go.mod` is its only source; `GOTOOLCHAIN=local` stops Go from downloading a
# different one, and `check-go-toolchain` fails on any other installed version.
go_version := trim(replace_regex(read("packages/go-scanner/go.mod"), "(?s).*\ngo ([0-9.]+)\n.*", "$1"))

export GOTOOLCHAIN := "local"

default:
    just --list

# Install locked dependencies, build test scanner workers, and configure Git hooks.
setup:
    bun install --frozen-lockfile
    just install-editor-deps
    just build-test-scanners
    just install-git-hooks

# Install the editor client's own locked dependencies. It is a separate npm
# project with its own lockfile, so the root install does not cover it.
install-editor-deps:
    cd editors/vscode && bun install --frozen-lockfile

# Print the contributor toolchain versions and validate the required Swift version.
doctor: require-swift check-go-toolchain
    bun --version
    node --version
    dart --version
    rustc --version
    cargo --version
    go version
    just --version
    git --version

# Fail unless the Swift on `PATH` is the version in `.swift-version`.
[private]
require-swift:
    swift --version | grep -F 'Swift version {{ swift_version }} '

# Fail unless the Go on `PATH` is exactly the version pinned by `packages/go-scanner/go.mod`.
check-go-toolchain:
    test "$(go env GOVERSION)" = "go{{ go_version }}"

# Run every formatter in write mode. This is always an explicit operation.
format:
    bun run oxfmt .
    swift format format --configuration .swift-format --in-place --recursive packages/swift-scanner/Sources packages/swift-scanner/Tests examples/swift
    dart format packages/dart-scanner/bin packages/dart-scanner/lib packages/dart-scanner/test
    cargo fmt --manifest-path packages/rust-scanner/Cargo.toml
    gofmt -w packages/go-scanner examples/go
    just shell-sources | xargs -0 shfmt -w -ln bash -i 2 -ci -bn
    nixfmt flake.nix
    ruff format packages/python-scanner examples/python

# Every tracked shell source, NUL-separated: `*.sh` plus the extension-less Git hooks.
[private]
shell-sources:
    @git ls-files -z '*.sh' '.githooks/*'

# Check formatting without modifying the worktree.
format-check: format-check-ox format-check-swift format-check-dart format-check-rust format-check-go format-check-python format-check-shell format-check-nix

format-check-ox:
    bun run oxfmt --check .

format-check-swift: require-swift
    swift format lint --configuration .swift-format --strict --recursive packages/swift-scanner/Sources packages/swift-scanner/Tests examples/swift

format-check-dart:
    dart format --output=none --set-exit-if-changed packages/dart-scanner/bin packages/dart-scanner/lib packages/dart-scanner/test

format-check-rust:
    cargo fmt --manifest-path packages/rust-scanner/Cargo.toml -- --check

# `gofmt -l` exits 0 even when files differ, so fail on any listed path.
format-check-go: check-go-toolchain
    test -z "$(gofmt -l packages/go-scanner examples/go | tee /dev/stderr)"

format-check-shell:
    just shell-sources | xargs -0 shfmt -d -ln bash -i 2 -ci -bn

format-check-nix:
    nixfmt --check flake.nix

# Run every linter over the whole repository.
lint: lint-ox lint-markdown format-check-swift lint-dart lint-rust lint-go lint-python lint-java lint-shell lint-nix lint-actions

lint-ox:
    bun run oxlint . --deny-warnings

lint-markdown:
    rumdl check .

lint-dart:
    cd packages/dart-scanner && dart analyze --fatal-infos --fatal-warnings

lint-rust:
    cargo clippy --manifest-path packages/rust-scanner/Cargo.toml --all-targets -- -D warnings

lint-go: check-go-toolchain
    cd packages/go-scanner && go vet ./...

lint-shell:
    just shell-sources | xargs -0 shellcheck --severity=style

lint-nix:
    statix check flake.nix
    deadnix --fail flake.nix

lint-actions:
    actionlint

# Apply only Oxlint's safe fixes; suggestions and dangerous fixes stay opt-in.
lint-fix:
    bun run oxlint . --fix --deny-warnings

# Offline, read-only common gate shared by the pre-commit hook and CI.
verify: format-check lint check check-docs check-ai-assets typecheck typecheck-extension test test-python-scanner test-ruby-scanner test-java-scanner

check:
    bun run src/cli/index.ts check

check-docs:
    bun run scripts/check-docs.ts

# Fail when the Claude and Codex skill trees have drifted apart.
check-ai-assets:
    bun run scripts/check-ai-assets.ts

# Check one example project under `examples/`; extra flags such as `--json` pass through.
check-example lang="typescript" *ARGS:
    bun run src/cli/index.ts check --root examples/{{ lang }} {{ ARGS }}

audit:
    bun run src/cli/index.ts check --audit

# Compare live --audit keys against the committed repository baseline.
check-audit-baseline:
    bun run scripts/check-audit-baseline.ts

# Run check against one diagnostic fixture (see test-fixtures/diagnostics/). The
# fixture is expected to report its diagnostic, so a non-zero exit is ignored.
check-fixture code:
    -bun run src/cli/index.ts check --root test-fixtures/diagnostics/{{ code }} {{ if code =~ '^(undocumented_symbol|unlinked_doc_section)$' { "--audit" } else { "" } }}

# List counterparts of uncommitted changes that are themselves unchanged; exit 1 if any.
related-gate:
    { git diff --name-only HEAD; git ls-files --others --exclude-standard; } | bun run src/cli/index.ts related --stdin --gate

# Report the staged change set's gate violations with the flagged counterparts'
# content on stderr. Always exits 0; the pre-commit hook uses it as awareness.
related-gate-report:
    git diff --cached --name-only | bun run scripts/related-gate-report.ts

# Print the linked counterpart content of the uncommitted changes.
context:
    { git diff --name-only HEAD; git ls-files --others --exclude-standard; } | bun run src/cli/index.ts context --stdin

test:
    bun test

test-swift-scanner:
    swift test --package-path packages/swift-scanner

# Build the debug Swift/Rust workers, the compiled Dart and Go workers, and the Java
# worker JAR required by `just test`; the Python and Ruby workers run from source.
build-test-scanners:
    swift build --package-path packages/swift-scanner
    just build-dart-scanner
    just build-rust-scanner-debug
    just build-go-scanner
    just build-java-scanner

build-swift-scanner:
    swift build --package-path packages/swift-scanner -c release

test-dart-scanner:
    cd packages/dart-scanner && dart pub get --enforce-lockfile && dart test

build-dart-scanner:
    cd packages/dart-scanner && dart pub get --enforce-lockfile && dart compile exe bin/docbridge_dart_scanner.dart -o bin/docbridge_dart_scanner

test-rust-scanner:
    cargo test --manifest-path packages/rust-scanner/Cargo.toml

build-rust-scanner:
    cargo build --manifest-path packages/rust-scanner/Cargo.toml --release

build-rust-scanner-debug:
    cargo build --manifest-path packages/rust-scanner/Cargo.toml

test-go-scanner: check-go-toolchain
    cd packages/go-scanner && go test ./...

# Go has no debug/release split; this single static binary serves tests and releases.
build-go-scanner: check-go-toolchain
    cd packages/go-scanner && CGO_ENABLED=0 go build -trimpath -o bin/docbridge-go-scanner ./cmd/docbridge-go-scanner

# --- Python worker (packages/python-scanner) ---
# Recipes for the runtime-backed Python worker live between these markers.
# The worker is stdlib-only and needs no build; `python3` comes from the dev
# shell (CPython 3.13) and CI also runs the tests on the CPython 3.10 floor.
test-python-scanner:
    python3 -m unittest discover -s packages/python-scanner/tests

format-check-python:
    ruff format --check packages/python-scanner examples/python

lint-python:
    ruff check packages/python-scanner examples/python
# --- end Python worker ---

# --- Ruby worker (packages/ruby-scanner) ---
# Run the Ruby worker's minitest suite, which also drives the conformance cases
# through the executable with the loader flags the core uses. The runtime
# ships everything it needs (Prism and minitest are bundled), so there is no
# install step; no formatter or linter recipe exists because RuboCop would be a
# third-party dependency.
test-ruby-scanner:
    cd packages/ruby-scanner && ruby -w -Ilib -Itest test/run.rb
# --- end Ruby worker ---

# --- Java worker (packages/java-scanner) ---
# Recipes for the runtime-backed Java worker live between these markers.
# The JDK is the only toolchain: javac and jar, no Maven or Gradle. Main.java is
# compiled for Java 8 so `--probe` can answer `ok: false` on a JVM older than
# the 17 floor instead of failing to load; every other class targets 17.

build-java-scanner:
    rm -rf packages/java-scanner/build/classes
    find packages/java-scanner/src -name '*.java' ! -name Main.java | xargs javac --release 17 -encoding UTF-8 -d packages/java-scanner/build/classes
    javac --release 8 -encoding UTF-8 -cp packages/java-scanner/build/classes -d packages/java-scanner/build/classes packages/java-scanner/src/dev/docbridge/javascanner/Main.java
    jar --create --file packages/java-scanner/build/docbridge-java-scanner.jar --main-class dev.docbridge.javascanner.Main -C packages/java-scanner/build/classes .

# Build, compile the main-based test runner against the worker classes, and run it over tests/cases.
test-java-scanner: build-java-scanner
    rm -rf packages/java-scanner/build/test-classes
    find packages/java-scanner/tests/src -name '*.java' | xargs javac --release 17 -encoding UTF-8 -cp packages/java-scanner/build/classes -d packages/java-scanner/build/test-classes
    java -cp packages/java-scanner/build/classes:packages/java-scanner/build/test-classes dev.docbridge.javascanner.tests.TestMain packages/java-scanner/tests/cases

# javac is the linter: every lint category enabled, warnings are errors, output discarded.
lint-java:
    rm -rf packages/java-scanner/build/lint
    find packages/java-scanner/src packages/java-scanner/tests/src -name '*.java' | xargs javac --release 17 -encoding UTF-8 -Xlint:all -Werror -d packages/java-scanner/build/lint
# --- end Java worker ---

# Type-check the whole project with the TypeScript compiler (no emit). This is
# the gate that catches type drift `bun build` silently ignores.
typecheck:
    bun run tsc --noEmit

# Type-check the editor client. It is outside the root tsconfig's `include`, so
# `just typecheck` never sees it. Requires `just install-editor-deps`.
typecheck-extension:
    cd editors/vscode && bun run tsc --noEmit -p .

# Bundle the CLI and stage the runtime-backed workers under dist/workers. The
# Java worker JAR is rebuilt first, so building needs the JDK.
build: build-java-scanner
    rm -rf dist
    bun build src/cli/index.ts --outdir dist --target node
    chmod +x dist/index.js
    bun run scripts/stage-runtime-workers.ts

# Apply a release bump inside a pull request: set every versioned manifest and
# roll CHANGELOG [Unreleased] into the new version. The `release: <kind>` label
# on the pull request must name the same kind.
release-bump KIND:
    #!/usr/bin/env bash
    set -euo pipefail
    case "{{ KIND }}" in patch | minor | major) ;; *)
        echo "Usage: just release-bump <patch|minor|major>" >&2
        exit 1
        ;;
    esac
    # Roll the CHANGELOG first: it fails on an empty [Unreleased] before any
    # manifest is touched, so a failed bump leaves no partial change.
    version="$(bun -e "import { nextVersion } from './scripts/set-release-version.ts'; console.log(nextVersion(require('./package.json').version, '{{ KIND }}'))")"
    VERSION="$version" REPOSITORY=salan70/docbridge node .github/scripts/roll-changelog.mjs
    bun run scripts/set-release-version.ts {{ KIND }} > /dev/null
    echo "Bumped to ${version}"

# Check the release label and the change against a base ref, as the required
# `release-label` check does. Pass labels as a JSON array of names.
check-release-label LABELS BASE="origin/main":
    PR_LABELS='{{ LABELS }}' BASE_REF='{{ BASE }}' bun run scripts/release-label.ts

stage-scanner-binaries *ARGS:
    bun run scripts/stage-scanner-binaries.ts {{ ARGS }}

verify-dist:
    bun run scripts/verify-dist.ts

pack-smoke *ARGS:
    bun run scripts/smoke-packed-package.ts {{ ARGS }}

# Build a release VSIX under editors/vscode/.tmp/out. Requires every supported
# platform's scanner binaries staged under dist/bin; the runtime-backed workers
# are staged from this checkout.
package-vsix: build-java-scanner
    bun run scripts/vscode-extension.ts package

# Build the same VSIX for this machine only: it requires just the host
# platform's staged scanner binaries. This is what `just vscode-lsp` installs.
package-vsix-local: build-java-scanner
    bun run scripts/vscode-extension.ts package --local

# Verify a release VSIX. Pass a path to verify a non-default artifact.
verify-vsix *ARGS:
    bun run scripts/vscode-extension.ts verify {{ ARGS }}

# Verify a host-only VSIX built by `just package-vsix-local`.
verify-vsix-local *ARGS:
    bun run scripts/vscode-extension.ts verify --local {{ ARGS }}

# Publish a verified VSIX to VS Code Marketplace. Requires VSCE_PAT.
publish-vscode-extension *ARGS:
    bun run scripts/vscode-extension.ts publish-vscode {{ ARGS }}

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
