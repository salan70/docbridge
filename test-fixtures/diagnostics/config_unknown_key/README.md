# config_unknown_key

`speclink.config.json` contains the unknown top-level key `extra`, so SpecLink
reports `config_unknown_key` (error) and skips scanning. The `include` section
is valid so no other config diagnostic fires.

Run: `just check-fixture config_unknown_key`
