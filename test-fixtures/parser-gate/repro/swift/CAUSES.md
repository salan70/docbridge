# Swift rejection causes

Why the candidate rejects files the shipped worker accepts. Each cause has a
hand-written case under this directory, checked by
`just parser-gate-repro swift --causes development`. Which files each cause
explains is in `development.causes.json`.

Measured on the development set: 57 files are accepted by the shipped worker
and rejected by the candidate (unmodified source, default configuration).

**Declaration shape** counts the files where the construct occurs outside every
function, initializer, subscript and accessor body, including attributes and
modifiers on those. Such a construct sits in what the scanner reads to find
declarations. The classification comes from a brace scan of each site, not from
a parse.

| Cause                          | Kind    | Construct                                                                                                                    | Files | Declaration shape |
| ------------------------------ | ------- | ---------------------------------------------------------------------------------------------------------------------------- | ----- | ----------------- |
| `empty-tuple-expression`       | grammar | The empty tuple `()` as a value: a stored property default, an argument, a labeled argument, a return value, a closure body. | 24    | 2                 |
| `lifetime-attribute`           | grammar | An `@_lifetime(...)` attribute on a getter or a function.                                                                    | 5     | 5                 |
| `directive-member`             | grammar | A `#warning` or `#error` directive in a type body.                                                                           | 4     | 4                 |
| `nonisolated-unsafe`           | grammar | A `nonisolated(unsafe)` modifier on a local declaration in a function body.                                                  | 4     | 0                 |
| `await-condition-operand`      | grammar | An `await` on a name or member path that leads the condition of an `if`, `while` or `switch`.                                | 4     | 0                 |
| `any-optional-metatype`        | grammar | The metatype of an optional existential, `(any Error)?.self`.                                                                | 3     | 0                 |
| `bodiless-function`            | grammar | A function declaration without a body, as used with `@_silgen_name`.                                                         | 3     | 3                 |
| `attribute-on-macro-expansion` | grammar | An `@available` attribute before a `#Preview` macro expansion.                                                               | 3     | 3                 |
| `empty-tuple-pattern`          | grammar | The empty tuple pattern `.success()` in a `switch` case.                                                                     | 2     | 0                 |
| `directive-multiline`          | grammar | A `#warning` directive whose argument list spans several lines.                                                              | 2     | 0                 |
| `consuming-get`                | grammar | A `consuming get` accessor.                                                                                                  | 1     | 1                 |
| `consume-condition-operand`    | grammar | A `consume` expression as the subject of a `switch` or the condition of an `if`.                                             | 1     | 0                 |
| `for-in-open-range`            | grammar | A postfix open range, `0...`, as the sequence of a `for` loop.                                                               | 1     | 0                 |
| `for-case-tuple-pattern`       | grammar | A tuple pattern with enum-case elements after `for case`.                                                                    | 1     | 0                 |
| `prefix-first-in-accessor`     | grammar | The identifier `prefix` as the first token of a computed property body.                                                      | 1     | 0                 |
| `string-comment-open`          | grammar | A string literal that starts with `/*`, followed later by a line comment containing `*/`.                                    | 1     | 0                 |

## Reading the table

- All 16 causes are grammar limits: the tree-sitter grammar produces an error
  node. None comes from the candidate's own code (`candidate`) or from worker
  behavior (`worker`).
- One construct, the empty tuple, explains 24 of the 57 files as a value. Two of
  those also fail on the empty tuple as a pattern. The other causes each
  explain five files or fewer, and six explain one.
- 18 of the 57 files have a cause in declaration shape, and in each of them
  every cause is. The other 39 fail only on a construct inside a body.
- A rejection is per file, so a body-level construct costs every declaration in
  the file.
- Two files have more than one cause.
