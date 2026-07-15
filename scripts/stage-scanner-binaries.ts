#!/usr/bin/env bun

import { chmodSync, copyFileSync, existsSync, mkdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

type Options = {
  platform: string;
  swift: string;
  dart: string;
};

const repoRoot = resolve(import.meta.dir, "..");
const options = parseArgs(Bun.argv.slice(2));
const outputDir = join(repoRoot, "dist/bin", options.platform);

stageBinary(options.swift, join(outputDir, "speclink-swift-scanner"));
stageBinary(options.dart, join(outputDir, "speclink_dart_scanner"));

function parseArgs(args: string[]): Options {
  const platform = `${process.platform}-${process.arch}`;
  const parsedOptions: Options = {
    platform,
    swift: join(repoRoot, "packages/swift-scanner/.build/release/speclink-swift-scanner"),
    dart: join(repoRoot, "packages/dart-scanner/bin/speclink_dart_scanner"),
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    const value = args[index + 1];
    if (arg === "--platform" && value !== undefined) {
      parsedOptions.platform = value;
      index += 1;
    } else if (arg === "--swift" && value !== undefined) {
      parsedOptions.swift = resolve(value);
      index += 1;
    } else if (arg === "--dart" && value !== undefined) {
      parsedOptions.dart = resolve(value);
      index += 1;
    } else {
      fail(`Unknown or incomplete argument: ${arg}`);
    }
  }

  return parsedOptions;
}

function stageBinary(source: string, destination: string): void {
  if (!existsSync(source)) {
    fail(`Expected scanner binary is missing: ${source}`);
  }
  mkdirSync(join(destination, ".."), { recursive: true });
  copyFileSync(source, destination);
  const mode = statSync(source).mode;
  chmodSync(destination, mode | 0o755);
  console.log(`${source} -> ${destination}`);
}

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}
