// Copyright 2026 Chesapeake Computing
// SPDX-License-Identifier: Apache-2.0

import { $ } from "$dax";
import { formatElapsedTime, isTty, Spinner } from "./output.ts";

/**
 * Result of an opencode execution.
 */
export interface OpenCodeResult {
  /** Exit code from opencode */
  code: number;
  /** Standard output */
  stdout: string;
  /** Standard error */
  stderr: string;
}

/**
 * Executes opencode with the specified phase and prompt file.
 * Captures both stdout and stderr.
 *
 * Note: opencode reads config from `opencode.json` in the workspace directory.
 * For plan phase, uses `opencode.plan.json`; for implement phase, uses `opencode.implement.json`.
 * The appropriate config is temporarily copied to `opencode.json` during execution.
 *
 * @param phase - The phase to run ("plan" or "implement")
 * @param combinedPromptPath - Path to the combined prompt file
 * @param workspaceRoot - Root directory of the workspace (where config files live)
 * @param useReadonlyConfig - Whether to use plan config (true) or implement config (false)
 * @returns Promise resolving to execution result with code, stdout, and stderr
 * @throws Error if opencode is not installed
 */
export async function runOpenCode(
  phase: "plan" | "implement",
  combinedPromptPath: string,
  workspaceRoot: string,
  useReadonlyConfig: boolean = false,
): Promise<OpenCodeResult> {
  // Check if opencode is available
  try {
    await $`which opencode`.quiet();
  } catch {
    throw new Error(
      "opencode command not found. Please ensure opencode is installed.",
    );
  }

  const ttyMode = isTty();

  if (!ttyMode) {
    // Non-TTY mode: log basic info, output will stream directly
    console.log(
      `Running opencode ${phase} phase with combined prompt: ${combinedPromptPath}`,
    );
  }

  const configPath = `${workspaceRoot}/opencode.json`;
  const planConfigPath = `${workspaceRoot}/opencode.plan.json`;
  const implementConfigPath = `${workspaceRoot}/opencode.implement.json`;
  const backupConfigPath = `${workspaceRoot}/opencode.json.backup`;

  // Determine which config file to use based on phase
  const sourceConfigPath = useReadonlyConfig
    ? planConfigPath
    : implementConfigPath;
  const configType = useReadonlyConfig ? "plan" : "implement";

  // Validate config files exist in workspace root
  if (useReadonlyConfig) {
    try {
      await Deno.stat(planConfigPath);
      const configContent = await Deno.readTextFile(planConfigPath);

      // Check if config allows plan files in plans/ directory
      const config = JSON.parse(configContent);
      const editPerms = config?.permission?.edit || {};
      const hasPlanFiles = editPerms["plans/**/*.plan.md"] === "allow" ||
        editPerms["plans/*.plan.md"] === "allow" ||
        editPerms["**/*.plan.md"] === "allow";

      if (!hasPlanFiles) {
        // Config exists but doesn't allow plan files - add permissions
        console.warn(
          "⚠️  Adding plan file permissions to opencode.plan.json",
        );
        editPerms["plans/**/*.plan.md"] = "allow";
        editPerms["plans/*.plan.md"] = "allow";
        editPerms["**/*.plan.md"] = "allow";
        await Deno.writeTextFile(
          planConfigPath,
          JSON.stringify(config, null, 2) + "\n",
        );
      }
    } catch {
      // Try to create a default plan config template
      try {
        const defaultPlanConfig = {
          "$schema": "https://opencode.ai/config.json",
          "permission": {
            "edit": {
              "*": "deny",
              "/tmp/**": "allow",
              "plans/**/*.plan.md": "allow",
              "plans/*.plan.md": "allow",
              "**/*.plan.md": "allow",
            },
            "bash": {
              "*": "allow",
            },
            "external_directory": "allow",
          },
        };
        await Deno.writeTextFile(
          planConfigPath,
          JSON.stringify(defaultPlanConfig, null, 2) + "\n",
        );
        console.log(
          `Created default plan config at ${planConfigPath}`,
        );
      } catch (createError) {
        throw new Error(
          `Plan config not found at ${planConfigPath} and could not be created. ` +
            `Please create opencode.plan.json in the workspace root. ` +
            `Error: ${
              createError instanceof Error
                ? createError.message
                : String(createError)
            }`,
        );
      }
    }
  } else {
    // Validate implement config exists
    try {
      await Deno.stat(implementConfigPath);
    } catch {
      throw new Error(
        `Implement config not found at ${implementConfigPath}. ` +
          `Please create opencode.implement.json in the workspace root.`,
      );
    }
  }

  // Handle config file swapping: copy phase-specific config to opencode.json temporarily
  let configSwapped = false;
  try {
    // Check if opencode.json exists (might be from previous run or user setup)
    try {
      await Deno.stat(configPath);
      // Backup original config if it exists
      await Deno.copyFile(configPath, backupConfigPath);
    } catch {
      // No original config, that's fine - we'll create one from source
    }
    // Copy phase-specific config to opencode.json
    await Deno.copyFile(sourceConfigPath, configPath);
    configSwapped = true;
  } catch (error) {
    throw new Error(
      `Failed to set config for ${configType} phase: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }

  try {
    const startTime = Date.now();

    // Configure timeout (default: 10 minutes, configurable via env var)
    const timeoutMs = parseInt(
      Deno.env.get("OPENCODE_TIMEOUT_MS") || "600000",
      10,
    );
    const timeoutWarningMs = Math.min(timeoutMs * 0.8, 600000); // Warn at 80% or 10 min, whichever is less
    const longRunWarningMs = 300000; // Warn after 5 minutes

    // Create spinner for TTY mode
    const spinner = ttyMode ? new Spinner(`Running ${phase} phase...`) : null;

    if (spinner) {
      spinner.start();
    }

    // Set up progress monitoring (only in non-TTY mode or for warnings)
    const progressInterval = setInterval(() => {
      const elapsed = Date.now() - startTime;

      // In TTY mode, update spinner message with elapsed time
      if (spinner && elapsed > 5000) {
        // Show elapsed time after 5 seconds
        spinner.setMessage(
          `Running ${phase} phase... (${formatElapsedTime(elapsed)})`,
        );
      }

      // Warn if running for a long time (might be waiting for input)
      // Only show warnings in non-TTY mode or as console warnings
      if (!ttyMode) {
        if (elapsed > longRunWarningMs && elapsed < timeoutWarningMs) {
          console.warn(
            `\n⚠️  Warning: opencode ${phase} phase has been running for ${
              Math.round(elapsed / 1000)
            }s.`,
          );
          console.warn(
            `   If it appears to hang, it may be waiting for user input. Check stderr for prompts.\n`,
          );
        }

        // Warn approaching timeout
        if (elapsed > timeoutWarningMs) {
          const remaining = Math.round((timeoutMs - elapsed) / 1000);
          console.warn(
            `\n⚠️  Warning: Approaching timeout (${remaining}s remaining). Consider checking if opencode is waiting for input.\n`,
          );
        }
      }
    }, 30000); // Check every 30 seconds

    // Run opencode with timeout and stdin disabled to prevent hanging on prompts
    // Using stdin("null") prevents opencode from waiting for user input
    const opencodeCommand =
      $`opencode run ${phase} -f ${combinedPromptPath} --log-level=DEBUG`
        .cwd(workspaceRoot)
        .noThrow()
        .stdout("piped")
        .stderr("piped")
        .stdin("null"); // Prevent waiting for stdin input

    // Set up timeout
    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => {
        if (spinner) {
          spinner.stop();
        }
        clearInterval(progressInterval);
        reject(
          new Error(
            `opencode ${phase} phase timed out after ${
              Math.round(timeoutMs / 1000)
            }s. ` +
              `This may indicate it's waiting for user input. ` +
              `Check stderr output for prompts. ` +
              `You can increase timeout with OPENCODE_TIMEOUT_MS environment variable.`,
          ),
        );
      }, timeoutMs);
    });

    // Race between execution and timeout
    const result = await Promise.race([
      opencodeCommand,
      timeoutPromise,
    ]).finally(() => {
      if (spinner) {
        spinner.stop();
      }
      clearInterval(progressInterval);
    });

    // Calculate elapsed time
    const elapsed = Date.now() - startTime;

    // Check stderr for common prompt patterns that indicate waiting for input
    const stderrContent = result.stderr || "";
    const promptPatterns = [
      /(?:enter|input|prompt|confirm|yes\/no|y\/n|press|waiting|select|choose)/i,
      /\?[\s]*$/m, // Lines ending with question mark
    ];

    const hasPromptIndicators = promptPatterns.some((pattern) =>
      pattern.test(stderrContent)
    );

    if (hasPromptIndicators && result.code !== 0) {
      console.warn(
        "\n⚠️  Warning: stderr contains text that suggests opencode may have been waiting for input.",
      );
      console.warn(
        "   This can cause hangs in headless mode. Consider configuring opencode to run non-interactively.\n",
      );
    }

    // Display output based on TTY mode
    const exitCode = result.code ?? 0;
    if (ttyMode) {
      // TTY mode: Show elapsed time, then display captured output
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
      console.log(""); // Blank line for readability

      if (result.stdout) {
        console.log(result.stdout);
      }
      if (result.stderr) {
        console.error(result.stderr);
      }
    } else {
      // Non-TTY mode: Stream output directly (already captured, just display it)
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
  } finally {
    // Restore original config if we swapped it
    if (configSwapped) {
      try {
        // Restore from backup if it exists (original opencode.json)
        try {
          await Deno.stat(backupConfigPath);
          await Deno.copyFile(backupConfigPath, configPath);
          await Deno.remove(backupConfigPath);
        } catch {
          // No backup existed, remove the swapped config (it was created from source)
          await Deno.remove(configPath);
        }
      } catch (error) {
        console.error(
          `Warning: Failed to restore opencode.json config: ${error}`,
        );
      }
    }
  }
}
