// Copyright 2026 Chesapeake Computing
// SPDX-License-Identifier: Apache-2.0

import { $ } from "$dax";
import type { OpenCodeResult } from "./opencode.ts";
import { formatElapsedTime, isTty, isUnattended, Spinner } from "./output.ts";

const DN_PREFIX = "[dn] ";

/**
 * Executes the OpenAI Codex CLI non-interactively with the combined prompt file.
 *
 * Uses `codex exec --full-auto -C <workspaceRoot>` so Codex can edit within the
 * target workspace without interactive approval prompts.
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
      `${DN_PREFIX}Running Codex CLI ${phase} phase with combined prompt: ${combinedPromptPath}`,
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
          `${DN_PREFIX}[WARN] Codex CLI ${phase} phase has been running for ${
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
  const codexCommand =
    $`codex exec --full-auto -C ${workspaceRoot} ${promptInstruction}`
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
          `Codex CLI ${phase} phase timed out after ${
            Math.round(timeoutMs / 1000)
          }s. Increase timeout with CODEX_TIMEOUT_MS or OPENCODE_TIMEOUT_MS.`,
        ),
      );
    }, timeoutMs);
  });

  const result = await Promise.race([
    codexCommand,
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
