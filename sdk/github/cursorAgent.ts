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
  formatWarning,
  isTty,
  isUnattended,
  Spinner,
} from "./output.ts";
import type { AgentRunOptions } from "./agentHarness.ts";
import type { ProgressReporter } from "./progress.ts";

/**
 * Builds the Cursor headless CLI arguments for non-interactive agent execution.
 *
 * @param promptInstruction - Initial agent prompt or instruction text
 * @param options - Optional model override (`--model`)
 * @returns Arguments to pass after the `agent` executable
 */
export function buildCursorAgentArgs(
  promptInstruction: string,
  options?: AgentRunOptions,
): string[] {
  const args = ["-p", "--force"];
  const model = options?.model?.trim();
  if (model) {
    args.push("--model", model);
  }
  args.push(promptInstruction);
  return args;
}

/**
 * Executes the Cursor headless CLI (agent) with the specified phase and prompt file.
 * Uses the same result shape as runOpenCode for drop-in use.
 *
 * See https://cursor.com/docs/cli/headless for Cursor CLI setup (install, CURSOR_API_KEY).
 *
 * @param phase - The phase to run ("plan" or "implement"); used only for log/spinner text
 * @param combinedPromptPath - Path to the combined prompt file (will be resolved to absolute)
 * @param workspaceRoot - Root directory of the workspace (cwd for the agent)
 * @param _useReadonlyConfig - Unused; Cursor has no plan vs implement config files
 * @returns Promise resolving to execution result with code, stdout, and stderr
 * @throws Error if agent (Cursor CLI) is not installed
 */
export async function runCursorAgent(
  phase: "plan" | "implement",
  combinedPromptPath: string,
  workspaceRoot: string,
  _useReadonlyConfig?: boolean,
  reporter?: ProgressReporter,
  options?: AgentRunOptions,
): Promise<OpenCodeResult> {
  try {
    await $`which agent`.quiet();
  } catch {
    throw new Error(
      "Cursor CLI (agent) not found. Install it from https://cursor.com/docs/cli/headless and ensure CURSOR_API_KEY is set for headless use.",
    );
  }

  const ttyMode = isTty();
  const attended = ttyMode && !isUnattended();

  // Resolve prompt path to absolute so the agent can read it regardless of cwd
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
        `Running Cursor agent ${phase} phase with combined prompt: ${combinedPromptPath}`,
      ),
    );
  }

  const startTime = Date.now();
  const timeoutMs = parseInt(
    Deno.env.get("CURSOR_TIMEOUT_MS") || Deno.env.get("OPENCODE_TIMEOUT_MS") ||
      "600000",
    10,
  );
  const timeoutWarningMs = Math.min(timeoutMs * 0.8, 600000);
  const longRunWarningMs = 300000;

  const spinner = attended ? new Spinner(`Running ${phase} phase...`) : null;
  if (spinner) {
    spinner.start();
  }

  const progressInterval = setInterval(() => {
    const elapsed = Date.now() - startTime;
    if (spinner && elapsed > 5000) {
      spinner.setMessage(
        `Running ${phase} phase... (${formatElapsedTime(elapsed)})`,
      );
    }
    if (!attended) {
      if (elapsed > longRunWarningMs && elapsed < timeoutWarningMs) {
        console.warn(
          formatWarning(
            `Cursor agent ${phase} phase has been running for ${
              Math.round(elapsed / 1000)
            }s.`,
          ),
        );
      }
      if (elapsed > timeoutWarningMs) {
        const remaining = Math.round((timeoutMs - elapsed) / 1000);
        console.warn(
          formatWarning(`Approaching timeout (${remaining}s remaining).`),
        );
      }
    }
  }, 30000);

  const promptInstruction =
    `Read and execute the instructions in this file: ${absolutePromptPath}`;

  const result = await runAgentCommand(
    "agent",
    buildCursorAgentArgs(promptInstruction, options),
    workspaceRoot,
    phase,
    reporter,
    timeoutMs,
    `Cursor agent ${phase} phase timed out after ${
      Math.round(timeoutMs / 1000)
    }s. ` +
      "Increase timeout with CURSOR_TIMEOUT_MS or OPENCODE_TIMEOUT_MS.",
  ).finally(() => {
    if (spinner) {
      spinner.stop();
    }
    clearInterval(progressInterval);
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
