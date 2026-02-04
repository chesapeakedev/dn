// Copyright 2026 Chesapeake Computing
// SPDX-License-Identifier: Apache-2.0

/**
 * dn kickstart subcommand handler
 *
 * Runs the full kickstart workflow (plan + implement phases)
 */

import type { KickstartConfig } from "../kickstart/lib.ts";
import { runFullKickstart } from "../kickstart/lib.ts";

/**
 * Parses kickstart-specific arguments
 */
function parseArgs(
  args: string[],
): KickstartConfig & { issueUrl: string | null } {
  let awp = false;
  let cursorEnabled = false;
  let issueUrl: string | null = null;
  let savePlan = false;
  let savedPlanName: string | null = null;
  let workspaceRoot: string | undefined = undefined;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--awp") {
      awp = true;
    } else if (arg === "--cursor" || arg === "-c") {
      cursorEnabled = true;
    } else if (arg === "--save-plan") {
      savePlan = true;
    } else if (arg === "--saved-plan" && i + 1 < args.length) {
      savedPlanName = args[++i];
    } else if (arg === "--workspace-root" && i + 1 < args.length) {
      workspaceRoot = args[++i];
    } else if (arg === "--help" || arg === "-h") {
      showHelp();
      Deno.exit(0);
    } else if (!arg.startsWith("--") && !issueUrl) {
      issueUrl = arg;
    }
  }

  // Fallback to environment variable for issue URL
  if (!issueUrl) {
    issueUrl = Deno.env.get("ISSUE") || null;
  }

  if (!cursorEnabled) {
    cursorEnabled = Deno.env.get("CURSOR_ENABLED") === "1";
  }

  const saveCtx = Deno.env.get("SAVE_CTX") === "1";

  return {
    awp,
    cursorEnabled,
    issueUrl,
    saveCtx,
    savePlan,
    savedPlanName,
    workspaceRoot,
  };
}

/**
 * Shows help for kickstart subcommand
 */
function showHelp(): void {
  console.log("dn kickstart - Run full kickstart workflow\n");
  console.log("Usage:");
  console.log(
    "  dn kickstart [options] <issue_url_or_number>\n",
  );
  console.log("Options:");
  console.log(
    "  --awp                    Enable AWP mode (branches, commits, PRs)",
  );
  console.log("  --cursor, -c              Enable Cursor IDE integration");
  console.log("  --save-plan              Force a named plan to be saved");
  console.log("  --saved-plan <name>      Use a specific plan name");
  console.log("  --workspace-root <path>  Workspace root directory");
  console.log("  --help, -h               Show this help message\n");
  console.log("Environment variables:");
  console.log("  WORKSPACE_ROOT           Workspace root directory");
  console.log(
    "  ISSUE                    GitHub issue URL or issue number (alternative to positional arg)",
  );
  console.log("  SAVE_CTX                 Set to '1' to preserve debug files");
  console.log(
    "  CURSOR_ENABLED           Set to '1' to enable Cursor integration\n",
  );
  console.log("Examples:");
  console.log("  dn kickstart https://github.com/owner/repo/issues/123");
  console.log("  dn kickstart 123");
  console.log("  dn kickstart --awp --cursor <issue_url_or_number>");
  console.log("  ISSUE=<issue_url_or_number> dn kickstart");
}

/**
 * Handles the kickstart subcommand
 */
export async function handleKickstart(args: string[]): Promise<void> {
  const config = parseArgs(args);

  if (!config.issueUrl) {
    console.error(
      "Error: Either provide an issue URL as argument or set ISSUE environment variable",
    );
    console.error("\nUse 'dn kickstart --help' for usage information.");
    Deno.exit(1);
  }

  try {
    await runFullKickstart(config);
    Deno.exit(0);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    Deno.exit(1);
  }
}
