# Completed Plans

These plans are delivery records: they explain how work landed and are not
current instructions. Current behavior lives in the
[specifications](../../specs/cli.md) and the [user guides](../../user/getting-started.md).
Active plans, when any exist, stay directly under `docs/plans/`.

| Plan                                                               | Delivered                                             | Release    |
| ------------------------------------------------------------------ | ----------------------------------------------------- | ---------- |
| [v0.1 implementation](v0.1-implementation-plan.md)                 | TypeScript and Markdown link checking                 | 0.1.0      |
| [v0.2 implementation](v0.2-implementation-plan.md)                 | Language Server                                       | 0.2.0      |
| [Multilanguage support](multilanguage-support-plan.md)             | Swift and Dart scanner workers                        | 0.4.0      |
| [npm distribution](npm-distribution-plan.md)                       | npm package and platform scanner binaries             | 0.4.0      |
| [Init command](init-command-plan.md)                               | `init` and `init-with-agent`                          | 0.4.1      |
| [v0.5 delivery](v0.5-delivery-plan.md)                             | VS Code-compatible extension packaging                | 0.5.0      |
| [Scanner executable bit](scanner-executable-bit-plan.md)           | Scanner start-up without an executable bit (#74, #75) | 0.6.1      |
| [Related-gate CI hardening](related-gate-ci-hardening-plan.md)     | Reliable changed-file list in the CI recipe (#77)     | 0.6.1      |
| [TypeScript member endpoints](typescript-member-endpoints-plan.md) | TypeScript type members as endpoints (#76)            | 0.7.0      |
| [Rust language support](rust-language-support-plan.md)             | Rust scanner worker (#109)                            | 0.7.0      |
| [Built-in documentation](built-in-documentation-plan.md)           | `docs list` and `docs show`                           | 0.7.0      |
| [Link manifest](link-manifest-plan.md)                             | `docbridge.links.json` (#143)                         | Unreleased |

Plans written before the rename use the former product name, SpecLink.
Release numbers refer to [CHANGELOG.md](../../../CHANGELOG.md).
