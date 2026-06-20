# undocumented_symbol

The exported function has no `@doc` annotation. Under `--audit`, DocBridge
reports `undocumented_symbol` (warning). Without `--audit` the project is
clean; this diagnostic only exists in audit mode.

Run: `just check-fixture undocumented_symbol` (the recipe adds `--audit`)
