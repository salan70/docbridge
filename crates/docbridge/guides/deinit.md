# Removal

Use `docbridge deinit --dry-run` to inspect the complete removal plan and detected DocBridge references. The resolved root is displayed before interactive confirmation; noninteractive input without confirmation fails without changes. The confirmed plan removes configuration and only recognizable standalone DocBridge annotation lines outside examples and ordinary comments. Ordinary Markdown, comments, code examples and malformed lookalikes are preserved; review lookalikes manually. Annotation-looking lines inside an unclosed `<pre>`, `<script>`, `<style>` or `<textarea>` block are preserved, and the removal is reported as incomplete. Only owned, unchanged Skill files are removed; modified or unowned files are reported and preserved. Even edited configuration requires confirmation before removal.

Before the first write, every target is checked against the confirmed plan; if any file changed since, nothing is written. Each file then changes in one atomic step: a rewrite goes through a temporary file in the same directory that replaces the original and keeps its permissions. If a run fails partway, it lists the files that changed and those that did not, and the removal is not reported as complete. Run `docbridge deinit` again to finish; completed changes are not repeated. Documentation is rewritten first and the configuration is removed last, so the rerun still finds the documentation to clean. Each ownership record is removed only after the Skill files and directories it covers, so the rerun still knows what DocBridge installed. A directory that cannot be removed also fails the run. Files named exactly `.docbridge-tmp-<digits>-<digits>-<digits>` in a Skill directory are temporary files left by an interrupted write; `deinit` and `init` list and remove them, and they never make a Skill directory unmanaged. A file the ownership record lists is judged by its hash instead, whatever its name.

## Uninstalling the CLI by installation method

`deinit` never removes the CLI itself. Its plan ends with uninstall guidance; check how DocBridge was installed first, then use the matching method.

- Downloaded executable: delete the file. Remove only the verified installed executable.
- Nix profile: run `nix profile list`, then `nix profile remove <verified-entry>`.
- Declarative Nix or Home Manager: remove the declared package from the flake or Home Manager configuration and rebuild the owning configuration. `deinit` and these instructions never edit Nix-managed files; make that change yourself.
- Cargo: `cargo uninstall docbridge`.
- Legacy npm installation: `npm uninstall -g docbridge`. This is separate from the standalone binary; run it only if DocBridge was installed through npm.
- Unknown provenance: run `docbridge docs` and choose a method after confirming how the executable got there.

## Remaining references

The plan lists each file under `Manual reference cleanup:` when it mentions DocBridge. `deinit` only reports them and never rewrites them. Review CI workflows, Git hooks (`.githooks`, `.husky`, `lefthook.yml`, `.pre-commit-config.yaml`), development scripts (`scripts`, `justfile`, `Makefile`, `package.json`), `flake.nix`, and agent instruction files such as `AGENTS.md` and `CLAUDE.md`, then remove those calls by hand.
