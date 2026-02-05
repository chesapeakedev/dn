// Copyright 2026 Chesapeake Computing
// SPDX-License-Identifier: Apache-2.0

/**
 * dn loop subcommand handler
 *
 * Runs only the loop phase (Steps 4-7: implement, completion, lint, artifacts, validate)
 */

import type { KickstartConfig, LoopPhaseResult } from "../kickstart/lib.ts";
import { runLoopPhase } from "../kickstart/lib.ts";
import { fetchIssueFromUrl } from "../sdk/github/issue.ts";
import type { IssueData } from "../sdk/github/issue.ts";

/**
 * Parses loop-specific arguments
 */
function parseArgs(
  args: string[],
): KickstartConfig & { planFilePath: string | null } {
  let planFilePath: string | null = null;
  let cursorEnabled = false;
  let workspaceRoot: string | undefined = undefined;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--plan-file" && i + 1 < args.length) {
      planFilePath = args[++i];
    } else if (arg === "--cursor" || arg === "-c") {
      cursorEnabled = true;
    } else if (arg === "--workspace-root" && i + 1 < args.length) {
      workspaceRoot = args[++i];
    } else if (arg === "--help" || arg === "-h") {
      showHelp();
      Deno.exit(0);
    }
  }

  // Fallback to environment variables
  if (!planFilePath) {
    planFilePath = Deno.env.get("PLAN") || null;
  }

  if (!cursorEnabled) {
    cursorEnabled = Deno.env.get("CURSOR_ENABLED") === "1";
  }

  return {
    awp: false, // Loop phase doesn't use AWP mode
    cursorEnabled,
    issueUrl: null,
    saveCtx: false,
    savePlan: false,
    savedPlanName: null,
    workspaceRoot,
    planFilePath,
  };
}

/**
 * Shows help for loop subcommand
 */
function showHelp(): void {
  console.log("dn loop - Run loop phase only\n");
  console.log("Usage:");
  console.log("  dn loop [options] --plan-file <path>\n");
  console.log("Options:");
  console.log(
    "  --plan-file <path>       Path to plan file (required, from 'dn prep')",
  );
  console.log("  --cursor, -c             Enable Cursor IDE integration");
  console.log("  --workspace-root <path>  Workspace root directory");
  console.log("  --help, -h               Show this help message\n");
  console.log("Environment variables:");
  console.log("  WORKSPACE_ROOT           Workspace root directory");
  console.log(
    "  PLAN                     Path to plan file (alternative to --plan-file)",
  );
  console.log(
    "  CURSOR_ENABLED           Set to '1' to enable Cursor integration\n",
  );
  console.log("Examples:");
  console.log("  # Run loop phase with a plan file from prep");
  console.log("  dn loop --plan-file plans/my-feature.plan.md");
  console.log("");
  console.log("  # Full workflow: prep then loop");
  console.log("  dn prep --issue-url <url> --plan-name my-feature");
  console.log("  dn loop --plan-file plans/my-feature.plan.md");
  console.log("");
  console.log(
    "  # Run loop with a continuation plan (after naming incomplete work)",
  );
  console.log("  dn loop --plan-file plans/my-feature.plan.md");
}

/**
 * Reads plan file to extract issue context if available
 */
async function extractIssueContextFromPlan(
  planFilePath: string,
): Promise<{ issueData: IssueData | null }> {
  try {
    const planContent = await Deno.readTextFile(planFilePath);

    // Try to extract issue URL from plan content
    const issueUrlMatch = planContent.match(
      /https:\/\/github\.com\/([^\/]+)\/([^\/]+)\/issues\/(\d+)/,
    );
    if (issueUrlMatch) {
      const [, owner, repo, number] = issueUrlMatch;
      const issueUrl = `https://github.com/${owner}/${repo}/issues/${number}`;
      try {
        const issueData = await fetchIssueFromUrl(issueUrl);
        return { issueData };
      } catch {
        // If fetch fails, continue without issue data
      }
    }
  } catch {
    // If reading plan fails, continue without issue data
  }

  return { issueData: null };
}

/**
 * Handles the loop subcommand
 */
export async function handleLoop(args: string[]): Promise<void> {
  const config = parseArgs(args);

  if (!config.planFilePath) {
    console.error(
      "Error: Either provide --plan-file or set PLAN environment variable",
    );
    console.error("\nUse 'dn loop --help' for usage information.");
    Deno.exit(1);
  }

  // Verify plan file exists
  try {
    await Deno.stat(config.planFilePath);
  } catch {
    console.error(`Error: Plan file not found: ${config.planFilePath}`);
    Deno.exit(1);
  }

  try {
    // Extract issue context from plan file if possible
    const { issueData } = await extractIssueContextFromPlan(
      config.planFilePath,
    );

    // Create a temp directory for this run
    // FIXME: replace geo-opencode with dn-{mode id}
    const tmpDir = await Deno.makeTempDir({ prefix: "geo-opencode-" });
    const planOutputPath = `${tmpDir}/plan_output.txt`;

    // Read plan file content to use as plan output
    const planContent = await Deno.readTextFile(config.planFilePath);
    await Deno.writeTextFile(planOutputPath, planContent);

    const result: LoopPhaseResult = await runLoopPhase(
      config,
      config.planFilePath,
      planOutputPath,
      issueData,
      tmpDir,
    );

    if (result.continuationPromptPath) {
      console.log(`\nContinuation prompt: ${result.continuationPromptPath}`);
    }

    Deno.exit(0);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    Deno.exit(1);
  }
}
