import { accessSync, chmodSync, constants, existsSync, realpathSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { reasonOf } from "./error";
import type { CodeLanguage, DocBridgeDiagnostic } from "./types";

/** Every language whose scanner runs as a separate worker executable. */
type ScannerWorkerLanguage = Exclude<CodeLanguage, "typescript">;

const SUPPORTED_SCANNER_PLATFORM_KEYS = ["darwin-arm64", "linux-x64"] as const;
const SCANNER_EXECUTABLE_NAMES: Readonly<Record<ScannerWorkerLanguage, string>> = {
  swift: "docbridge-swift-scanner",
  dart: "docbridge_dart_scanner",
  rust: "docbridge-rust-scanner",
};

export type ScannerWorkerCommandResolution =
  | { ok: true; command: string[] }
  | { ok: false; diagnostic: DocBridgeDiagnostic };

type ScannerWorkerResolutionOptions = {
  platformKey?: string;
  sourceRoot?: string;
  distRoot?: string;
  /**
   * Seam for the executable-bit repair. Tests inject a failing implementation
   * because a real `chmod` failure requires a read-only filesystem or a
   * different file owner, neither of which is reproducible in a temp directory.
   */
  chmod?: (path: string, mode: number) => void;
};

export function supportedScannerPlatformKeys(): readonly string[] {
  return SUPPORTED_SCANNER_PLATFORM_KEYS;
}

export function supportedScannerExecutableNames(): readonly string[] {
  return Object.values(SCANNER_EXECUTABLE_NAMES);
}

export function scannerPlatformKey(): string {
  return `${process.platform}-${process.arch}`;
}

export function scannerExecutableName(language: ScannerWorkerLanguage): string {
  return SCANNER_EXECUTABLE_NAMES[language];
}

/**
 * Resolve the worker executable for source checkouts and npm dist packages.
 *
 * @doc docs/specs/scanning.md#code-scanning
 */
export function resolveScannerWorkerCommand(
  language: ScannerWorkerLanguage,
  options: ScannerWorkerResolutionOptions = {},
): ScannerWorkerCommandResolution {
  const platformKey = options.platformKey ?? scannerPlatformKey();
  const platformSupported = isSupportedScannerPlatformKey(platformKey);
  const candidates = scannerExecutableCandidates(language, platformKey, platformSupported, options);
  const found = candidates.find((candidate) => existsSync(candidate));
  if (found !== undefined) {
    const repair = ensureExecutable(found, options.chmod ?? chmodSync);
    if (!repair.ok) {
      return { ok: false, diagnostic: scannerUnavailableDiagnostic(language, repair.reason) };
    }
    return { ok: true, command: [found] };
  }

  if (!platformSupported) {
    return {
      ok: false,
      diagnostic: scannerUnavailableDiagnostic(
        language,
        `platform ${platformKey} is unsupported; supported platforms: ${SUPPORTED_SCANNER_PLATFORM_KEYS.join(", ")}`,
      ),
    };
  }

  return {
    ok: false,
    diagnostic: scannerUnavailableDiagnostic(
      language,
      `missing ${scannerExecutableName(language)} for platform ${platformKey}; supported platforms: ${SUPPORTED_SCANNER_PLATFORM_KEYS.join(", ")}`,
    ),
  };
}

function scannerExecutableCandidates(
  language: ScannerWorkerLanguage,
  platformKey: string,
  platformSupported: boolean,
  options: ScannerWorkerResolutionOptions,
): string[] {
  const sourceRoot = options.sourceRoot ?? sourceRootPath();
  const distRoot = options.distRoot ?? distRootPath();
  const executable = scannerExecutableName(language);
  if (language === "swift") {
    return [
      join(sourceRoot, "packages/swift-scanner/.build/release", executable),
      join(sourceRoot, "packages/swift-scanner/.build/debug", executable),
      ...(platformSupported ? [join(distRoot, "bin", platformKey, executable)] : []),
    ];
  }
  if (language === "rust") {
    return [
      join(sourceRoot, "packages/rust-scanner/target/release", executable),
      join(sourceRoot, "packages/rust-scanner/target/debug", executable),
      ...(platformSupported ? [join(distRoot, "bin", platformKey, executable)] : []),
    ];
  }
  return [
    join(sourceRoot, "packages/dart-scanner/bin", executable),
    ...(platformSupported ? [join(distRoot, "bin", platformKey, executable)] : []),
  ];
}

type ExecutableRepair = { ok: true } | { ok: false; reason: string };

/**
 * Restore the executable bit on a resolved scanner binary.
 *
 * Installers drop the mode bits on the binaries DocBridge bundles under
 * `dist/bin/`, so a packaged scanner routinely arrives non-executable. Every
 * path handled here is a DocBridge build output or a DocBridge-packaged binary,
 * never a path derived from user configuration.
 *
 * Repair is best-effort: on a read-only store `chmod` fails, and the caller
 * degrades to `code_scanner_unavailable` rather than throwing.
 *
 * The probe asks whether *this* process can execute the file rather than
 * whether any execute bit is set, because a mode like `0011` carries execute
 * bits that do not apply to the owner. That precision is what lets a later
 * `EACCES` at spawn time be attributed to the filesystem instead of the mode.
 */
function ensureExecutable(
  path: string,
  chmod: (path: string, mode: number) => void,
): ExecutableRepair {
  let mode: number;
  try {
    mode = statSync(path).mode;
  } catch (error) {
    return { ok: false, reason: `cannot stat ${path}: ${reasonOf(error)}` };
  }
  if (isExecutableByThisProcess(path)) {
    return { ok: true };
  }
  try {
    // Execute bits only. Widening to `0o755` would also grant group and other
    // read access to a scanner a restrictive umask installed as `0o600`, which
    // is more than restoring execution.
    chmod(path, mode | 0o111);
  } catch (error) {
    return {
      ok: false,
      reason:
        `${path} is not executable (mode ${formatMode(mode)}) and the executable ` +
        `bit could not be restored: ${reasonOf(error)}; run \`chmod +x ${path}\` ` +
        `or reinstall DocBridge into a writable location`,
    };
  }
  return { ok: true };
}

function isExecutableByThisProcess(path: string): boolean {
  try {
    accessSync(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function formatMode(mode: number): string {
  return `0${(mode & 0o7777).toString(8).padStart(3, "0")}`;
}

function isSupportedScannerPlatformKey(platformKey: string): boolean {
  return SUPPORTED_SCANNER_PLATFORM_KEYS.includes(platformKey as never);
}

/**
 * Resolve the dist and source roots from the URL of this module's file.
 *
 * npm installs the CLI as `node_modules/.bin/docbridge`, a symlink to the
 * packaged `dist/index.js`. The bundled scanner binaries live next to that real
 * file under `dist/bin/`, so the symlink must be resolved to its target before
 * deriving the roots. Bun resolves the bin symlink for `import.meta.url` on
 * macOS but not on Linux, so realpath it explicitly to behave the same on both.
 *
 * The source root is the module directory's grandparent, so this module must
 * stay one directory below `src/`.
 */
export function scannerRootsFromModuleUrl(moduleUrl: string): {
  distRoot: string;
  sourceRoot: string;
} {
  const modulePath = fileURLToPath(moduleUrl);
  let resolved: string;
  try {
    resolved = realpathSync(modulePath);
  } catch {
    resolved = modulePath;
  }
  const moduleDir = dirname(resolved);
  return { distRoot: moduleDir, sourceRoot: resolve(moduleDir, "..", "..") };
}

function sourceRootPath(): string {
  return scannerRootsFromModuleUrl(import.meta.url).sourceRoot;
}

function distRootPath(): string {
  return scannerRootsFromModuleUrl(import.meta.url).distRoot;
}

function scannerUnavailableDiagnostic(
  language: ScannerWorkerLanguage,
  reason: string,
): DocBridgeDiagnostic {
  const label = language.charAt(0).toUpperCase() + language.slice(1);
  return {
    severity: "error",
    code: "code_scanner_unavailable",
    language,
    target: language,
    message: `${label} scanner worker is unavailable: ${reason}`,
  };
}
