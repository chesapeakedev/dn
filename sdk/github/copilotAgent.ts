// Copyright 2026 Chesapeake Computing
// SPDX-License-Identifier: Apache-2.0

import { $ } from "$dax";
import { runAgentCommand } from "./agentExecution.ts";
import type { OpenCodeResult } from "./opencode.ts";
import {
  formatElapsedTime,
  formatError,
  formatInfo,
  formatSuccess,
  isTty,
  isUnattended,
  Spinner,
} from "./output.ts";
import type { AgentRunOptions } from "./agentHarness.ts";
import {
  buildAgentPhaseTimeoutMessage,
  resolveHarnessPhaseTimeoutMs,
  startAgentPhaseProgressMonitor,
} from "./agentPhaseRuntime.ts";
import type { ProgressReporter } from "./progress.ts";
const DEFAULT_ALLOWED_TOOLS =
  "write, shell(deno:*), shell(make:*), shell(sl:*)";

/**
 * Options used to build a non-interactive GitHub Copilot CLI invocation.
 */
export interface CopilotExecOptions {
  /** Tool permissions to pass to `--allow-tool`. */
  allowedTools?: string;
  /** Optional Copilot model name to pass to `--model`. */
  model?: string;
}

/**
 * Builds the GitHub Copilot CLI arguments for non-interactive agent execution.
 *
 * @param promptInstruction - Initial Copilot prompt or instruction text
 * @param options - Optional model and tool permission overrides
 * @returns Arguments to pass after the `copilot` executable
 */
export function buildCopilotExecArgs(
  promptInstruction: string,
  options: CopilotExecOptions = {},
): string[] {
  const allowedTools = options.allowedTools?.trim() || DEFAULT_ALLOWED_TOOLS;
  const args = [
    "-p",
    promptInstruction,
    "-s",
    "--no-ask-user",
    `--allow-tool=${allowedTools}`,
  ];
  const model = options.model?.trim();
  if (model) {
    args.push("--model", model);
  }
  return args;
}

/**
 * Executes the GitHub Copilot CLI (`copilot`) with the specified phase and
 * prompt file.
 *
 * Uses `copilot -p` in silent, non-interactive mode so Copilot can run as an
 * agent-backed workflow harness, matching the shape of the Cursor, Claude, and
 * Codex integrations.
 *
 * **Prerequisites**
 *
 * - GitHub Copilot CLI (`copilot`) must be installed and authenticated.
 *
 * **Environment**
 *
 * - `COPILOT_ALLOWED_TOOLS` — overrides the default `--allow-tool` permissions.
 * - `COPILOT_MODEL` — optional model name passed to `--model`.
 * - `COPILOT_TIMEOUT_MS` — phase timeout; falls back to `OPENCODE_TIMEOUT_MS`, then 10 minutes.
 *
 * @param phase - The phase to run ("plan" or "implement"); used for log/spinner text
 * @param combinedPromptPath - Path to the combined prompt file (resolved to absolute)
 * @param workspaceRoot - Root directory of the workspace (cwd for the agent)
 * @param _useReadonlyConfig - Unused; Copilot has no plan vs implement config files
 * @returns Promise resolving to execution result with code, stdout, and stderr
 * @throws Error if `copilot` is not installed or the prompt path is invalid
 */
export async function runCopilotAgent(
  phase: "plan" | "implement",
  combinedPromptPath: string,
  workspaceRoot: string,
  _useReadonlyConfig?: boolean,
  reporter?: ProgressReporter,
  options?: AgentRunOptions,
): Promise<OpenCodeResult> {
  try {
    await $`which copilot`.quiet();
  } catch {
    throw new Error(
      "GitHub Copilot CLI (copilot) not found. Install it from https://docs.github.com/en/copilot/how-tos/copilot-cli/set-up-copilot-cli/install-copilot-cli and authenticate with `copilot login`.",
    );
  }

  const ttyMode = isTty();
  const attended = ttyMode && !isUnattended();

  let absolutePromptPath: string;
  try {
    const stat = await Deno.stat(combinedPromptPath);
    if (!stat.isFile) {
      throw new Error(`Not a file: ${combinedPromptPath}`);
    }
    absolutePromptPath = await Deno.realPath(combinedPromptPath);
  } catch (error) {
    throw new Error(
      `Combined prompt file not found or not accessible: ${combinedPromptPath}. ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }

  if (!attended) {
    console.log(
      formatInfo(
        `Running GitHub Copilot ${phase} phase with combined prompt: ${combinedPromptPath}`,
      ),
    );
  }

  const startTime = Date.now();
  const timeoutMs = resolveHarnessPhaseTimeoutMs(phase, "COPILOT_TIMEOUT_MS");

  const spinner = attended ? new Spinner(`Running ${phase} phase...`) : null;
  if (spinner) {
    spinner.start();
  }

  const stopProgressMonitor = startAgentPhaseProgressMonitor({
    phase,
    timeoutMs,
    attended,
    label: "GitHub Copilot",
    reporter,
    spinner,
  });

  const promptInstruction =
    `Read and execute the instructions in this file: ${absolutePromptPath}`;
  const copilotArgs = buildCopilotExecArgs(promptInstruction, {
    allowedTools: Deno.env.get("COPILOT_ALLOWED_TOOLS"),
    model: options?.model?.trim() || Deno.env.get("COPILOT_MODEL"),
  });

  const result = await runAgentCommand(
    "copilot",
    copilotArgs,
    workspaceRoot,
    phase,
    reporter,
    timeoutMs,
    buildAgentPhaseTimeoutMessage(
      "GitHub Copilot",
      phase,
      timeoutMs,
      "Increase timeout with IMPLEMENT_TIMEOUT_MS, PLAN_TIMEOUT_MS, COPILOT_TIMEOUT_MS, or OPENCODE_TIMEOUT_MS.",
    ),
  ).finally(() => {
    if (spinner) {
      spinner.stop();
    }
    stopProgressMonitor();
  });

  const elapsed = Date.now() - startTime;
  const exitCode = result.code ?? 0;

  if (exitCode === 0) {
    console.log(
      formatSuccess(
        `${phase} phase completed in ${formatElapsedTime(elapsed)}`,
      ),
    );
  } else {
    console.error(
      formatError(
        `${phase} phase failed (exit ${exitCode}) after ${
          formatElapsedTime(elapsed)
        }`,
      ),
    );
  }

  return {
    code: result.code ?? 0,
    stdout: result.stdout || "",
    stderr: result.stderr || "",
  };
}
