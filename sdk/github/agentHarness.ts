// Copyright 2026 Chesapeake Computing
// SPDX-License-Identifier: Apache-2.0

import { logAgentPhaseIntent } from "./agentModel.ts";
import { runClaudeAgent } from "./claudeAgent.ts";
import { runCodexAgent } from "./codexAgent.ts";
import { runCopilotAgent } from "./copilotAgent.ts";
import { runCursorAgent } from "./cursorAgent.ts";
import type { OpenCodeResult } from "./opencode.ts";
import { runOpenCode } from "./opencode.ts";
import type { ProgressReporter } from "./progress.ts";

/**
 * Which external agent harness executes plan/implement phases.
 *
 * - `opencode` — OpenCode CLI (default)
 * - `cursor` — Cursor headless `agent` CLI
 * - `claude` — Anthropic Claude Code CLI (`claude -p`)
 * - `codex` — OpenAI Codex CLI (`codex exec`)
 * - `copilot` — GitHub Copilot CLI (`copilot -p`)
 */
export type AgentHarness =
  | "opencode"
  | "cursor"
  | "claude"
  | "codex"
  | "copilot";

/** All supported agent harness identifiers. */
export const AGENT_HARNESSES: readonly AgentHarness[] = [
  "opencode",
  "cursor",
  "claude",
  "codex",
  "copilot",
];

/**
 * Parsed `--agent` value: a harness, optional model, and optional thinking
 * segment.
 *
 * Common form is `harness:model`. A third `thinking` segment is optional.
 */
export interface AgentSelection {
  /** Selected agent backend. */
  harness: AgentHarness;
  /** Model id forwarded to the harness CLI when set. */
  model?: string;
  /** Thinking / effort / variant forwarded when the harness supports it. */
  thinking?: string;
}

/**
 * Optional model and thinking overrides passed through to a harness invocation.
 */
export interface AgentRunOptions {
  /** Model id forwarded to the harness CLI when set. */
  model?: string;
  /** Thinking / effort / variant forwarded when the harness supports it. */
  thinking?: string;
}

/**
 * Returns the human-readable CLI or product name for an agent harness.
 *
 * @param harness - Selected agent backend
 * @returns Display name suitable for user-facing status output
 */
export function formatAgentHarnessName(harness: AgentHarness): string {
  if (harness === "cursor") {
    return "Cursor headless agent";
  }
  if (harness === "claude") {
    return "Claude Code";
  }
  if (harness === "codex") {
    return "Codex CLI";
  }
  if (harness === "copilot") {
    return "GitHub Copilot CLI";
  }
  return "OpenCode";
}

/**
 * Formats a selection as the `--agent` value users type.
 *
 * @param selection - Parsed harness, model, and optional thinking
 */
export function formatAgentSelection(selection: AgentSelection): string {
  if (selection.model && selection.thinking) {
    return `${selection.harness}:${selection.model}:${selection.thinking}`;
  }
  if (selection.model) {
    return `${selection.harness}:${selection.model}`;
  }
  return selection.harness;
}

/**
 * Returns true when two selections name the same harness, model, and thinking.
 */
export function agentSelectionsEqual(
  left: AgentSelection,
  right: AgentSelection,
): boolean {
  return left.harness === right.harness && left.model === right.model &&
    left.thinking === right.thinking;
}

/**
 * Normalizes a bare harness name or a full selection to {@link AgentSelection}.
 */
export function asAgentSelection(
  value: AgentHarness | AgentSelection,
): AgentSelection {
  return typeof value === "string" ? { harness: value } : value;
}

/**
 * Converts a selection into run options for harness argv builders.
 *
 * @returns `undefined` when neither model nor thinking is set
 */
export function toAgentRunOptions(
  selection: { model?: string; thinking?: string },
): AgentRunOptions | undefined {
  const model = selection.model?.trim();
  const thinking = selection.thinking?.trim();
  if (!model && !thinking) {
    return undefined;
  }
  return {
    ...(model ? { model } : {}),
    ...(thinking ? { thinking } : {}),
  };
}

/**
 * Function type for running a plan or implement phase against a combined prompt file.
 */
export type RunAgentFn = (
  phase: "plan" | "implement",
  combinedPromptPath: string,
  workspaceRoot: string,
  useReadonlyConfig?: boolean,
  reporter?: ProgressReporter,
) => Promise<OpenCodeResult>;

/**
 * Returns the runner for the given harness.
 *
 * Wraps the harness runner so every host-side phase logs a harness-agnostic
 * intent line (`agent=… model=…`) before execution.
 *
 * @param harness - Selected agent backend
 * @param options - Optional model and thinking forwarded to the harness CLI
 * @returns The runner for the selected agent backend
 */
