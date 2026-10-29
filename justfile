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
    just shell-sources | xargs -0 shfmt -w -ln bash -i 2 -ci -bn
    nixfmt flake.nix packaging/nixpkgs/package.nix

# Every tracked shell source, NUL-separated: `*.sh` plus the extension-less Git hooks.
[private]
shell-sources:
    @git ls-files -z '*.sh' '.githooks/*'

# Check formatting without modifying the worktree.
format-check: format-check-rust format-check-ox format-check-shell format-check-nix

format-check-rust:
    cargo fmt --all -- --check

# Markdown, JSON, and YAML.
format-check-ox:
    oxfmt --check .

format-check-shell:
    just shell-sources | xargs -0 shfmt -d -ln bash -i 2 -ci -bn

format-check-nix:
    nixfmt --check flake.nix packaging/nixpkgs/package.nix

# Run every linter over the whole repository.
lint: lint-rust lint-markdown lint-shell lint-nix lint-actions lint-ai-assets

lint-rust:
    cargo clippy --workspace --locked --target-dir {{ target_dir }} --all-targets -- -D warnings

lint-markdown:
    rumdl check .

lint-shell:
    just shell-sources | xargs -0 shellcheck --severity=style

lint-nix:
    statix check flake.nix
    deadnix --fail flake.nix

# Also fails while any workflow other than release-vnext.yml publishes.
lint-actions:
    actionlint
    scripts/check-legacy-publisher-retired.sh .github/workflows

# Check the canonical agent assets and their contributor references.
lint-ai-assets:
    scripts/check-ai-assets.sh
    bash scripts/test-ai-assets.sh

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

# Offline, read-only common gate shared by the pre-commit hook and CI.
verify: format-check lint test validate

# Build the release binary for this machine.
build:
    cargo build --package docbridge --release --locked --target-dir {{ target_dir }}

# Smoke-run the release binary for this machine, as each CI platform job does.
smoke: build
    scripts/smoke-vnext.sh {{ target_dir }}/release/docbridge

# Apply a release bump inside a pull request: roll CHANGELOG [Unreleased] into
# the new version and set it in every crate manifest. The `release: <kind>`
# label on the pull request must name the same kind.
release-bump KIND:
    scripts/release-bump.sh {{ KIND }}

# Check release labels and the change against origin/main, as the required
# `release-label` check does: `just check-release-label "release: patch"`.
[positional-arguments]
check-release-label +LABELS:
    scripts/check-release-label.sh origin/main "$@"

flake-check:
    nix flake check

install-git-hooks:
    git config core.hooksPath .githooks
