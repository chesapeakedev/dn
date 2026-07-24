// Copyright 2026 Chesapeake Computing
// SPDX-License-Identifier: Apache-2.0

/**
 * dn land subcommand handler
 *
 * Close out local agentic work into durable VCS state: optional GitHub issue
 * test-plan upsert, then logical commits from plan context (or --single).
 */

import type { AgentHarness } from "../sdk/github/agentHarness.ts";
import {
  resolveAgentHarnessFromFlagsAndEnv,
} from "../sdk/github/agentHarness.ts";
import {
  discoverPlanFile,
  discoverTestPlanFile,
} from "../sdk/land/discover.ts";
import { runLandPhase } from "../sdk/land/run.ts";
import { runLandSingle } from "../sdk/land/single.ts";
import { runIssueTestPlanFromPlan } from "../sdk/testplan/run.ts";

interface LandArgs {
  planFilePath?: string;
  testPlanPath?: string;
  issueTestPlan: boolean;
  single: boolean;
  dryRun: boolean;
  workspaceRoot?: string;
  agentHarness: AgentHarness;
}

function parseArgs(
  args: string[],
  globalAgent: AgentHarness | null,
): LandArgs {
  let planFilePath: string | undefined;
  let testPlanPath: string | undefined;
  let issueTestPlan = false;
  let single = false;
  let dryRun = false;
  let workspaceRoot: string | undefined;
  let cursorFlag = false;
  let claudeFlag = false;
  let codexFlag = false;
  let copilotFlag = false;
  let opencodeFlag = false;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--single") {
      single = true;
    } else if (arg === "--dry-run") {
      dryRun = true;
    } else if (arg === "--issue-testplan") {
      issueTestPlan = true;
    } else if (arg === "--test-plan") {
      testPlanPath = args[++i];
    } else if (arg === "--workspace-root") {
      workspaceRoot = args[++i];
    } else if (arg === "--cursor" || arg === "-c") {
      cursorFlag = true;
    } else if (arg === "--claude") {
      claudeFlag = true;
    } else if (arg === "--codex") {
      codexFlag = true;
    } else if (arg === "--copilot") {
      copilotFlag = true;
    } else if (arg === "--opencode") {
      opencodeFlag = true;
    } else if (arg === "--help" || arg === "-h") {
      showHelp();
      Deno.exit(0);
    } else if (!arg.startsWith("--") && !planFilePath) {
      planFilePath = arg;
    } else if (arg.startsWith("--")) {
      throw new Error(`Unknown land option: ${arg}`);
    }
  }

  const agentHarness = resolveAgentHarnessFromFlagsAndEnv({
    agent: globalAgent,
    cursorFlag,
    claudeFlag,
    codexFlag,
    copilotFlag,
    opencodeFlag,
  });

  return {
    planFilePath,
    testPlanPath,
    issueTestPlan,
    single,
    dryRun,
    workspaceRoot,
    agentHarness,
  };
}

function showHelp(): void {
  console.log(
    "dn land - Close out completed work into durable VCS commits\n",
  );
  console.log("Usage:");
  console.log("  dn land [options] [plan_file.plan.md]\n");
  console.log("Options:");
  console.log(
    "  --single     One deterministic commit (no agent); requires plan path",
  );
  console.log(
    "  --dry-run    Preview without committing, deleting plans, or updating issues",
  );
  console.log(
    "  --issue-testplan  Upsert ## Test Plan onto the linked GitHub issue before commit",
  );
  console.log(
    "  --test-plan <path>  Optional local test plan file for commit-agent context",
  );
  console.log(
    "  --workspace-root <path>  Run land from an explicit workspace root",
  );
  console.log("  --help, -h   Show this help\n");
  console.log("Examples:");
  console.log("  dn land");
  console.log("  dn land plans/my-feature.plan.md");
  console.log("  dn land --issue-testplan");
  console.log("  dn land --single plans/my-feature.plan.md");
  console.log("  dn land plans/my-feature.plan.md --dry-run");
}

function applyWorkspaceRoot(workspaceRoot?: string): void {
  if (!workspaceRoot) return;
  try {
    Deno.chdir(workspaceRoot);
  } catch (e) {
    console.error(`Error: Cannot use workspace root: ${workspaceRoot}`);
    console.error(e instanceof Error ? e.message : String(e));
    Deno.exit(1);
  }
}

async function maybeRunIssueTestPlan(
  planFilePath: string,
  workspaceRoot: string,
  agentHarness: AgentHarness,
  dryRun: boolean,
): Promise<void> {
  const planContent = await Deno.readTextFile(planFilePath);
  const result = await runIssueTestPlanFromPlan({
    planContent,
    planFilePath,
    workspaceRoot,
    agentHarness,
    dryRun,
  });

  if (dryRun) {
    console.log(result.section.trimEnd());
    console.log(`(dry-run) Would update GitHub issue: ${result.issueUrl}`);
    return;
  }

  console.log(`Updated GitHub issue: ${result.issueUrl}`);
}

export async function handleLand(
  args: string[],
  globalAgent: AgentHarness | null = null,
): Promise<void> {
  let config: LandArgs;
  try {
    config = parseArgs(args, globalAgent);
  } catch (e) {
    console.error(e instanceof Error ? e.message : String(e));
    Deno.exit(1);
  }

  applyWorkspaceRoot(config.workspaceRoot);
  const workspaceRoot = Deno.cwd();

  try {
    if (config.single) {
      if (!config.planFilePath) {
        console.error("Error: Plan file path required with --single.");
        console.error("\nUse 'dn land --help' for usage information.");
        Deno.exit(1);
      }
      if (config.issueTestPlan) {
        await maybeRunIssueTestPlan(
          config.planFilePath,
          workspaceRoot,
          config.agentHarness,
          config.dryRun,
        );
      }
      await runLandSingle(config.planFilePath, config.dryRun);
      Deno.exit(0);
    }

    const planFilePath = await discoverPlanFile(config.planFilePath);
    if (config.issueTestPlan) {
      await maybeRunIssueTestPlan(
        planFilePath,
        workspaceRoot,
        config.agentHarness,
        config.dryRun,
      );
    }

    const testPlanPath = await discoverTestPlanFile(
      planFilePath,
      config.testPlanPath,
    );

    await runLandPhase({
      planFilePath,
      testPlanPath,
      workspaceRoot,
      agentHarness: config.agentHarness,
      dryRun: config.dryRun,
    });
    Deno.exit(0);
  } catch (e) {
    console.error(
      "Error landing:",
      e instanceof Error ? e.message : String(e),
    );
    Deno.exit(1);
  }
}
