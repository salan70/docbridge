set shell := ["bash", "-eu", "-o", "pipefail", "-c"]

default:
    just --list

check:
    bun run src/cli/index.ts check

check-example:
    bun run src/cli/index.ts check --root examples/basic

check-example-json:
    bun run src/cli/index.ts check --root examples/basic --json

audit:
    bun run src/cli/index.ts check --audit

test:
    bun test

build:
    bun build src/cli/index.ts --outdir dist --target bun

# Exercise the language server (hover, definition, references, diagnostics) over stdio.
verify-lsp:
    bun run scripts/lsp-verify.ts

# Install the SpecLink editor extension into Cursor and open this workspace.
cursor-lsp:
    scripts/cursor-lsp.sh

# Install the SpecLink editor extension into VS Code and open this workspace.
vscode-lsp:
    scripts/cursor-lsp.sh code

flake-check:
    nix flake check

install-git-hooks:
    git config core.hooksPath .githooks
