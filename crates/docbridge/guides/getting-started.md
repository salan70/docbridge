# Getting started

This guide describes the approved DocBridge vNext contracts; production publication remains pending.

DocBridge connects code files to Markdown sections. It checks link structure; an AI agent or another reviewer must check whether linked content agrees in meaning.

1. Install the native binary using the instructions for your distribution. Production publication and signing keys remain pending.
2. Run `docbridge init` and review the suggested code paths, extensions, and Markdown paths. Review the resulting required configuration before use.
3. Add file-level links in Markdown as described in [Linking](linking.md).
4. Run `docbridge validate`, then review meaning and coverage with `docbridge links` and `docbridge unlinked`.

The English bundled guides work offline through `docbridge docs`, `docbridge docs list`, and `docbridge docs show <name>`. Bare `docs` shows a short start and the guide list. The installed English agent Skill is a short entry point; these guides own the detailed guidance.
