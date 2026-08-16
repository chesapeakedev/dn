// Copyright 2026 Chesapeake Computing
// SPDX-License-Identifier: Apache-2.0

/**
 * Global `--context-file` parsing for agent-backed dn workflows.
 */

import { resolve } from "@std/path";

/** Repeatable global flag that appends a file to agent prompt context. */
export const CONTEXT_FILE_FLAG = "--context-file";

/**
 * Strips `--context-file <path>` pairs from argv.
 *
 * Paths are resolved against the current working directory so later
 * `Deno.chdir` calls cannot change which files are included. The flag may be
 * repeated. Missing values throw.
 *
 * @param args - Raw CLI arguments, possibly including the flag at any position
 * @returns Absolute included-file paths and the remaining arguments
 */
export function extractContextFiles(
  args: string[],
): { contextFiles: string[]; rest: string[] } {
  const contextFiles: string[] = [];
  const rest: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === CONTEXT_FILE_FLAG) {
      const value = args[i + 1];
      if (!value || value.startsWith("-")) {
        throw new Error(`${CONTEXT_FILE_FLAG} requires a path.`);
      }
      contextFiles.push(resolve(value));
      i++;
      continue;
    }
    rest.push(arg);
  }
  return { contextFiles, rest };
}

/**
 * Merges global and subcommand `--context-file` lists, dropping duplicates.
 *
 * Earlier entries win. Comparison uses the resolved absolute path.
 *
 * @param groups - Path lists in precedence order (global first)
 * @returns Deduplicated absolute paths
 */
export function mergeContextFiles(
  ...groups: Array<readonly string[] | undefined>
): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const group of groups) {
    if (group === undefined) continue;
    for (const file of group) {
      const absolute = resolve(file);
      if (seen.has(absolute)) continue;
      seen.add(absolute);
      out.push(absolute);
    }
  }
  return out;
}

/**
 * Extracts local `--context-file` flags and merges them with global paths.
 *
 * @param args - Subcommand arguments that may still contain `--context-file`
 * @param globalContextFiles - Paths already collected from global argv
 * @returns Merged absolute paths and arguments with the flag removed
 */
export function resolveContextFileArgs(
  args: string[],
  globalContextFiles: readonly string[] = [],
): { contextFiles: string[]; rest: string[] } {
  const { contextFiles, rest } = extractContextFiles(args);
  return {
    contextFiles: mergeContextFiles(globalContextFiles, contextFiles),
    rest,
  };
}
