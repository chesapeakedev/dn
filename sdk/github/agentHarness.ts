// Copyright 2026 Chesapeake Computing
// SPDX-License-Identifier: Apache-2.0

import { runClaudeAgent } from "./claudeAgent.ts";
import { runCursorAgent } from "./cursorAgent.ts";
import type { OpenCodeResult } from "./opencode.ts";
import { runOpenCode } from "./opencode.ts";

/**
 * Which external agent harness executes plan/implement phases.
 *
 * - `opencode` — OpenCode CLI (default)
 * - `cursor` — Cursor headless `agent` CLI
 * - `claude` — Anthropic Claude Code CLI (`claude -p`)
 */
export type AgentHarness = "opencode" | "cursor" | "claude";

/**
 * Function type for running a plan or implement phase against a combined prompt file.
 */
export type RunAgentFn = (
  phase: "plan" | "implement",
  combinedPromptPath: string,
  workspaceRoot: string,
  useReadonlyConfig?: boolean,
) => Promise<OpenCodeResult>;

/**
 * Returns the runner for the given harness.
 *
 * @param harness - Selected agent backend
 * @returns The `runOpenCode`, `runCursorAgent`, or `runClaudeAgent` function
 */
export function getRunAgent(harness: AgentHarness): RunAgentFn {
  if (harness === "cursor") {
    return runCursorAgent;
  }
  if (harness === "claude") {
    return runClaudeAgent;
  }
  return runOpenCode;
}

/**
 * Parses CLI flags and environment into a single {@link AgentHarness}.
 *
 * Flags `--cursor` / `-c` and `--claude` are mutually exclusive with each other.
 * `CURSOR_ENABLED=1` and `CLAUDE_ENABLED=1` cannot both be set.
 *
 * @param options.cursorFlag - True if `--cursor` or `-c` was passed
 * @param options.claudeFlag - True if `--claude` was passed
 * @returns Resolved harness (default `opencode`)
 * @throws Error if conflicting flags or env vars are set
 */
export function resolveAgentHarnessFromFlagsAndEnv(options: {
  cursorFlag: boolean;
  claudeFlag: boolean;
}): AgentHarness {
  if (options.cursorFlag && options.claudeFlag) {
    throw new Error("Cannot use --cursor and --claude together.");
  }
  if (options.cursorFlag) {
    return "cursor";
  }
  if (options.claudeFlag) {
    return "claude";
  }

  const cursorEnv = Deno.env.get("CURSOR_ENABLED") === "1";
  const claudeEnv = Deno.env.get("CLAUDE_ENABLED") === "1";
  if (cursorEnv && claudeEnv) {
    throw new Error(
      "CURSOR_ENABLED=1 and CLAUDE_ENABLED=1 conflict; enable at most one harness via environment.",
    );
  }
  if (cursorEnv) {
    return "cursor";
  }
  if (claudeEnv) {
    return "claude";
  }
  return "opencode";
}
