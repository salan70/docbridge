# Getting started

DocBridge connects code files to Markdown sections. It checks link structure; an AI agent or another reviewer must check whether linked content agrees in meaning.

1. Install the native binary using the instructions for your distribution. Production publication remains pending.
2. Run `docbridge init` and review the suggested code paths, extensions, and Markdown paths.
3. Add file-level links in Markdown as described in [Linking](linking.md).
4. Run `docbridge validate`, then review meaning and coverage with `docbridge links` and `docbridge unlinked`.

The bundled guides work offline through `docbridge docs`, `docbridge docs list`, and `docbridge docs show <name>`. The installed agent Skill is a short entry point; these guides own the detailed guidance.
