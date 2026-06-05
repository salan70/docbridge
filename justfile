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

flake-check:
    nix flake check
