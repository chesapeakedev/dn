// Copyright 2026 Chesapeake Computing
// SPDX-License-Identifier: Apache-2.0

/**
 * dn loop subcommand handler
 *
 * Runs only the loop phase (Steps 4-7: implement, completion, lint, artifacts, validate)
 */

import type { KickstartConfig, LoopPhaseResult } from "../kickstart/lib.ts";
import { runLoopPhase } from "../kickstart/lib.ts";
import { getCurrentRepoFromRemote } from "../sdk/github/github-gql.ts";
import { fetchIssueFromUrl } from "../sdk/github/issue.ts";
import type { IssueData } from "../sdk/github/issue.ts";
import { promptAndAddToTodoList } from "../sdk/todo/todo.ts";
import { resolveAgentHarnessFromFlagsAndEnv } from "../sdk/github/agentHarness.ts";

/**
 * Discovers the most recently modified plan file in the plans/ directory.
 * Returns the path if exactly one exists, prompts if multiple, or null if none.
 */
async function discoverLatestPlanFile(
  workspaceRoot: string,
): Promise<string | null> {
  const plansDir = `${workspaceRoot}/plans`;
  try {
    const entries = await Deno.readDir(plansDir);
    const planFiles: { name: string; mtime: Date }[] = [];
    for await (const entry of entries) {
      if (entry.isFile && entry.name.endsWith(".plan.md")) {
        const stat = await Deno.stat(`${plansDir}/${entry.name}`);
        if (stat.mtime) {
          planFiles.push({ name: entry.name, mtime: stat.mtime });
        }
      }
    }

    if (planFiles.length === 0) {
      return null;
    }

    if (planFiles.length === 1) {
      return `${plansDir}/${planFiles[0].name}`;
    }

    // Multiple plan files - pick the most recently modified
    planFiles.sort((a, b) => b.mtime.getTime() - a.mtime.getTime());
    const latest = planFiles[0];
    console.log(
      `Found ${planFiles.length} plan files, using most recent: ${latest.name}`,
    );
    return `${plansDir}/${latest.name}`;
  } catch {
    return null;
  }
}

/**
 * Parses loop-specific arguments
 */
function parseArgs(
  args: string[],
): KickstartConfig & { planFilePath: string | null } {
  let planFilePath: string | null = null;
  let cursorFlag = false;
  let claudeFlag = false;
  let workspaceRoot: string | undefined = undefined;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--plan-file" && i + 1 < args.length) {
      planFilePath = args[++i];
    } else if (arg === "--cursor" || arg === "-c") {
      cursorFlag = true;
    } else if (arg === "--claude") {
      claudeFlag = true;
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

  const agentHarness = resolveAgentHarnessFromFlagsAndEnv({
    cursorFlag,
    claudeFlag,
  });

  return {
    awp: false, // Loop phase doesn't use AWP mode
    agentHarness,
    allowCrossRepo: false,
    issueUrl: null,
    saveCtx: false,
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
  console.log("  dn loop [options] [--plan-file <path>]\n");
  console.log("Options:");
  console.log(
    "  --plan-file <path>       Path to plan file (auto-discovers latest if omitted)",
  );
  console.log("  --cursor, -c             Use Cursor headless agent");
  console.log("  --claude                 Use Claude Code CLI");
  console.log("  --workspace-root <path>  Workspace root directory");
  console.log("  --help, -h               Show this help message\n");
  console.log("Environment variables:");
  console.log("  WORKSPACE_ROOT           Workspace root directory");
  console.log(
    "  PLAN                     Path to plan file (alternative to --plan-file)",
  );
  console.log(
    "  CURSOR_ENABLED           Set to '1' to use Cursor agent",
  );
  console.log(
    "  CLAUDE_ENABLED           Set to '1' to use Claude Code (not with CURSOR_ENABLED)\n",
  );
  console.log("Examples:");
  console.log("  # Run loop phase (auto-discovers latest plan)");
  console.log("  dn loop");
  console.log("");
  console.log("  # Run loop phase with explicit plan file");
  console.log("  dn loop --plan-file plans/my-feature.plan.md");
  console.log("");
  console.log("  # Full workflow: prep then loop");
  console.log("  dn prep --issue-url <url> --plan-name my-feature");
  console.log("  dn loop");
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
  let config: KickstartConfig & { planFilePath: string | null };
  try {
    config = parseArgs(args);
  } catch (e) {
    console.error(e instanceof Error ? e.message : String(e));
    Deno.exit(1);
  }

  // Auto-discover plan file if not explicitly provided
  if (!config.planFilePath) {
    const root = config.workspaceRoot || Deno.env.get("WORKSPACE_ROOT") ||
      Deno.cwd();
    const discovered = await discoverLatestPlanFile(root);
    if (!discovered) {
      console.error(
        "Error: No plan files found in plans/ directory.",
      );
      console.error("Run 'dn prep' first to create a plan file.");
      console.error("\nUse 'dn loop --help' for usage information.");
      Deno.exit(1);
    }
    config.planFilePath = discovered;
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

    let title: string | undefined;
    try {
      const planContent = await Deno.readTextFile(config.planFilePath);
      const titleMatch = planContent.match(/^#\s+(.+)$/m);
      title = titleMatch ? titleMatch[1].trim() : undefined;
    } catch {
      title = undefined;
    }
    const repo = await getCurrentRepoFromRemote().then(
      (r) => `${r.owner}/${r.repo}`,
    ).catch(() => undefined);
    await promptAndAddToTodoList(
      [{ ref: config.planFilePath, title }],
      {
        repo,
        updated: new Date().toISOString().slice(0, 10),
      },
    );

    Deno.exit(0);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    Deno.exit(1);
  }
}
