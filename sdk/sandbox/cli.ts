// Copyright 2026 Chesapeake Computing
// SPDX-License-Identifier: Apache-2.0

import { parseSandboxProvider } from "./config.ts";
import type { SandboxFlagValue } from "./resolve.ts";

/** Re-export for CLI modules. */
export type { SandboxFlagValue };

/**
 * Extracts `--sandbox` / `--sandbox <provider>` from CLI args.
 *
 * - `--sandbox` alone → `{ sandbox: "from-config", rest }`
 * - `--sandbox none|docker|exe.dev` → parsed provider
 */
export function extractSandboxFlag(
  args: string[],
): { sandbox: SandboxFlagValue | undefined; rest: string[] } {
  const rest: string[] = [];
  let sandbox: SandboxFlagValue | undefined;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--sandbox") {
      const value = args[i + 1];
      if (!value || value.startsWith("-")) {
        sandbox = "from-config";
        continue;
      }
      sandbox = parseSandboxProvider(value);
      i++;
      continue;
    }
    rest.push(arg);
  }

  return { sandbox, rest };
}

/**
 * Merges global and subcommand `--sandbox` flags; subcommand wins when present.
 */
export function resolveSandboxFlagValue(
  globalSandbox: SandboxFlagValue | null,
  localSandbox: SandboxFlagValue | undefined,
): SandboxFlagValue | null {
  if (localSandbox !== undefined) {
    return localSandbox;
  }
  return globalSandbox;
}

/**
 * Parses global `--sandbox` from args (same semantics as {@link extractSandboxFlag}).
 */
export function parseGlobalSandboxFlag(
  args: string[],
): {
  sandbox: SandboxFlagValue | null;
  rest: string[];
} {
  let sandbox: SandboxFlagValue | null = null;
  const rest: string[] = [];

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--sandbox") {
      const value = args[i + 1];
      if (!value || value.startsWith("-")) {
        sandbox = "from-config";
        continue;
      }
      const parsed = parseSandboxProvider(value);
      if (sandbox && sandbox !== parsed) {
        throw new Error(
          `Conflicting sandbox selections: ${sandbox} and ${parsed}. Select only one provider.`,
        );
      }
      sandbox = parsed;
      i++;
      continue;
    }
    rest.push(...args.slice(i));
    break;
  }

  return { sandbox, rest };
}
