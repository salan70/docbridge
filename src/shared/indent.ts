/**
 * Strip the common leading indentation from an extracted declaration block.
 *
 * Both content extractors slice the block's first line by the declaration's
 * start column, so that line already begins at the declaration and carries no
 * indentation of its own. The remaining lines still carry the source's, which
 * for a type member is the indentation of its enclosing type. Measuring the
 * common indent over lines after the first and removing it from those lines
 * leaves the block reading as it does in the file, one level out.
 *
 * `startColumn` is the declaration's own start column, which is what separates
 * the two cases: a nested declaration is indented, a top-level one starts at
 * column 1 and is returned untouched. Measuring alone cannot separate them,
 * because a top-level declaration can have every line after the first indented
 * — `export const f =` continued on the next line, for one — and dedenting it
 * would rewrite content this function promises to leave alone.
 */
export function dedentBlockLines(lines: string[], startColumn: number): string[] {
  if (startColumn <= 1) {
    return lines;
  }
  const common = commonIndent(lines.slice(1));
  if (common === 0) {
    return lines;
  }
  return lines.map((line, index) => (index === 0 || isBlank(line) ? line : line.slice(common)));
}

function commonIndent(lines: string[]): number {
  let common: number | undefined;
  for (const line of lines) {
    if (isBlank(line)) {
      continue;
    }
    const indent = line.length - line.trimStart().length;
    if (common === undefined || indent < common) {
      common = indent;
    }
  }
  return common ?? 0;
}

function isBlank(line: string): boolean {
  return line.trim() === "";
}
