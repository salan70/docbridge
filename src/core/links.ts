import type { LinkTarget, Range, SourceLocation, SpecLinkDiagnostic } from "./types";

export type ParseLinkTargetOptions = {
  source?: string;
  sourceFilePath?: string;
  location?: SourceLocation;
  targetRange?: Range;
};

export type ParseLinkTargetResult =
  | {
      ok: true;
      target: LinkTarget;
    }
  | {
      ok: false;
      diagnostic: SpecLinkDiagnostic;
    };

const invalidLinkTargetMessage =
  "Link target must be a project-root-relative file path and fragment in file#fragment form.";

/**
 * @doc docs/specs/link-resolution.md#parsing-link-targets
 */
export function parseLinkTarget(
  rawTarget: string,
  options: ParseLinkTargetOptions = {},
): ParseLinkTargetResult {
  const parts = rawTarget.split("#");

  if (parts.length !== 2) {
    return invalidLinkTarget(rawTarget, options);
  }

  const [filePath, fragment] = parts;
  if (
    filePath === undefined ||
    fragment === undefined ||
    !isValidTargetFilePath(filePath) ||
    !isValidTargetFragment(fragment) ||
    filePath === options.sourceFilePath
  ) {
    return invalidLinkTarget(rawTarget, options);
  }

  return {
    ok: true,
    target: {
      filePath,
      fragment,
    },
  };
}

function isValidTargetFilePath(filePath: string): boolean {
  if (
    filePath.length === 0 ||
    filePath.startsWith("/") ||
    filePath.startsWith("./") ||
    filePath.startsWith("../") ||
    filePath.includes("\\") ||
    hasWhitespace(filePath)
  ) {
    return false;
  }

  return !filePath.split("/").includes("..");
}

function isValidTargetFragment(fragment: string): boolean {
  return fragment.length > 0 && !hasWhitespace(fragment);
}

function hasWhitespace(value: string): boolean {
  return /\s/.test(value);
}

function invalidLinkTarget(
  rawTarget: string,
  options: ParseLinkTargetOptions,
): ParseLinkTargetResult {
  const diagnostic: SpecLinkDiagnostic = {
    severity: "error",
    code: "invalid_link_target",
    target: rawTarget,
    message: invalidLinkTargetMessage,
  };

  if (options.source !== undefined) {
    diagnostic.source = options.source;
  }

  if (options.location !== undefined) {
    diagnostic.location = options.location;
  }

  if (options.targetRange !== undefined) {
    diagnostic.range = options.targetRange;
  }

  return {
    ok: false,
    diagnostic,
  };
}
