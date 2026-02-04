// Copyright 2026 Chesapeake Computing
// SPDX-License-Identifier: Apache-2.0

import { $ } from "$dax";
import type { OpenCodeResult } from "./opencode.ts";
import { formatElapsedTime, isTty, Spinner } from "./output.ts";

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
): Promise<OpenCodeResult> {
  try {
    await $`which agent`.quiet();
  } catch {
    throw new Error(
      "Cursor CLI (agent) not found. Install it from https://cursor.com/docs/cli/headless and ensure CURSOR_API_KEY is set for headless use.",
    );
  }

  const ttyMode = isTty();

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

  if (!ttyMode) {
    console.log(
      `Running Cursor agent ${phase} phase with combined prompt: ${combinedPromptPath}`,
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

  const spinner = ttyMode ? new Spinner(`Running ${phase} phase...`) : null;
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
    if (!ttyMode) {
      if (elapsed > longRunWarningMs && elapsed < timeoutWarningMs) {
        console.warn(
          `\n⚠️  Warning: Cursor agent ${phase} phase has been running for ${
            Math.round(elapsed / 1000)
          }s.\n`,
        );
      }
      if (elapsed > timeoutWarningMs) {
        const remaining = Math.round((timeoutMs - elapsed) / 1000);
        console.warn(
          `\n⚠️  Warning: Approaching timeout (${remaining}s remaining).\n`,
        );
      }
    }
  }, 30000);

  const promptInstruction =
    `Read and execute the instructions in this file: ${absolutePromptPath}`;

  const agentCommand = $`agent -p --force ${promptInstruction}`
    .cwd(workspaceRoot)
    .noThrow()
    .stdout("piped")
    .stderr("piped")
    .stdin("null");

  const timeoutPromise = new Promise<never>((_, reject) => {
    setTimeout(() => {
      if (spinner) {
        spinner.stop();
      }
      clearInterval(progressInterval);
      reject(
        new Error(
          `Cursor agent ${phase} phase timed out after ${
            Math.round(timeoutMs / 1000)
          }s. Increase timeout with CURSOR_TIMEOUT_MS or OPENCODE_TIMEOUT_MS.`,
        ),
      );
    }, timeoutMs);
  });

  const result = await Promise.race([
    agentCommand,
    timeoutPromise,
  ]).finally(() => {
    if (spinner) {
      spinner.stop();
    }
    clearInterval(progressInterval);
  });

  const elapsed = Date.now() - startTime;

  if (ttyMode) {
    console.log(
      `\n✅ ${phase} phase completed in ${formatElapsedTime(elapsed)}`,
    );
    console.log("");
    if (result.stdout) {
      console.log(result.stdout);
    }
    if (result.stderr) {
      console.error(result.stderr);
    }
  } else {
    if (result.stdout) {
      console.log(result.stdout);
    }
    if (result.stderr) {
      console.error(result.stderr);
    }
  }

  return {
    code: result.code ?? 0,
    stdout: result.stdout || "",
    stderr: result.stderr || "",
  };
}
