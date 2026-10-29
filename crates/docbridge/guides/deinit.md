# Removal

Use `docbridge deinit --dry-run` to inspect the complete removal plan and detected DocBridge references. The resolved root is displayed before interactive confirmation; noninteractive input without confirmation fails without changes. The confirmed plan removes configuration and only recognizable standalone DocBridge annotation lines outside examples and ordinary comments. Ordinary Markdown, comments, code examples and malformed lookalikes are preserved; review lookalikes manually. Annotation-looking lines inside an unclosed `<pre>`, `<script>`, `<style>` or `<textarea>` block are preserved, and the removal is reported as incomplete. Only owned, unchanged Skill files are removed; modified or unowned files are reported and preserved. Even edited configuration requires confirmation before removal.

Removal targets are preflighted before writes, with originals retained in a persistent private recovery directory until completion. Each file is rewritten via a temporary file and atomic replacement. An existing recovery directory is never overwritten or deleted. Interruption identifies changed and untouched files and the recovery path; removal or recovery failures are reported explicitly, not as complete success.

## Uninstalling the CLI by installation method

`deinit` never removes the CLI itself. Its plan ends with uninstall guidance; check how DocBridge was installed first, then use the matching method.

- Standalone binary installed with an installation receipt: delete the executable, its adjacent `<exe>.docbridge-receipt.json`, and any `<exe>.docbridge-update/` recovery directory. Inspect that directory before deleting it; it can hold backups from an interrupted upgrade. Remove only the verified installed executable.
- Nix profile: run `nix profile list`, then `nix profile remove <verified-entry>`.
- Declarative Nix or Home Manager: remove the declared package from the flake or Home Manager configuration and rebuild the owning configuration. `deinit` and these instructions never edit Nix-managed files; make that change yourself.
- Homebrew: `brew uninstall docbridge`. Cargo: `cargo uninstall docbridge`.
- Legacy npm installation: `npm uninstall -g docbridge`. This is separate from the standalone binary; run it only if DocBridge was installed through npm.
- Unknown provenance: run `docbridge docs` and choose a method after confirming how the executable got there.

## Remaining references

The plan lists each file under `Manual reference cleanup:` when it mentions DocBridge. `deinit` only reports them and never rewrites them. Review CI workflows, Git hooks (`.githooks`, `.husky`, `lefthook.yml`, `.pre-commit-config.yaml`), development scripts (`scripts`, `justfile`, `Makefile`, `package.json`), `flake.nix`, and agent instruction files such as `AGENTS.md` and `CLAUDE.md`, then remove those calls by hand.
