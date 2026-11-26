# Automation

Use `docbridge validate` to check structural consistency in CI or a hook. It exits 0 on success and 1 on errors. Unlinked items are not errors, so inspect `docbridge unlinked` separately when coverage matters.

## GitHub Actions

On a GitHub-hosted Ubuntu runner, use a pinned version and checksum:

```yaml
- name: Validate documentation links
  env:
    DOCBRIDGE_VERSION: 0.17.0
    DOCBRIDGE_SHA256: 6660b2da8004687529d96bc967a3b29bbd088e8de53e1b1b62c681ccf79af2aa
  run: |
    docbridge="$RUNNER_TEMP/docbridge"
    curl -fsSL -o "$docbridge" "https://github.com/salan70/docbridge/releases/download/v${DOCBRIDGE_VERSION}/docbridge-x86_64-unknown-linux-musl"
    echo "$DOCBRIDGE_SHA256  $docbridge" | sha256sum -c -
    chmod +x "$docbridge"
    "$docbridge" validate
```

Copy the checksum for `docbridge-x86_64-unknown-linux-musl` from the `SHA256SUMS` asset of the release that you pin. When another file pins the DocBridge version, such as a Nix flake, update that pin in the same change as `DOCBRIDGE_VERSION` and `DOCBRIDGE_SHA256`.

Use `docbridge links` to provide directly related files and sections for a human or AI semantic review. `--include-content` includes full, untruncated content. For structured consumers, `--json` returns nodes and edges. Handle partial success exit 2 and stderr warnings before treating the result as complete.

To review the files a branch changes, feed its diff into `links` and pass `--ignore-unmanaged` so entries outside the managed set do not make the result incomplete:

```sh
git -c core.quotePath=false diff --name-only --diff-filter=d origin/main...HEAD | docbridge links --stdin --ignore-unmanaged
```

Invalid section selectors, missing or unreadable managed files, and unsafe paths in the list are still reported, so an exit 2 keeps its partial-result meaning. A list made only of unmanaged entries exits 0 with an empty graph only when the project has no other diagnostics; project-wide diagnostics, such as a broken annotation elsewhere, still make the result incomplete. Git octal-escapes non-ASCII paths by default; `-c core.quotePath=false` keeps them literal so `links` can read them.

The old `related --gate` workflow is not part of vNext. Structural checks cannot decide whether code and documentation mean the same thing, so keep semantic review as an explicit separate step. With `--json`, warnings and errors go to stderr and stdout stays valid JSON.
