// Copyright 2026 Chesapeake Computing
// SPDX-License-Identifier: Apache-2.0

import { $ } from "$dax";
import type { OpenCodeResult } from "./opencode.ts";
import { formatElapsedTime, isTty, isUnattended, Spinner } from "./output.ts";

const DN_PREFIX = "[dn] ";

const DEFAULT_ALLOWED_TOOLS = "Bash,Read,Edit";

/** Modes accepted by `claude --permission-mode` (see `claude --help`). */
const CLAUDE_PERMISSION_MODES = new Set([
  "acceptEdits",
  "auto",
  "bypassPermissions",
  "default",
  "dontAsk",
  "plan",
]);

/**
 * Reads `CLAUDE_PERMISSION_MODE` for `claude --permission-mode`.
 *
 * @returns `acceptEdits` when unset or empty; otherwise a validated mode string
 * @throws Error if the env value is not a known mode
 */
export function resolveClaudePermissionModeFromEnv(): string {
  const raw = Deno.env.get("CLAUDE_PERMISSION_MODE")?.trim();
  if (raw === undefined || raw === "") {
    return "acceptEdits";
  }
  if (!CLAUDE_PERMISSION_MODES.has(raw)) {
    throw new Error(
      `Invalid CLAUDE_PERMISSION_MODE="${raw}". Expected one of: ${
        [...CLAUDE_PERMISSION_MODES].join(", ")
      }`,
    );
  }
  return raw;
}

/**
 * Executes the Claude Code CLI in print mode (`claude -p`) with the combined prompt file.
 * Uses the same result shape as {@link runOpenCode} and {@link runCursorAgent} for drop-in use.
 *
 * See https://docs.anthropic.com/en/docs/claude-code/headless for headless usage and
 * https://docs.anthropic.com/en/docs/claude-code/cli-usage for installation.
 *
 * **Environment**
 *
 * - `ANTHROPIC_API_KEY` — required for headless `--bare` runs and often for CI; see Anthropic docs.
 * - `CLAUDE_CODE_BARE` — set to `1` to add `--bare` (deterministic, API-key-oriented). When unset,
 *   runs like the interactive CLI: project `CLAUDE.md` and saved login apply (similar to Cursor’s `agent`).
 * - `CLAUDE_ALLOWED_TOOLS` — overrides the default `Bash,Read,Edit` passed to `--allowedTools`.
 * - `CLAUDE_PERMISSION_MODE` — passed to `--permission-mode` (default `acceptEdits` so plan/implement
 *   file edits are not blocked waiting for interactive approval; use `default` to restore Claude Code’s
 *   standard ask-first behavior).
 * - `CLAUDE_DANGEROUSLY_SKIP_PERMISSIONS` — when set to `1`, adds `--dangerously-skip-permissions` (only
 *   for isolated/sandboxed environments; see `claude --help`).
 * - `CLAUDE_TIMEOUT_MS` — phase timeout; falls back to `OPENCODE_TIMEOUT_MS`, then 10 minutes.
 *
 * @param phase - The phase to run ("plan" or "implement"); used only for log/spinner text
 * @param combinedPromptPath - Path to the combined prompt file (will be resolved to absolute)
 * @param workspaceRoot - Root directory of the workspace (cwd for the agent)
 * @param _useReadonlyConfig - Unused; Claude Code has no opencode-style plan vs implement config swap
 * @returns Promise resolving to execution result with code, stdout, and stderr
 * @throws Error if `claude` is not installed
 */
export async function runClaudeAgent(
  phase: "plan" | "implement",
  combinedPromptPath: string,
  workspaceRoot: string,
  _useReadonlyConfig?: boolean,
): Promise<OpenCodeResult> {
  try {
    await $`which claude`.quiet();
  } catch {
    throw new Error(
      "claude command not found. Install Claude Code from https://docs.anthropic.com/en/docs/claude-code/cli-usage. For default (non-bare) runs, use `claude` login; for `CLAUDE_CODE_BARE=1`, set ANTHROPIC_API_KEY per headless docs.",
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
      `${DN_PREFIX}Running Claude Code ${phase} phase with combined prompt: ${combinedPromptPath}`,
    );
  }

  const startTime = Date.now();
  const timeoutMs = parseInt(
    Deno.env.get("CLAUDE_TIMEOUT_MS") || Deno.env.get("OPENCODE_TIMEOUT_MS") ||
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
          `${DN_PREFIX}[WARN] Claude Code ${phase} phase has been running for ${
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
  const allowedTools = Deno.env.get("CLAUDE_ALLOWED_TOOLS")?.trim() ||
    DEFAULT_ALLOWED_TOOLS;
  const permissionMode = resolveClaudePermissionModeFromEnv();
  const dangerouslySkipPermissions =
    Deno.env.get("CLAUDE_DANGEROUSLY_SKIP_PERMISSIONS") === "1";
  const useBare = Deno.env.get("CLAUDE_CODE_BARE") === "1";

  const claudeCommand = useBare
    ? (dangerouslySkipPermissions
      ? $`claude --bare -p ${promptInstruction} --permission-mode ${permissionMode} --dangerously-skip-permissions --allowedTools ${allowedTools}`
      : $`claude --bare -p ${promptInstruction} --permission-mode ${permissionMode} --allowedTools ${allowedTools}`)
      .cwd(workspaceRoot)
      .noThrow()
      .stdout("piped")
      .stderr("piped")
      .stdin("null")
    : (dangerouslySkipPermissions
      ? $`claude -p ${promptInstruction} --permission-mode ${permissionMode} --dangerously-skip-permissions --allowedTools ${allowedTools}`
      : $`claude -p ${promptInstruction} --permission-mode ${permissionMode} --allowedTools ${allowedTools}`)
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
          `Claude Code ${phase} phase timed out after ${
            Math.round(timeoutMs / 1000)
          }s. Increase timeout with CLAUDE_TIMEOUT_MS or OPENCODE_TIMEOUT_MS.`,
        ),
      );
    }, timeoutMs);
  });

  const result = await Promise.race([
    claudeCommand,
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
