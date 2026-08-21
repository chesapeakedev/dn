// Copyright 2026 Chesapeake Computing
// SPDX-License-Identifier: Apache-2.0

/**
 * dn land subcommand handler
 *
 * Close out local agentic work into durable VCS state: optional GitHub issue
 * test-plan upsert, then logical commits from plan context (or --single).
 */

import type { AgentHarness } from "../sdk/github/agentHarness.ts";
import { resolveLocalAgentHarness } from "../sdk/config/localAgent.ts";
import {
  discoverPlanFile,
  discoverRfcForLand,
  discoverTestPlanFile,
} from "../sdk/land/discover.ts";
import { runLandRfcComplete } from "../sdk/land/rfcComplete.ts";
import { runLandPhase } from "../sdk/land/run.ts";
import { runLandSingle } from "../sdk/land/single.ts";
import { runIssueTestPlanFromPlan } from "../sdk/testplan/run.ts";
import { resolveContextFileArgs } from "./contextFiles.ts";

interface LandArgs {
  planFilePath?: string;
  testPlanPath?: string;
  issueTestPlan: boolean;
  single: boolean;
  dryRun: boolean;
  workspaceRoot?: string;
  agentHarness: AgentHarness;
  contextFiles: string[];
}

async function parseArgs(
  args: string[],
  globalAgent: AgentHarness | null,
  globalContextFiles: readonly string[] = [],
): Promise<LandArgs> {
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

  const { contextFiles, rest: flagArgs } = resolveContextFileArgs(
    args,
    globalContextFiles,
  );

  for (let i = 0; i < flagArgs.length; i++) {
    const arg = flagArgs[i];
    if (arg === "--single") {
      single = true;
    } else if (arg === "--dry-run") {
      dryRun = true;
    } else if (arg === "--issue-testplan") {
      issueTestPlan = true;
    } else if (arg === "--test-plan") {
      testPlanPath = flagArgs[++i];
    } else if (arg === "--workspace-root") {
      workspaceRoot = flagArgs[++i];
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

  const agentHarness = await resolveLocalAgentHarness({
    repoRoot: workspaceRoot ?? Deno.cwd(),
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
    contextFiles,
  };
}

function showHelp(): void {
  console.log(
    "dn land - Close out completed work into durable VCS commits\n",
  );
  console.log("Usage:");
  console.log("  dn land [options] [plan_file.plan.md | rfc-path-or-ref]\n");
  console.log("Options:");
  console.log(
    "  --single     One deterministic commit (no agent); requires a plan path",
  );
  console.log(
    "               (not valid for RFC paths — use RFC land without --single)",
  );
  console.log(
    "               Message from plan H1/name + truncated overview/body (~200 chars)",
  );
  console.log(
    "  --dry-run    Preview without committing, deleting plans, or updating issues",
  );
  console.log(
    "               RFC land: preview status/state/commit without writing",
  );
  console.log(
    "  --issue-testplan  Upsert ## Test Plan onto the linked GitHub issue before commit",
  );
  console.log(
    "               Attended runs with EDITOR set review the upserted body before posting",
  );
  console.log(
    "  --test-plan <path>  Optional local test plan file for commit-agent context",
  );
  console.log(
    "  --workspace-root <path>  Run land from an explicit workspace root",
  );
  console.log(
    "  --context-file <path>  Include a file in test-plan agent context (repeatable; also a global flag)",
  );
  console.log("  --help, -h   Show this help\n");
  console.log("Examples:");
  console.log("  dn land");
  console.log("  dn land plans/my-feature.plan.md");
  console.log("  dn land rfcs/012-session-persistence.md");
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
  contextFiles: readonly string[] = [],
): Promise<void> {
  const planContent = await Deno.readTextFile(planFilePath);
  const result = await runIssueTestPlanFromPlan({
    planContent,
    planFilePath,
    workspaceRoot,
    agentHarness,
    dryRun,
    contextFiles,
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
  globalContextFiles: readonly string[] = [],
): Promise<void> {
  let config: LandArgs;
  try {
    config = await parseArgs(args, globalAgent, globalContextFiles);
  } catch (e) {
    console.error(e instanceof Error ? e.message : String(e));
    Deno.exit(1);
  }

  applyWorkspaceRoot(config.workspaceRoot);
  const workspaceRoot = Deno.cwd();

  try {
    if (config.planFilePath) {
      const rfc = await discoverRfcForLand(config.planFilePath, {
        repoRoot: workspaceRoot,
      });
      if (rfc) {
        if (config.single) {
          console.error(
            "Error: --single applies to execution plans only, not RFC paths.",
          );
          console.error("\nUse 'dn land --help' for usage information.");
          Deno.exit(1);
        }
        if (config.issueTestPlan) {
          console.error(
            "Error: --issue-testplan applies to execution plans only, not RFC paths.",
          );
          console.error("\nUse 'dn land --help' for usage information.");
          Deno.exit(1);
        }
        await runLandRfcComplete({
          ref: config.planFilePath,
          workspaceRoot,
          dryRun: config.dryRun,
        });
        Deno.exit(0);
      }
    }

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
          config.contextFiles,
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
        config.contextFiles,
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
