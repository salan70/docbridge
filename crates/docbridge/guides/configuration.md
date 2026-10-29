# Configuration

DocBridge vNext requires `docbridge.config.json`. Select code by paths and extensions, and documentation by paths. Markdown uses the `.md` extension; DocBridge does not classify code by language.

```json
{
  "include": {
    "code": {
      "paths": ["src", "packages/*/src"],
      "extensions": [".ts", ".tsx", ".js"]
    },
    "docs": ["docs"]
  },
  "exclude": { "code": ["**/*.test.ts", "**/*.d.ts"] }
}
```

Globs support segment-local `*` and recursive `**`. Exclusions take precedence; empty include lists select no files, and unknown keys are errors (`"exclude": {}` is valid). Extensions are case-sensitive. Managed paths are root-relative with `/`; absolute paths, `..`, backslashes and `#` in filenames are rejected. `.` is allowed only as a discovery root. Windows drive prefixes such as `C:/x` and `C:foo` are rejected everywhere; other colons are accepted on Unix but rejected on Windows to protect against alternate data streams, and names invalid on the host platform fail when read.

`include.code.paths` and `include.docs` select directories, including directories matched by a glob; their descendants are discovered recursively. The `links` selector glob is different: it selects managed file paths. The selected root is canonicalized, but symlinks or reparse points in managed paths are rejected and discovery never follows them. Git metadata is always avoided; other hidden paths follow configuration. Unreadable, non-UTF-8 or NUL-containing files make the result incomplete. Without `--root`, commands requiring configuration use only the current directory, never an ancestor.

`docbridge init` proposes paths and extensions. It does not overwrite an existing configuration or change links or CI. Noninteractive init without `--yes` may inspect or dry-run but cannot write. `--force` replaces only recorded managed Skill files; it never follows symlinks or deletes unrecorded files. The default Skill is `.agents/skills/docbridge/`; `--claude` adds `.claude/skills/docbridge/`. A record inside each Skill identifies owned files by confined relative paths and content hashes. Invalid records, escaping paths and symlinks cannot authorize removal; an old Skill without a valid record is unmanaged and must be retired manually before init.
