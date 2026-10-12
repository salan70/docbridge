import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";

import { invokeScannerWorker } from "../../src/scan/code/worker/scanner-worker";
import {
  type GateLanguage,
  type GateTarget,
  firstDifference,
  formatResultLine,
  specifiedRequest,
} from "./result-diff";
import { parseTarget, resolveWorkerCommand } from "./target";

/**
 * Runs the parser gate's specified fixtures through one worker target. Each
 * case holds `input.txt`, an optional `options.json`, and the `expected.json`
 * of the scan result for the one file sent. A case whose specified result
 * differs from the shipped worker (a `worker` finding) also holds a
 * `shipped-deviation.json`; both targets are compared with it instead.
 */
const SPECIFIED_ROOT = resolve(import.meta.dir, "../../test-fixtures/parser-gate/specified");

const LANGUAGES: readonly GateLanguage[] = ["swift", "dart"];

type SpecifiedArgs = {
  target: GateTarget;
  languages: readonly GateLanguage[];
  show: string | undefined;
};

function parseArgs(argv: readonly string[]): SpecifiedArgs {
  const target = parseTarget(argv[0]);
  let languages = LANGUAGES;
  let show: string | undefined;
  for (let index = 1; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--show") {
      show = argv[index + 1];
      if (show === undefined) {
        throw new Error("--show needs a case name");
      }
      index += 1;
    } else if (arg === "swift" || arg === "dart") {
      languages = [arg];
    } else {
      throw new Error(`unexpected argument ${JSON.stringify(arg)}`);
    }
  }
  return { target, languages, show };
}

function caseNames(language: GateLanguage): string[] {
  const dir = join(SPECIFIED_ROOT, language);
  if (!existsSync(dir)) {
    return [];
  }
  return readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .toSorted();
}

/** The response's first file without its `filePath`, or the failure's diagnostic. */
async function actualResult(
  target: GateTarget,
  language: GateLanguage,
  name: string,
): Promise<unknown> {
  const caseDir = join(SPECIFIED_ROOT, language, name);
  const optionsPath = join(caseDir, "options.json");
  const options: { visibility?: string[] } = existsSync(optionsPath)
    ? JSON.parse(readFileSync(optionsPath, "utf8"))
    : {};
  const request = specifiedRequest(
    language,
    readFileSync(join(caseDir, "input.txt"), "utf8"),
    options,
    `parser-gate-${language}-${name}`,
  );
  const result = await invokeScannerWorker(request, resolveWorkerCommand(target, language)).promise;
  if (!result.ok) {
    return { workerFailure: result.diagnostic };
  }
  const file = result.codeFiles[0];
  return file === undefined
    ? undefined
    : {
        symbols: file.symbols,
        undocumentedSymbols: file.undocumentedSymbols,
        links: file.links,
        diagnostics: file.diagnostics,
      };
}

async function main(): Promise<number> {
  const { target, languages, show } = parseArgs(process.argv.slice(2));
  const cases = languages.flatMap((language) =>
    caseNames(language).map((name) => ({ language, name })),
  );
  if (cases.length === 0) {
    console.log("no cases");
    return 0;
  }
  if (show !== undefined) {
    const selected = cases.filter(({ name }) => name === show);
    if (selected.length === 0) {
      throw new Error(`no case named ${JSON.stringify(show)}`);
    }
    for (const { language, name } of selected) {
      console.log(`${name}/${language}`);
      console.log(JSON.stringify(await actualResult(target, language, name), null, 2));
    }
    return 0;
  }
  let failed = false;
  for (const { language, name } of cases) {
    const caseDir = join(SPECIFIED_ROOT, language, name);
    const deviationPath = join(caseDir, "shipped-deviation.json");
    const deviates = existsSync(deviationPath);
    const expected: unknown = JSON.parse(
      readFileSync(deviates ? deviationPath : join(caseDir, "expected.json"), "utf8"),
    );
    const difference = firstDifference(expected, await actualResult(target, language, name));
    const line = formatResultLine(`${name}/${language}`, difference);
    console.log(
      deviates && difference === undefined
        ? `${line.replace("ok  ", "ok* ")} (worker finding)`
        : line,
    );
    failed ||= difference !== undefined;
  }
  return failed ? 1 : 0;
}

try {
  process.exitCode = await main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
