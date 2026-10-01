import { accessSync, constants, existsSync, realpathSync, statSync } from "node:fs";
import { extname, isAbsolute, join, resolve } from "node:path";

import type { RuntimeWorkerLanguage } from "../../../config/scanner-runtimes";
import type { DocBridgeDiagnostic } from "../../../model/types";
import { probeRuntime, type RuntimeProbeOutcome } from "./runtime-probe";
import {
  scannerRootsFromModuleUrl,
  type ScannerWorkerCommandResolution,
} from "./scanner-executable";

/**
 * A runtime-backed resolution always names the variables the worker starts
 * without and the runtime it runs: `[runtime, version, executable]`.
 */
export type RuntimeWorkerCommandResolution =
  | (Extract<ScannerWorkerCommandResolution, { ok: true }> & {
      stripEnv: readonly string[];
      runtime: readonly string[];
    })
  | Extract<ScannerWorkerCommandResolution, { ok: false }>;

type RuntimeWorkerSpec = {
  label: string;
  runtimeName: string;
  /** The `runtime` value an ok probe of this worker prints. */
  runtimeId: string;
  floor: readonly [number, number];
  floorText: string;
  candidates: (platform: NodeJS.Platform) => string[][];
  /** Runtime flags placed between the runtime argv and the entrypoint. */
  flags: readonly string[];
  stripEnv: readonly string[];
  /** Relative to the source root and the dist root respectively. */
  entrypoint: { source: string; dist: string };
  buildHint?: string;
};

const RUNTIME_WORKERS: Readonly<Record<RuntimeWorkerLanguage, RuntimeWorkerSpec>> = {
  python: {
    label: "Python",
    runtimeName: "CPython",
    runtimeId: "cpython",
    floor: [3, 10],
    floorText: "3.10",
    candidates: (platform) =>
      platform === "win32" ? [["py", "-3"], ["python"]] : [["python3"], ["python"]],
    flags: ["-I", "-S"],
    stripEnv: ["PYTHONPATH", "PYTHONSTARTUP", "PYTHONHOME", "PYTHONSAFEPATH"],
    entrypoint: {
      source: "packages/python-scanner/docbridge_python_scanner.py",
      dist: "workers/python/docbridge_python_scanner.py",
    },
  },
  ruby: {
    label: "Ruby",
    runtimeName: "CRuby",
    runtimeId: "cruby",
    floor: [3, 3],
    floorText: "3.3",
    candidates: () => [["ruby"]],
    flags: ["--disable=gems,did_you_mean,error_highlight", "-W0"],
    stripEnv: ["RUBYOPT", "RUBYLIB", "PRISM_FFI_BACKEND"],
    entrypoint: {
      source: "packages/ruby-scanner/bin/docbridge-ruby-scanner",
      dist: "workers/ruby/bin/docbridge-ruby-scanner",
    },
  },
  java: {
    label: "Java",
    runtimeName: "JDK",
    runtimeId: "jdk",
    floor: [17, 0],
    floorText: "17",
    candidates: () => [["java"]],
    flags: ["-Xshare:auto", "-XX:TieredStopAtLevel=1", "-XX:+UseSerialGC", "-jar"],
    stripEnv: ["JAVA_TOOL_OPTIONS", "JDK_JAVA_OPTIONS", "_JAVA_OPTIONS"],
    entrypoint: {
      source: "packages/java-scanner/build/docbridge-java-scanner.jar",
      dist: "workers/java/docbridge-java-scanner.jar",
    },
    buildHint: "run `just build-java-scanner` in a source checkout",
  },
};

type RuntimeProbe = (
  command: readonly string[],
  stripEnv: readonly string[],
) => RuntimeProbeOutcome;

type RuntimeWorkerResolutionOptions = {
  projectRoot: string;
  /** `scanners.<language>.command` from configuration, when set. */
  command?: readonly string[];
  /**
   * Where `DOCBRIDGE_<LANGUAGE>_RUNTIME` and the cache key's variables are
   * read; defaults to `process.env`. Probes and workers always start from the
   * process environment.
   */
  env?: Readonly<Record<string, string | undefined>>;
  platform?: NodeJS.Platform;
  sourceRoot?: string;
  distRoot?: string;
  /** Seam for the `--probe` run; results are cached either way. */
  probe?: RuntimeProbe;
};

type Verdict =
  | { ok: true; runtime: string; version: string }
  | { ok: false; code: DiagnosticCode; startable: boolean; reason: string };

type DiagnosticCode = "code_scanner_unavailable" | "code_scanner_failed";

const probeCache = new Map<string, RuntimeProbeOutcome>();

/**
 * Forget every cached probe result. A configuration change calls this so a
 * runtime installed or reconfigured since the last scan is probed again.
 */
export function clearRuntimeProbeCache(): void {
  probeCache.clear();
}

/**
 * The bundled entrypoint of each runtime-backed worker, relative to the source
 * root (a checkout) and to the dist root (the npm package).
 */
