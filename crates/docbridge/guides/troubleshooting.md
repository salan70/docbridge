# Troubleshooting

Run `docbridge validate` to find configuration, annotation, target, duplicate, and read errors. Check that paths exist, belong to the configured scope, and are not excluded. Move an annotation directly before its ATX heading, allowing only further annotation lines and blank lines between them.

If `links` reports partial success, inspect warnings on stderr and correct the affected inputs; valid results can still be present but are not complete. Likewise, resolve incomplete `unlinked` analysis before relying on its coverage report.

When `links` rejects a selector with `file is not a discovered managed file`, the message names why the configuration does not manage it: the path is outside every `include.code.paths` entry, its extension is missing from `include.code.extensions`, an `exclude.code` pattern matches it, or, for a `.md` path, it is outside every `include.docs` entry. Add the directory or extension, or adjust the exclusion, in `docbridge.config.json`; the keys are described in [Configuration](configuration.md). A managed path that is missing or unreadable on disk keeps the bare message and is also reported by `docbridge validate`.

Section IDs are described in [Linking](linking.md); the root and managed paths in [Configuration](configuration.md). For an older project, follow [Migration](migration.md).
