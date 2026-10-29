set shell := ["bash", "-eu", "-o", "pipefail", "-c"]

# Build output for every Cargo recipe, outside the repository's managed paths.
target_dir := ".tmp/rust-vnext"

default:
    just --list

# Configure the Git hooks.
setup:
    just install-git-hooks

# Print the contributor toolchain versions.
doctor:
    rustc --version
    cargo --version
    just --version
    git --version

# Run every formatter in write mode. This is always an explicit operation.
format:
    cargo fmt --all
    oxfmt .
    nixfmt flake.nix packaging/nixpkgs/package.nix

# Every tracked shell source, NUL-separated: `*.sh` plus the extension-less Git hooks.
[private]
shell-sources:
    @git ls-files -z '*.sh' '.githooks/*'

# Check formatting without modifying the worktree.
format-check: format-check-rust format-check-ox format-check-nix

format-check-rust:
    cargo fmt --all -- --check

# Markdown, JSON, and YAML.
format-check-ox:
    oxfmt --check .

format-check-nix:
    nixfmt --check flake.nix packaging/nixpkgs/package.nix

# Run every linter over the whole repository.
lint: lint-rust lint-markdown lint-shell lint-actions

lint-rust:
    cargo clippy --workspace --locked --target-dir {{ target_dir }} --all-targets -- -D warnings

lint-markdown:
    rumdl check .

lint-shell:
    just shell-sources | xargs -0 shellcheck --severity=style

lint-actions:
    actionlint

test:
    cargo test --workspace --locked --target-dir {{ target_dir }}

# Validate this repository's own links with the CLI built from this checkout.
validate:
    cargo run --quiet --package docbridge --locked --target-dir {{ target_dir }} -- validate

# List the code files and Markdown regions of this repository that no link covers.
unlinked:
    cargo run --quiet --package docbridge --locked --target-dir {{ target_dir }} -- unlinked

# Show direct links of the given selectors (every link without one); flags such as `--include-content` pass through.
[positional-arguments]
links *ARGS:
    cargo run --quiet --package docbridge --locked --target-dir {{ target_dir }} -- links "$@"

# Offline, read-only gate that CI runs; the pre-commit hook runs only `format-check` and `validate`.
verify: format-check lint test validate

# Build the release binary for this machine.
build:
    cargo build --package docbridge --release --locked --target-dir {{ target_dir }}

# Prepare a release pull request: set the workspace version and roll CHANGELOG
# [Unreleased] into `## [VERSION] - <today, UTC>`.
release VERSION:
    cargo run --quiet --locked -p xtask --target-dir {{ target_dir }} -- release {{ VERSION }} "$(date -u +%F)"

flake-check:
    nix flake check

install-git-hooks:
    git config core.hooksPath .githooks
