# Security model

This is the threat model for DocBridge, a CLI that keeps Markdown documentation in sync with the code that implements it.
Security scans and design reviews use it as the baseline for what to protect and from whom.

## Decisions by the owner

- No asset ranks above another; all are treated equally.
- The attackers are the ones listed under "Attackers".
- Findings carry CVE and OWASP category tags.

## Components

| Name              | Code                                                                                    | Kind         |
| ----------------- | --------------------------------------------------------------------------------------- | ------------ |
| docbridge-cli     | `crates/docbridge/`                                                                     | Local CLI    |
| docbridge-release | `crates/xtask/`, `.github/workflows/` (release and provenance attestation), `flake.nix` | Distribution |

## Trust boundaries and entry points

- The CLI may run inside an untrusted repository, reading its Markdown, config, and file tree.
- Managed paths are root-relative and must not traverse symlinks or reparse points out of the repository.
- Releases are built by GitHub Actions and published with provenance attestation.

## Assets

- Files on the user's machine outside the repository being processed.
- Integrity of released binaries and packages.

## Attackers

- Authors of a malicious repository, Markdown, or config that DocBridge processes.
- Supply chain (dependency crates, GitHub Actions).

## Existing controls

- Path safety checks that reject symlinks and reparse points.
- Provenance attestation for releases.
