import { isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

/**
 * Convert a `file://` URI to a project-root-relative POSIX path, or `undefined`
 * when the URI lies outside the root. Windows path specifics are out of scope
 * for v0.2.
 *
 * @doc docs/specs/lsp.md#positions-and-paths
 */
export function uriToRelativePath(
  projectRoot: string,
  uri: string,
): string | undefined {
  let absolute: string;
  try {
    absolute = fileURLToPath(uri);
  } catch {
    return undefined;
  }
  const rel = relative(projectRoot, absolute);
  if (rel === "" || rel.startsWith("..") || isAbsolute(rel)) {
    return undefined;
  }
  return rel.split(sep).join("/");
}

/** Convert a project-root-relative path to a `file://` URI. */
export function relativePathToUri(projectRoot: string, relPath: string): string {
  return pathToFileURL(resolve(projectRoot, relPath)).href;
}
