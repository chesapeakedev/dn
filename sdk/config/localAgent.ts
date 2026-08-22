// Copyright 2026 Chesapeake Computing
// SPDX-License-Identifier: Apache-2.0

import {
  type AgentSelection,
  resolveAgentHarnessFromFlagsAndEnv,
} from "../github/agentHarness.ts";
import { resolveDnConfig } from "./resolve.ts";

/** Flag inputs shared with {@link resolveAgentHarnessFromFlagsAndEnv}. */
export interface ResolveLocalAgentHarnessOptions {
  /** Repository root used to load `dn.json` / user config. */
  repoRoot: string;
  /** Explicit `--agent` selection, usually from global and subcommand CLI flags. */
  agent?: AgentSelection | null;
}

/**
 * Resolves the local CLI agent with tiered config fallback.
 *
 * Precedence: CLI `--agent` → `DN_AGENT` → `*_ENABLED` env → project `dn.json` /
 * user config (via {@link resolveDnConfig}) → built-in `opencode`.
 *
 * File config supplies a harness name only. Model and thinking come from CLI
 * or `DN_AGENT`.
 */
export async function resolveLocalAgentHarness(
  options: ResolveLocalAgentHarnessOptions,
): Promise<AgentSelection> {
  const config = await resolveDnConfig({
    repoRoot: options.repoRoot,
    // File layers only; DN_AGENT and *_ENABLED are handled in the harness helper.
    env: {},
    cli: {},
  });
  return resolveAgentHarnessFromFlagsAndEnv({
    agent: options.agent,
    fallbackAgent: config.agent,
  });
}
