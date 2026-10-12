# Dart comparison causes

Why the candidate and the shipped worker disagree on the Dart development set.
Each cause has a hand-written case under this directory, checked by
`just parser-gate-repro dart --causes development`. Which files each cause
explains is in `development.causes.json`.

The candidate rejects no file the shipped worker accepts. Three kinds of
disagreement remain to be explained: both accept and the results differ, both
reject, and only the candidate accepts.

## Both accept, results differ

Before the fix, 11 unmodified files (20 rows, counting the injected and
malformed variants of the same files) were accepted by both and scanned
differently. All 11 are in `flutter/flutter`.

| Cause                     | Kind    | Construct                                                                                                                                     | Files | Worked around |
| ------------------------- | ------- | --------------------------------------------------------------------------------------------------------------------------------------------- | ----- | ------------- |
| `typedef-function-alias`  | grammar | A function-type alias whose return type has type arguments and whose parameter list is empty, such as `typedef A = Future<void> Function();`. | 10    | yes           |
| `setter-last-declaration` | grammar | A top-level setter, or an external setter, that is the last declaration of the file.                                                          | 1     | yes           |

- Both are mis-parses with an unambiguous shape. `typedef` and `set` are
  built-in identifiers and cannot name a type, so a variable declaration typed
  `typedef` is an alias and a function returning `set` is a setter. `dart.rs`
  reads them that way. The syntax-error decision is unchanged.
- The shipped worker's `library name;` is not a cause: the candidate agrees on
  it.

## Both reject

The shipped worker rejects 1,021 files, all in `flame-engine/flame`, and the
candidate rejects the same files. The cause is Dart 3.13 syntax. The shipped
analyzer 9.0.0 and `tree-sitter-dart` 0.2.0 both predate it.

| Cause                       | Kind    | Construct                                                                  | Files |
| --------------------------- | ------- | -------------------------------------------------------------------------- | ----- |
| `primary-constructor`       | grammar | A primary constructor in a class header: `class A(final int x) extends B`. | 909   |
| `const-primary-constructor` | grammar | A `const` primary constructor: `class const A(final int x);`.              | 148   |
| `enum-primary-constructor`  | grammar | A primary constructor in an enum header: `enum E(final int x) { ... }`.    | 60    |
| `bodyless-declaration`      | grammar | A mixin declaration that ends in `;` in place of a body.                   | 1     |
| `bodyless-extension-type`   | grammar | An extension type declaration that ends in `;` in place of a body.         | 1     |

A file can contain several constructs, so the counts add up to more than 1,021.
A text scan of each rejected file finds at least one of these headers in all
1,021 files, and none is left unexplained. The scan is a regular expression
over the source, not a parse.

## Only the candidate accepts

Four malformed variants (`malformed:delete-brace`) are rejected by the shipped
worker and accepted by the candidate.

| Cause                    | Kind   | Construct                                                  | Files |
| ------------------------ | ------ | ---------------------------------------------------------- | ----- |
| `unclosed-doc-directive` | worker | A doc directive such as `{@macro name` with no closing `}` | 4     |

The brace deleted in each of the four files closes a doc directive in a doc
comment. The shipped analyzer parses doc directives and reports a parse error;
the candidate reads comments as text. Reproducing this needs a change to the
syntax-error decision, so it is left as is.

## After the fix

Measured on the development set with `bun run scripts/parser-gate/compare.ts
development dart`:

| Measure         | Value |
| --------------- | ----- |
| `notIdentical`  | 0     |
| `rejectionRate` | 0     |
