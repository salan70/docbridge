# Nixpkgs pull request draft

Pending: the first vNext release `v0.17.0` and the maintainer's submission.

- Branch: `docbridge-init`, based on `master`.
- File: `pkgs/by-name/do/docbridge/package.nix`, copied from
  [`package.nix`](package.nix) with both hashes filled in.
- Commit message and pull request title: `docbridge: init at 0.17.0`.

Replace the `<...>` placeholders, then paste everything below the line as the
pull request body. Tick only what you actually ran.

---

## Description of changes

Adds [DocBridge](https://github.com/salan70/docbridge) 0.17.0. DocBridge is a
CLI that keeps Markdown design docs and the code they describe linked. It
validates `@doc` / `@code` annotations and reports which counterparts a change
leaves stale.

- Built from the tagged Rust source with the upstream `Cargo.lock`, not the
  release binaries.
- Runs the upstream workspace tests (`cargoTestFlags = [ "--workspace" ]`).
- The CLI has no `--version` flag, so `versionCheckHook` is not used; the
  install check runs `docbridge --help` and `docbridge docs list`.
- Upstream release notes:
  <https://github.com/salan70/docbridge/blob/v0.17.0/CHANGELOG.md>.
- Maintainer: <maintainer handle>, added to `maintainers/maintainer-list.nix`
  in a separate commit if not already present.

## Things done

- Built on platform:
  - [ ] x86_64-linux
  - [ ] aarch64-linux
  - [ ] x86_64-darwin
  - [ ] aarch64-darwin
- Tested, as applicable:
  - [ ] Package tests (the upstream workspace tests run in `checkPhase`)
- [ ] Ran `nixpkgs-review` on this PR. See
      [nixpkgs-review usage](https://github.com/Mic92/nixpkgs-review#usage).
- [ ] Tested basic functionality of all binary files, usually in `./result/bin/`.
- [ ] Fits
      [CONTRIBUTING.md](https://github.com/NixOS/nixpkgs/blob/master/CONTRIBUTING.md),
      [pkgs/README.md](https://github.com/NixOS/nixpkgs/blob/master/pkgs/README.md),
      and the other contributing documentation in the corresponding paths.
