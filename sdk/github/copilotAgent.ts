// Copyright 2026 Chesapeake Computing
// SPDX-License-Identifier: Apache-2.0

import { $ } from "$dax";
import type { OpenCodeResult } from "./opencode.ts";
import { formatElapsedTime, isTty, isUnattended, Spinner } from "./output.ts";

const DN_PREFIX = "[dn] ";

/**
 * Executes the GitHub Copilot CLI (`gh copilot suggest`) with the specified
 * phase and prompt file.
 *
 * Uses `gh copilot suggest -t shell` to generate shell commands from the
 * combined prompt instruction. This provides a Copilot-driven suggestion
 * stream for plan and implement phases.
 *
 * **Prerequisites**
 *
 * - GitHub CLI (`gh`) must be installed and authenticated.
 * - The `gh copilot` extension must be installed (`gh extension install github/gh-copilot`).
 *
 * **Environment**
 *
 * - `COPILOT_TIMEOUT_MS` — phase timeout; falls back to `OPENCODE_TIMEOUT_MS`, then 10 minutes.
 *
 * @param phase - The phase to run ("plan" or "implement"); used for log/spinner text
 * @param combinedPromptPath - Path to the combined prompt file (resolved to absolute)
 * @param workspaceRoot - Root directory of the workspace (cwd for the agent)
 * @param _useReadonlyConfig - Unused; Copilot has no plan vs implement config files
 * @returns Promise resolving to execution result with code, stdout, and stderr
 * @throws Error if `gh` is not installed, the `copilot` extension is missing,
 *               or the prompt path is invalid
 */
export async function runCopilotAgent(
  phase: "plan" | "implement",
  combinedPromptPath: string,
  workspaceRoot: string,
  _useReadonlyConfig?: boolean,
): Promise<OpenCodeResult> {
  try {
    await $`which gh`.quiet();
  } catch {
    throw new Error(
      "GitHub CLI (gh) not found. Install it from https://cli.github.com/ and authenticate with `gh auth login`.",
    );
  }

  try {
    const extCheck = await $`gh extension list`.quiet().stdout("piped");
    if (
      !extCheck.stdout.includes("gh-copilot") &&
      !extCheck.stdout.includes("copilot")
    ) {
      throw new Error(
        "gh copilot extension not found. Install it with: gh extension install github/gh-copilot",
      );
    }
  } catch (error) {
    if (
      error instanceof Error &&
      (error.message.includes("gh copilot extension not found") ||
        error.message.includes("GitHub CLI"))
    ) {
      throw error;
    }
    throw new Error(
      "gh copilot extension not found. Install it with: gh extension install github/gh-copilot",
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
      `${DN_PREFIX}Running GitHub Copilot ${phase} phase with combined prompt: ${combinedPromptPath}`,
    );
  }

  const startTime = Date.now();
  const timeoutMs = parseInt(
    Deno.env.get("COPILOT_TIMEOUT_MS") || Deno.env.get("OPENCODE_TIMEOUT_MS") ||
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
          `${DN_PREFIX}[WARN] GitHub Copilot ${phase} phase has been running for ${
            Math.round(elapsed / 1000)
          }s.`,
        );
      }
      if (elapsed > timeoutWarningMs) {
        const remaining = Math.round((timeoutMs - elapsed) / 1000);
        console.warn(
          `${DN_PREFIX}[WARN] Approaching timeout (${remaining}s remaining).`,
        );
      }
    }
  }, 30000);

  const promptInstruction =
    `Read and execute the instructions in this file: ${absolutePromptPath}`;

  const copilotCommand = $`gh copilot suggest -t shell ${promptInstruction}`
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
          `GitHub Copilot ${phase} phase timed out after ${
            Math.round(timeoutMs / 1000)
          }s. Increase timeout with COPILOT_TIMEOUT_MS or OPENCODE_TIMEOUT_MS.`,
        ),
      );
    }, timeoutMs);
  });

  const result = await Promise.race([
    copilotCommand,
    timeoutPromise,
  ]).finally(() => {
    if (spinner) {
      spinner.stop();
    }
    clearInterval(progressInterval);
  });

  const elapsed = Date.now() - startTime;
  const exitCode = result.code ?? 0;

  if (attended) {
    if (exitCode === 0) {
      console.log(
        `\n✅ ${phase} phase completed in ${formatElapsedTime(elapsed)}`,
      );
    } else {
      console.error(
        `\n❌ ${phase} phase failed (exit code ${exitCode}) after ${
          formatElapsedTime(elapsed)
        }`,
      );
    }
    console.log("");
    if (result.stdout) {
      console.log(result.stdout);
    }
    if (result.stderr) {
      console.error(result.stderr);
    }
  } else {
    if (exitCode === 0) {
      console.log(
        `${DN_PREFIX}${phase} phase done (${formatElapsedTime(elapsed)}).`,
      );
    } else {
      console.error(
        `${DN_PREFIX}[ERROR] ${phase} phase failed (exit ${exitCode}) after ${
          formatElapsedTime(elapsed)
        }.`,
      );
    }
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
