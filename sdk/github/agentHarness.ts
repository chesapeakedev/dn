// Copyright 2026 Chesapeake Computing
// SPDX-License-Identifier: Apache-2.0

import { runClaudeAgent } from "./claudeAgent.ts";
import { runCodexAgent } from "./codexAgent.ts";
import { runCursorAgent } from "./cursorAgent.ts";
import type { OpenCodeResult } from "./opencode.ts";
import { runOpenCode } from "./opencode.ts";

/**
 * Which external agent harness executes plan/implement phases.
 *
 * - `opencode` — OpenCode CLI (default)
 * - `cursor` — Cursor headless `agent` CLI
 * - `claude` — Anthropic Claude Code CLI (`claude -p`)
 * - `codex` — OpenAI Codex CLI (`codex exec`)
 */
export type AgentHarness = "opencode" | "cursor" | "claude" | "codex";

/** All supported agent harness identifiers. */
export const AGENT_HARNESSES: readonly AgentHarness[] = [
  "opencode",
  "cursor",
  "claude",
  "codex",
];

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
 * @returns The runner for the selected agent backend
 */
export function getRunAgent(harness: AgentHarness): RunAgentFn {
  if (harness === "cursor") {
    return runCursorAgent;
  }
  if (harness === "claude") {
    return runClaudeAgent;
  }
  if (harness === "codex") {
    return runCodexAgent;
  }
  return runOpenCode;
}

/**
 * Parses a user-provided agent harness name.
 *
 * @param value - Raw CLI value
 * @returns The parsed agent harness
 * @throws Error if the value is not a supported harness
 */
export function parseAgentHarness(value: string): AgentHarness {
  if (AGENT_HARNESSES.includes(value as AgentHarness)) {
    return value as AgentHarness;
  }
  throw new Error(
    `Invalid agent: ${value}. Must be one of: ${AGENT_HARNESSES.join(", ")}`,
  );
}

/**
 * Parses CLI flags and environment into a single {@link AgentHarness}.
 *
 * Explicit agent selection is mutually exclusive with legacy agent flags for a
 * different harness. Environment toggles are used only when no explicit CLI
 * selection was provided.
 *
 * @param options.agent - Explicit `--agent <name>` value, usually from global CLI flags
 * @param options.cursorFlag - True if `--cursor` or `-c` was passed
 * @param options.claudeFlag - True if `--claude` was passed
 * @param options.codexFlag - True if `--codex` was passed
 * @param options.opencodeFlag - True if `--opencode` was passed
 * @returns Resolved harness (default `opencode`)
 * @throws Error if conflicting flags or env vars are set
 */
export function resolveAgentHarnessFromFlagsAndEnv(options: {
  agent?: AgentHarness | null;
  cursorFlag: boolean;
  claudeFlag: boolean;
  codexFlag?: boolean;
  opencodeFlag?: boolean;
}): AgentHarness {
  const flagSelections: AgentHarness[] = [];
  if (options.opencodeFlag) {
    flagSelections.push("opencode");
  }
  if (options.cursorFlag) {
    flagSelections.push("cursor");
  }
  if (options.claudeFlag) {
    flagSelections.push("claude");
  }
  if (options.codexFlag) {
    flagSelections.push("codex");
  }

  const uniqueFlagSelections = [...new Set(flagSelections)];
  if (uniqueFlagSelections.length > 1) {
    throw new Error(
      `Conflicting agent flags: ${
        uniqueFlagSelections.join(", ")
      }. Select only one agent.`,
    );
  }

  const flagAgent = uniqueFlagSelections[0];
  if (options.agent && flagAgent && options.agent !== flagAgent) {
    throw new Error(
      `Conflicting agent selections: --agent ${options.agent} and --${flagAgent}. Select only one agent.`,
    );
  }
  if (flagAgent) {
    return flagAgent;
  }
  if (options.agent) {
    return options.agent;
  }

  const envSelections: AgentHarness[] = [];
  if (Deno.env.get("OPENCODE_ENABLED") === "1") {
    envSelections.push("opencode");
  }
  if (Deno.env.get("CURSOR_ENABLED") === "1") {
    envSelections.push("cursor");
  }
  if (Deno.env.get("CLAUDE_ENABLED") === "1") {
    envSelections.push("claude");
  }
  if (Deno.env.get("CODEX_ENABLED") === "1") {
    envSelections.push("codex");
  }

  const uniqueEnvSelections = [...new Set(envSelections)];
  if (uniqueEnvSelections.length > 1) {
    throw new Error(
      `Conflicting agent environment variables: ${
        uniqueEnvSelections.join(", ")
      }. Enable at most one harness via environment.`,
    );
  }
  if (uniqueEnvSelections[0]) {
    return uniqueEnvSelections[0];
  }
  return "opencode";
}
