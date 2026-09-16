import { existsSync, realpathSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Resolve the package directory that ships `templates/skills`.
 *
 * Source execution runs this module from `src/core/`, while the published CLI
 * runs the bundle from `dist/index.js`; the `templates/skills` tree sits at the
 * repository root in source and at the package root in the npm tarball. A fixed
 * relative offset cannot satisfy both depths, so walk up from the module's real
 * path (symlinks resolved, matching the npm `.bin` shim) until that tree is
 * found.
 *
 * The documentation command and the setup commands both need this path, so it
 * stays independent of initialization planning.
 */
export function resolvePackageRoot(moduleUrl: string = import.meta.url): string {
  const modulePath = fileURLToPath(moduleUrl);
  let resolved: string;
  try {
    resolved = realpathSync(modulePath);
  } catch {
    resolved = modulePath;
  }

  let dir = dirname(resolved);
  for (;;) {
    if (existsSync(join(dir, "templates", "skills"))) {
      return dir;
    }
    const parent = dirname(dir);
    if (parent === dir) {
      return dir;
    }
    dir = parent;
  }
}
