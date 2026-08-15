// Copyright 2026 Chesapeake Computing
// SPDX-License-Identifier: Apache-2.0

import {
  type AgentHarness,
  resolveAgentHarnessFromFlagsAndEnv,
} from "../github/agentHarness.ts";
import { resolveDnConfig } from "./resolve.ts";

/** Flag inputs shared with {@link resolveAgentHarnessFromFlagsAndEnv}. */
export interface ResolveLocalAgentHarnessOptions {
  /** Repository root used to load `dn.json` / user config. */
  repoRoot: string;
  /** Explicit `--agent <name>` value, usually from global CLI flags. */
  agent?: AgentHarness | null;
  /** True if `--cursor` or `-c` was passed. */
  cursorFlag: boolean;
  /** True if `--claude` was passed. */
  claudeFlag: boolean;
  /** True if `--codex` was passed. */
  codexFlag?: boolean;
  /** True if `--copilot` was passed. */
  copilotFlag?: boolean;
  /** True if `--opencode` was passed. */
  opencodeFlag?: boolean;
}

/**
 * Resolves the local CLI agent with tiered config fallback.
 *
 * Precedence: CLI flags → `DN_AGENT` → `*_ENABLED` env → project `dn.json` /
 * user config (via {@link resolveDnConfig}) → built-in `opencode`.
 */
export async function resolveLocalAgentHarness(
  options: ResolveLocalAgentHarnessOptions,
): Promise<AgentHarness> {
  const config = await resolveDnConfig({
    repoRoot: options.repoRoot,
    // File layers only; DN_AGENT and *_ENABLED are handled in the harness helper.
    env: {},
    cli: {},
  });
  return resolveAgentHarnessFromFlagsAndEnv({
    agent: options.agent,
    cursorFlag: options.cursorFlag,
    claudeFlag: options.claudeFlag,
    codexFlag: options.codexFlag,
    copilotFlag: options.copilotFlag,
    opencodeFlag: options.opencodeFlag,
    fallbackAgent: config.agent,
  });
}
