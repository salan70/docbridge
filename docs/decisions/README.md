# Decisions

Decision records explain why DocBridge behaves the way it does. They are not
normative; the current contracts live in the [specifications](../specs/cli.md).
When a record and a specification disagree, the specification wins.

| Record                                                        | Scope                                                  | Release | Status                    |
| ------------------------------------------------------------- | ------------------------------------------------------ | ------- | ------------------------- |
| [v0.1](v0.1.md)                                               | Documentation model, configuration, links, diagnostics | 0.1.0   | Historical                |
| [v0.2](v0.2.md)                                               | Language Server and editor navigation                  | 0.2.0   | Historical                |
| [v0.3](v0.3.md)                                               | The `context` command                                  | 0.3.0   | Historical                |
| [TypeScript member endpoints](typescript-member-endpoints.md) | TypeScript type members as link endpoints (#76)        | 0.7.0   | Current; amended for #143 |

The v0.1–v0.3 records use the product's former name, SpecLink, and their
Future Scope sections are not maintained. Later work records its decisions in
the Decisions section of its [completed plan](../plans/done/README.md) instead
of a separate record.
