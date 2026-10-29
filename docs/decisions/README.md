# Decisions

Decision records explain why DocBridge behaves the way it does. They are not
normative; the current contracts live in the [specifications](../specs/cli.md).
When a record and a specification disagree, the specification wins.

| Record                                                        | Scope                                                        | Release | Status                      |
| ------------------------------------------------------------- | ------------------------------------------------------------ | ------- | --------------------------- |
| [v0.1](v0.1.md)                                               | Documentation model, configuration, links, diagnostics       | 0.1.0   | Historical                  |
| [v0.2](v0.2.md)                                               | Language Server and editor navigation                        | 0.2.0   | Historical                  |
| [v0.3](v0.3.md)                                               | The `context` command                                        | 0.3.0   | Historical                  |
| [TypeScript member endpoints](typescript-member-endpoints.md) | TypeScript type members as link endpoints (#76)              | 0.7.0   | Historical; retired by #215 |
| [Rust core evaluation](rust-core-evaluation.md)               | Keep the TypeScript core after the Phase 0 experiment (#172) | —       | Historical; superseded      |
| [Rust CLI vNext direction](rust-cli-vnext.md)                 | New native CLI and file-level link model                     | —       | Current                     |

Records marked historical describe the npm package and its TypeScript CLI,
which the native CLI replaced at the cutover (#215, release 0.17.0). The
v0.1–v0.3 records use the product's former name, SpecLink, and their Future
Scope sections are not maintained. Later work records its decisions in
the Decisions section of its [completed plan](../plans/done/README.md) instead
of a separate record.