export function runtimeWorkerEntrypoints(): Readonly<
  Record<RuntimeWorkerLanguage, { source: string; dist: string }>
> {
  return {
    python: RUNTIME_WORKERS.python.entrypoint,
    ruby: RUNTIME_WORKERS.ruby.entrypoint,
    java: RUNTIME_WORKERS.java.entrypoint,
  };
}

/**
 * Resolve the command that runs a runtime-backed worker: the configured
 * command, else `DOCBRIDGE_<LANGUAGE>_RUNTIME`, else the documented candidates,
 * each followed by the worker's fixed runtime flags and bundled entrypoint and
 * accepted only after its `--probe` passes. An explicit override that fails is
 * reported without trying anything else; only candidates fall through.
 *
 * @doc docs/specs/scanning.md#code-scanning
 * @doc docs/specs/configuration.md#scanner-runtimes
 */
export function resolveRuntimeWorkerCommand(
  language: RuntimeWorkerLanguage,
  options: RuntimeWorkerResolutionOptions,
): RuntimeWorkerCommandResolution {
  const spec = RUNTIME_WORKERS[language];
  const entrypoint = findEntrypoint(spec, options);
  if (!entrypoint.ok) {
    return failure(spec, language, "code_scanner_unavailable", entrypoint.reason);
  }
  const env = options.env ?? process.env;
  const platform = options.platform ?? process.platform;
  const probe = options.probe ?? probeRuntime;
  const attempt = (runtime: string[]) => {
    const command = [...runtime, ...spec.flags, entrypoint.path];
    return { command, verdict: judge(spec, cachedProbe(command, spec.stripEnv, env, probe)) };
  };
  const usable = (
    command: string[],
    runtime: readonly string[],
    verdict: Extract<Verdict, { ok: true }>,
  ): RuntimeWorkerCommandResolution => ({
    ok: true,
    command,
    stripEnv: spec.stripEnv,
    runtime: [verdict.runtime, verdict.version, locateExecutable(runtime[0] ?? "", env, platform)],
  });

  const override = explicitOverride(language, options, env);
  if (override !== undefined) {
    const runtime = override.argv.map((part, index) =>
      index === 0 ? resolveExecutable(part, options.projectRoot) : part,
    );
    const { command, verdict } = attempt(runtime);
    if (verdict.ok) {
      return usable(command, runtime, verdict);
    }
    return failure(
      spec,
      language,
      verdict.code,
      `${override.source} (${runtime.join(" ")}) ${verdict.reason}; no other runtime is tried ` +
        `while ${override.source} is set`,
    );
  }

  const rejections: { runtime: string[]; verdict: Exclude<Verdict, { ok: true }> }[] = [];
  for (const runtime of spec.candidates(platform)) {
    const { command, verdict } = attempt(runtime);
    if (verdict.ok) {
      return usable(command, runtime, verdict);
    }
    rejections.push({ runtime, verdict });
  }
  const outcomes = rejections
    .map(({ runtime, verdict }) => `${runtime.join(" ")} ${verdict.reason}`)
    .join("; ");
  const code =
    rejections.find(({ verdict }) => verdict.startable)?.verdict.code ?? "code_scanner_unavailable";
  return failure(
    spec,
    language,
    code,
    `no usable ${spec.runtimeName} ${spec.floorText} or later found: ${outcomes}. Install ` +
      `${spec.runtimeName} ${spec.floorText} or later, or set scanners.${language}.command or ` +
      `${environmentVariable(language)}`,
  );
}

function findEntrypoint(
  spec: RuntimeWorkerSpec,
  options: RuntimeWorkerResolutionOptions,
): { ok: true; path: string } | { ok: false; reason: string } {
  const roots = scannerRootsFromModuleUrl(import.meta.url);
  const source = join(options.sourceRoot ?? roots.sourceRoot, spec.entrypoint.source);
  const dist = join(options.distRoot ?? roots.distRoot, spec.entrypoint.dist);
  const found = [source, dist].find((path) => existsSync(path));
  if (found !== undefined) {
    return { ok: true, path: found };
  }
  const hint = spec.buildHint === undefined ? "" : `; ${spec.buildHint}`;
  return {
    ok: false,
    reason: `the bundled worker is missing; looked for ${source} and ${dist}${hint}`,
  };
}

function explicitOverride(
  language: RuntimeWorkerLanguage,
  options: RuntimeWorkerResolutionOptions,
  env: Readonly<Record<string, string | undefined>>,
): { source: string; argv: readonly string[] } | undefined {
  if (options.command !== undefined && options.command.length > 0) {
    return { source: `scanners.${language}.command`, argv: options.command };
  }
  const variable = environmentVariable(language);
  const value = env[variable];
  if (value !== undefined && value !== "") {
    return { source: variable, argv: [value] };
  }
  return undefined;
}

function environmentVariable(language: RuntimeWorkerLanguage): string {
  return `DOCBRIDGE_${language.toUpperCase()}_RUNTIME`;
}

