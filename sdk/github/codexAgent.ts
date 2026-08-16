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
import type { ProgressReporter } from "./progress.ts";

/**
 * Builds the Codex CLI arguments for non-interactive agent execution.
 *
 * @param workspaceRoot - Root directory of the workspace Codex should operate in
 * @param promptInstruction - Initial Codex prompt or instruction text
 * @returns Arguments to pass after the `codex` executable
 */
export function buildCodexExecArgs(
  workspaceRoot: string,
  promptInstruction: string,
): string[] {
  return [
    "exec",
    "--sandbox",
    "workspace-write",
    "--skip-git-repo-check",
    "-C",
    workspaceRoot,
    promptInstruction,
  ];
}

/**
 * Executes the OpenAI Codex CLI non-interactively with the combined prompt file.
 *
 * Uses `codex exec --sandbox workspace-write --skip-git-repo-check -C
 * <workspaceRoot>` so Codex can edit within the target workspace without
 * interactive approval prompts.
 *
 * **Environment**
 *
 * - `CODEX_TIMEOUT_MS` — phase timeout; falls back to `OPENCODE_TIMEOUT_MS`, then 10 minutes.
 *
 * @param phase - The phase to run ("plan" or "implement"); used for log/spinner text
 * @param combinedPromptPath - Path to the combined prompt file (resolved to absolute)
 * @param workspaceRoot - Root directory of the workspace
 * @param _useReadonlyConfig - Unused; Codex does not use opencode-style config swapping
 * @returns Promise resolving to execution result with code, stdout, and stderr
 * @throws Error if `codex` is not installed or the prompt path is invalid
 */
export async function runCodexAgent(
  phase: "plan" | "implement",
  combinedPromptPath: string,
  workspaceRoot: string,
  _useReadonlyConfig?: boolean,
  reporter?: ProgressReporter,
): Promise<OpenCodeResult> {
  try {
    await $`which codex`.quiet();
  } catch {
    throw new Error(
      "codex command not found. Install Codex CLI and authenticate it before using --agent codex.",
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
        `Running Codex CLI ${phase} phase with combined prompt: ${combinedPromptPath}`,
      ),
    );
  }

  const startTime = Date.now();
  const timeoutMs = parseInt(
    Deno.env.get("CODEX_TIMEOUT_MS") || Deno.env.get("OPENCODE_TIMEOUT_MS") ||
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
            `Codex CLI ${phase} phase has been running for ${
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
  const codexArgs = buildCodexExecArgs(workspaceRoot, promptInstruction);
  const result = await runAgentCommand(
    "codex",
    codexArgs,
    workspaceRoot,
    phase,
    reporter,
    timeoutMs,
    `Codex CLI ${phase} phase timed out after ${
      Math.round(timeoutMs / 1000)
    }s. ` +
      "Increase timeout with CODEX_TIMEOUT_MS or OPENCODE_TIMEOUT_MS.",
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