export function getRunAgent(
  harness: AgentHarness,
  options?: AgentRunOptions,
): RunAgentFn {
  const run = harness === "cursor"
    ? runCursorAgent
    : harness === "claude"
    ? runClaudeAgent
    : harness === "codex"
    ? runCodexAgent
    : harness === "copilot"
    ? runCopilotAgent
    : runOpenCode;

  return async (
    phase,
    combinedPromptPath,
    workspaceRoot,
    useReadonlyConfig,
    reporter,
  ) => {
    await logAgentPhaseIntent(
      harness,
      workspaceRoot,
      useReadonlyConfig === true,
      options,
    );
    return await run(
      phase,
      combinedPromptPath,
      workspaceRoot,
      useReadonlyConfig,
      reporter,
      options,
    );
  };
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
 * Parses `--agent` values: `harness`, `harness:model`, or
 * `harness:model:thinking`.
 *
 * Cursor and Copilot reject a thinking segment because those CLIs do not take a
 * separate thinking flag; put the variant in the model id instead.
 *
 * @param value - Raw CLI or `DN_AGENT` value
 * @throws Error if the value is empty, has empty segments, names an unknown
 * harness, or asks Cursor/Copilot for thinking
 */
export function parseAgentSelection(value: string): AgentSelection {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error(
      `Invalid agent: ${value}. Expected <harness>, <harness>:<model>, or <harness>:<model>:<thinking>.`,
    );
  }
  const parts = trimmed.split(":");
  if (parts.some((part) => part.length === 0)) {
    throw new Error(
      `Invalid agent: ${value}. Expected <harness>, <harness>:<model>, or <harness>:<model>:<thinking>.`,
    );
  }
  const harness = parseAgentHarness(parts[0]);
  if (parts.length === 1) {
    return { harness };
  }
  if (parts.length === 2) {
    return { harness, model: parts[1] };
  }
  const thinking = parts[parts.length - 1];
  const model = parts.slice(1, -1).join(":");
  if (harness === "cursor" || harness === "copilot") {
    throw new Error(
      `--agent ${harness} does not accept a thinking segment; include the variant in the model id (for example --agent ${harness}:<model>).`,
    );
  }
  return { harness, model, thinking };
}

const LEGACY_AGENT_ALIAS_FLAGS: Record<string, AgentHarness> = {
  "--opencode": "opencode",
  "--cursor": "cursor",
  "-c": "cursor",
  "--claude": "claude",
  "--codex": "codex",
  "--copilot": "copilot",
};

/**
 * Throws when `flag` is a removed harness alias such as `--codex` or `--cursor`.
 *
 * @param flag - A CLI token that might be a legacy agent alias
 */
export function assertNotLegacyAgentAlias(flag: string): void {
  const harness = LEGACY_AGENT_ALIAS_FLAGS[flag];
  if (!harness) return;
  throw new Error(
    `Unknown option: ${flag}. Use --agent ${harness} or --agent ${harness}:<model>.`,
  );
}

/**
 * Pulls `--agent` / `--agent=` tokens out of a CLI argument list.
 *
 * @param args - Subcommand arguments (not including the subcommand name)
 * @returns Remaining args plus the last parsed selection when `--agent` appears
 * @throws Error if `--agent` is missing a value or values conflict
 */
export function extractAgentSelectionFromArgs(
  args: readonly string[],
): { selection: AgentSelection | null; rest: string[] } {
  const rest: string[] = [];
  let selection: AgentSelection | null = null;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    let raw: string | undefined;
    if (arg === "--agent") {
      raw = args[i + 1];
      if (raw === undefined || raw.startsWith("-")) {
        throw new Error("Missing value for --agent");
      }
      i++;
    } else if (arg.startsWith("--agent=")) {
      raw = arg.slice("--agent=".length);
      if (!raw) {
        throw new Error("Missing value for --agent");
      }
    } else {
      assertNotLegacyAgentAlias(arg);
      rest.push(arg);
      continue;
    }
    const parsed = parseAgentSelection(raw);
    if (selection && !agentSelectionsEqual(selection, parsed)) {
      throw new Error(
        `Conflicting agent selections: ${formatAgentSelection(selection)} and ${
          formatAgentSelection(parsed)
        }. Select only one agent.`,
      );
    }
    selection = parsed;
  }
  return { selection, rest };
}

/**
 * Returns the non-null selection, or throws when both are set and disagree.
 */
export function mergeAgentSelections(
  globalAgent: AgentSelection | null | undefined,
  localAgent: AgentSelection | null | undefined,
): AgentSelection | null {
  if (
    globalAgent && localAgent &&
    !agentSelectionsEqual(globalAgent, localAgent)
  ) {
    throw new Error(
      `Conflicting agent selections: ${formatAgentSelection(globalAgent)} and ${
        formatAgentSelection(localAgent)
      }. Select only one agent.`,
    );
  }
  return localAgent ?? globalAgent ?? null;
}

/**
 * Parses CLI flags and environment into a single {@link AgentSelection}.
 *
 * Environment toggles (`DN_AGENT`, `*_ENABLED`) are used only when no explicit
 * `--agent` selection was provided. File config supplies a harness-only
 * fallback after that.
 *
 * @param options.agent - Explicit `--agent` selection from CLI flags
 * @param options.fallbackAgent - Config-derived harness used after flags/env
 * @returns Resolved selection (default harness `opencode`)
 * @throws Error if conflicting env vars are set
 */
export function resolveAgentHarnessFromFlagsAndEnv(options: {
  agent?: AgentSelection | null;
  fallbackAgent?: AgentHarness | null;
} = {}): AgentSelection {
  if (options.agent) {
    return options.agent;
  }

  const dnAgent = Deno.env.get("DN_AGENT");
  if (dnAgent) {
    return parseAgentSelection(dnAgent);
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
  if (Deno.env.get("COPILOT_ENABLED") === "1") {
    envSelections.push("copilot");
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
    return { harness: uniqueEnvSelections[0] };
  }
  if (options.fallbackAgent) {
    return { harness: options.fallbackAgent };
  }
  return { harness: "opencode" };
}
