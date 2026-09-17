# Link Manifest

A project may declare links in an optional root file `docbridge.links.json`
instead of writing `@doc` and `@code` annotations. The manifest exists for
projects that do not accept tool-specific markers in their source files.
Annotation linking stays the primary style, and both styles may be used in one
project.

A manifest entry declares both directions of one link at once:

```json
{
  "$schema": "./schemas/docbridge.links.schema.json",
  "links": [
    {
      "code": "src/auth/login.ts#AuthService.login",
      "doc": "docs/auth.md#login-flow",
      "note": "optional, for human readers only"
    }
  ]
}
```

`code` and `doc` use the `file#fragment` grammar in
[Link resolution](link-resolution.md). `note` must be a string when present and
has no effect on any output. Unknown keys are errors, at the top level and
inside an entry, except the top-level `$schema`.

The backlink checks of the pair model do not apply to manifest links. One entry
supplies both directions, so DocBridge checks only that both targets exist. The
trade-off is that a manifest link is invisible to a reader of the code or the
document; `related --gate` in continuous integration is the remaining safety
net.

<!-- @code src/core/json-source.ts#parseJsonSource -->

## Manifest Syntax

The manifest is parsed with a position-tracking reader so every diagnostic can
name the line and column of the offending entry. The accepted grammar is RFC
8259 exactly, matching `JSON.parse`: no comments, no trailing commas, no
unquoted keys, and no leading byte order mark. Columns count UTF-16 code units,
the same unit the code scanners report.

<!-- @code src/core/link-manifest.ts#loadLinkManifest -->

## Loading the Manifest

An absent manifest is not an error. A project that links only with annotations
never creates one.

A manifest that cannot be parsed reports `config_file_invalid`. A wrong shape
reports `config_invalid_value`, and an unrecognized key reports
`config_unknown_key`. Each carries `docbridge.links.json` as its target, names
the offending path such as `links[2].code` in its message, and locates the
line and column. All three stop scanning, the way a broken
[configuration](configuration.md) file does, because a manifest DocBridge
cannot read makes the whole declared link set unreliable.

A `code` or `doc` value that violates the target grammar reports
`invalid_link_target` at the value and skips that entry alone. The remaining
entries are still trustworthy, so one typo must not hide every other entry's
diagnostics.
