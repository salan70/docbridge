# Spec

Unannotated, but its subtree carries a link, so it is not reported.

<!-- @code src/example.ts#example -->

## Linked

## Unlinked

Unannotated with no annotated descendant, so this heading is reported.

##

### Below Empty

The empty heading above is at the same level as `## Unlinked`, so it closes
that section. This heading is a separate region rather than a descendant, and
is reported on its own.
