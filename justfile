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

# List counterparts of uncommitted changes that are themselves unchanged; exit 1 if any.
related-gate:
    { git diff --name-only HEAD; git ls-files --others --exclude-standard; } | bun run src/cli/index.ts related --stdin --gate

test:
    bun test

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
