# Troubleshooting

Run `docbridge validate` to find configuration, annotation, target, duplicate, and read errors. Check that paths exist, belong to the configured scope, and are not excluded. Move an annotation directly before its ATX heading, allowing only further annotation lines and blank lines between them.

If `links` reports partial success, inspect warnings on stderr and correct the affected inputs; valid results can still be present but are not complete. Likewise, resolve incomplete `unlinked` analysis before relying on its coverage report.

Section IDs are described in [Linking](linking.md); the root and managed paths in [Configuration](configuration.md). For an older project, follow [Migration](migration.md).
