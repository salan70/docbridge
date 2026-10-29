# Migration

vNext has no backward compatibility, automatic conversion, or migrate command. An AI agent or human must interpret the old links and review the result. Keep a backup (for example, a Git branch) and review changes before removing old assets.

Legacy forms that vNext rejects with an error:

- `docbridge.config.json` with `$schema`, language-keyed `include.code.<language>.patterns`, or any other unknown key.
- `@code path#Symbol` annotations in Markdown. Links address files, so the target must be `path`.
- The commands `check`, `related`, `context`, `graph`, and `lsp`, and any `--gate` or `--audit` flags.

Legacy assets that vNext silently ignores, and that this guide still removes:

- `@doc` annotations in code comments.
- `docbridge.links.json` Manifest entries.

Warning: `docbridge validate` cannot detect a relationship that survives only in an ignored asset. It exits 0 even if every `@doc` and Manifest entry is left unconverted, and those relationships are then lost without any diagnostic. Do the inventory (step 1) and conversion (step 4) explicitly, and compare `docbridge links --json` with your inventory before deleting the old assets.

## Steps

1. Inventory the old relationships. List every in-code `@doc <doc>#<anchor>`, every Markdown `<!-- @code <file>#<Symbol> -->`, and every `links` entry in `docbridge.links.json` (`code` and `doc` fields). Write down each pair as a (Markdown section, code file) pair. For `@doc docs/auth.md#login-spec` in `src/auth/login.ts`, the pair is section `docs/auth.md#login-spec` and file `src/auth/login.ts`.
2. Replace `docbridge.config.json`. Delete the old contents and write the vNext shape from [Configuration](configuration.md): `include.code.paths` (directories), `include.code.extensions` (for example `[".ts"]`), and `include.docs` (directories). Convert each old pattern such as `src/**/*.ts` to the directory `src` plus the extension `.ts`. Remove `$schema`. Use `"exclude": {}` if nothing is excluded.
3. Rewrite Markdown annotations. In each `<!-- @code path#Symbol -->`, delete everything from `#` to the end of the target, giving `<!-- @code path -->`. Keep the annotation directly before its heading. If two annotations on one heading now name the same file, keep one; duplicates are errors.
4. Convert in-code `@doc` annotations and Manifest entries. For each pair from step 1 that has no Markdown annotation yet, add `<!-- @code <file> -->` directly before the target section's heading. If the section does not exist, create it or drop the relationship. Then delete the `@doc` lines from code comments (remove the whole comment if nothing else is in it) and delete `docbridge.links.json`.
5. Review for information loss. Symbol-level links named a function or class; file-level links name the whole file. For every converted link, read the whole file and the whole section and confirm they still agree in meaning. Record anything that the symbol precision used to express in the section text.
6. Retire the old Skill. Delete `.agents/skills/docbridge/` (and `.claude/skills/docbridge/` or other copies) manually; an old Skill without a valid ownership record is unmanaged and `init` will not replace it. Then run `docbridge init --yes` to install the vNext Skill. It preserves the configuration you wrote in step 2.
7. Update CI, hooks, and scripts. Replace `docbridge check` with `docbridge validate`. Delete every `docbridge related ... --gate` step, since the gate is not part of vNext; schedule semantic review separately with `docbridge links --include-content`. Remove the `|| true` fallback that only protected the old gate. Update package scripts and development recipes the same way.
8. Remove editor configuration. Delete the DocBridge extension (for example `salan70.docbridge`) from `.vscode/extensions.json` recommendations and from `.vscode/settings.json`. Delete the file if nothing else remains in it. vNext has no LSP or editor extension.
9. Run `docbridge validate` until it exits 0. Inspect `docbridge unlinked` for coverage, then review relationships and meaning with `docbridge links`. Finally search the project for leftovers: `@doc`, `docbridge.links.json`, `#` after a `@code` path, `docbridge check`, and `related`.

The legacy `upgrade` command, which updated managed project assets, has no vNext equivalent. The CLI does not update itself; update it through its installation method. See [Removal](deinit.md) when retiring project assets or the executable.