/**
 * A relative path resolves against the project root; a bare name is left for
 * the operating system to look up on `PATH`, as the candidates are.
 */
function resolveExecutable(executable: string, projectRoot: string): string {
  if (isAbsolute(executable) || !/[/\\]/u.test(executable)) {
    return executable;
  }
  return resolve(projectRoot, executable);
}

/**
 * The file a runtime executable resolves to, which tells two installs behind
 * the same command apart: a path as given, or a bare name looked up on `PATH`
 * (with `PATHEXT` on Windows), with symbolic links resolved. A name not found
 * stays as given. The lookup is best effort and ignores the other places an
 * operating system may search.
 */
function locateExecutable(
  executable: string,
  env: Readonly<Record<string, string | undefined>>,
  platform: NodeJS.Platform,
): string {
  const candidates = /[/\\]/u.test(executable)
    ? [executable]
    : pathCandidates(executable, env, platform);
  const found = candidates.find((candidate) => isExecutableFile(candidate, platform));
  if (found === undefined) {
    return executable;
  }
  try {
    return realpathSync(found);
  } catch {
    return found;
  }
}

function pathCandidates(
  name: string,
  env: Readonly<Record<string, string | undefined>>,
  platform: NodeJS.Platform,
): string[] {
  const windows = platform === "win32";
  const directories = (env.PATH ?? "").split(windows ? ";" : ":").filter((dir) => dir !== "");
  const extensions =
    windows && extname(name) === "" ? (env.PATHEXT ?? ".COM;.EXE;.BAT;.CMD").split(";") : [""];
  return directories.flatMap((directory) =>
    extensions.map((extension) => join(directory, `${name}${extension}`)),
  );
}

function isExecutableFile(path: string, platform: NodeJS.Platform): boolean {
  try {
    if (!statSync(path).isFile()) {
      return false;
    }
    if (platform !== "win32") {
      accessSync(path, constants.X_OK);
    }
    return true;
  } catch {
    return false;
  }
}

function cachedProbe(
  command: string[],
  stripEnv: readonly string[],
  env: Readonly<Record<string, string | undefined>>,
  probe: RuntimeProbe,
): RuntimeProbeOutcome {
  const docbridgeVariables = Object.entries(env)
    .filter(([name]) => name.startsWith("DOCBRIDGE_"))
    .toSorted(([left], [right]) => left.localeCompare(right));
  const key = JSON.stringify([command, env.PATH ?? "", docbridgeVariables]);
  const cached = probeCache.get(key);
  if (cached !== undefined) {
    return cached;
  }
  const outcome = probe(command, stripEnv);
  probeCache.set(key, outcome);
  return outcome;
}

function judge(spec: RuntimeWorkerSpec, outcome: RuntimeProbeOutcome): Verdict {
  switch (outcome.kind) {
    case "unstartable":
      return rejected("code_scanner_unavailable", false, `could not be started: ${outcome.reason}`);
    case "failed":
      return rejected("code_scanner_failed", true, `failed its probe: ${outcome.reason}`);
    case "rejected":
      return rejected(
        "code_scanner_unavailable",
        true,
        `is not a usable ${spec.runtimeName} ${spec.floorText} or later: ${outcome.reason}`,
      );
    case "ok":
      return judgeVersion(spec, outcome.runtime, outcome.version);
  }
}

function judgeVersion(spec: RuntimeWorkerSpec, runtime: string, version: string): Verdict {
  if (runtime !== spec.runtimeId) {
    return rejected(
      "code_scanner_unavailable",
      true,
      `reports runtime ${runtime} ${version}, not ${spec.runtimeName}`,
    );
  }
  const match = /^(\d+)(?:\.(\d+))?/u.exec(version);
  if (match === null) {
    return rejected("code_scanner_failed", true, `reported an unreadable version: ${version}`);
  }
  const major = Number(match[1]);
  const minor = Number(match[2] ?? "0");
  const [floorMajor, floorMinor] = spec.floor;
  if (major < floorMajor || (major === floorMajor && minor < floorMinor)) {
    return rejected(
      "code_scanner_unavailable",
      true,
      `is ${spec.runtimeName} ${version}, below the ${spec.floorText} floor`,
    );
  }
  return { ok: true, runtime, version };
}

function rejected(code: DiagnosticCode, startable: boolean, reason: string): Verdict {
  return { ok: false, code, startable, reason };
}

/**
 * The diagnostic carries no `language` field: Python, Ruby, and Java are not
 * registered code languages yet, and registration adds it.
 */
function failure(
  spec: RuntimeWorkerSpec,
  language: RuntimeWorkerLanguage,
  code: DiagnosticCode,
  reason: string,
): { ok: false; diagnostic: DocBridgeDiagnostic } {
  const state = code === "code_scanner_unavailable" ? "is unavailable" : "failed";
  return {
    ok: false,
    diagnostic: {
      severity: "error",
      code,
      target: language,
      message: `${spec.label} scanner worker ${state}: ${reason}`,
    },
  };
}
