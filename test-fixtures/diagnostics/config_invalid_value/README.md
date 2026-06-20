# config_invalid_value

`include.code` is an empty array, which violates the "at least one pattern"
rule, so DocBridge reports `config_invalid_value` (error) and skips scanning.

Run: `just check-fixture config_invalid_value`
