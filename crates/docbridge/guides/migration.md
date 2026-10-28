# Migration

vNext has no backward compatibility, automatic conversion, or migrate command. An AI agent or human must interpret the old links and review the result. Keep a backup and review changes before removing old assets.

1. Inventory in-code `@doc` annotations, Markdown `@code` annotations with symbols, and manifest entries. Record their intended relationships before removal.
2. Replace the old configuration with the required vNext configuration in [Configuration](configuration.md). Select managed paths and extensions deliberately.
3. Transfer each useful relationship to a Markdown section's file-level `@code` annotation. Symbol-level precision is lost: review the whole file and section for semantic agreement. Follow [Linking](linking.md).
4. Remove obsolete in-code annotations and manifest entries after checking their intent has been preserved. Review and replace the old Skill with the vNext Skill. Review CI, hooks, development scripts, LSP, and editor settings for old commands and references; update or remove them manually.
5. Run `docbridge validate` and resolve errors. Inspect `docbridge unlinked` for coverage, then review relationships and meaning with `docbridge links`.

The same-named `upgrade` changes purpose: the legacy upgrade workflows updated managed project assets, while vNext updates only an eligible standalone executable. It does not update Skills or project configuration. An old Skill without a valid ownership record is unmanaged: retire it manually before installing the new Skill. Nix and package-managed installations must be updated through their installation method. See [Removal](deinit.md) when retiring project assets or the executable.
