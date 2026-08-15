// Copyright 2026 Chesapeake Computing
// SPDX-License-Identifier: Apache-2.0

import { join } from "@std/path";
import { DN_CONFIG_REL_PATH } from "../workflows/agentConfig.ts";
import { resolveDnConfig } from "../config/resolve.ts";
import {
  parseDnSandboxConfig,
  parseSandboxProvider,
  withSandboxProvider,
} from "./config.ts";
import type { DnSandboxConfig, SandboxProvider } from "./types.ts";

/** CLI `--sandbox` with no value: read provider from repo config. */
export type SandboxFlagValue = SandboxProvider | "from-config";

/**
 * Resolves the effective sandbox provider.
 *
 * Priority: explicit CLI value → `DN_SANDBOX_PROVIDER` → config → `none`.
 */
export function resolveSandboxProvider(options: {
  cliFlag?: SandboxFlagValue | null;
  envProvider?: string | null;
  configProvider?: SandboxProvider | null;
}): SandboxProvider {
  if (options.cliFlag === "none") {
    return "none";
  }
  if (
    options.cliFlag && options.cliFlag !== "from-config"
  ) {
    return options.cliFlag;
  }
  if (options.envProvider) {
    return parseSandboxProvider(options.envProvider);
  }
  if (options.configProvider) {
    return options.configProvider;
  }
  if (options.cliFlag === "from-config") {
    throw new Error(
      `--sandbox requires sandbox.provider in ${DN_CONFIG_REL_PATH} when no value is given`,
    );
  }
  return "none";
}

/**
 * Loads sandbox config from repo config.json and applies provider override.
 */
export async function resolveSandboxConfig(
  repoRoot: string,
  providerOverride?: SandboxProvider | SandboxFlagValue | null,
): Promise<{ provider: SandboxProvider; config: DnSandboxConfig }> {
  const repoConfig = await resolveDnConfig({ repoRoot });
  const baseSandbox = repoConfig.sandbox ??
    parseDnSandboxConfig(undefined);
  const envProvider = Deno.env.get("DN_SANDBOX_PROVIDER") ?? null;
  const provider = resolveSandboxProvider({
    cliFlag: providerOverride ?? null,
    envProvider,
    configProvider: baseSandbox.provider,
  });
  return {
    provider,
    config: withSandboxProvider(baseSandbox, provider),
  };
}

/** Whether sandbox dry-run mode is enabled via env. */
export function isSandboxDryRun(): boolean {
  return Deno.env.get("DN_SANDBOX_DRY_RUN") === "1";
}

/**
 * Absolute host path for a mount source relative to the repo root.
 */
export function resolveMountSource(repoRoot: string, source: string): string {
  if (source.startsWith("/")) {
    return source;
  }
  return join(repoRoot, source);
}
