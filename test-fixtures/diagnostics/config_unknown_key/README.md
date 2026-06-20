# config_unknown_key

`docbridge.config.json` contains the unknown top-level key `extra`, so DocBridge
reports `config_unknown_key` (error) and skips scanning. The `include` section
is valid so no other config diagnostic fires.

Run: `just check-fixture config_unknown_key`
