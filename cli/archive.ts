// Copyright 2026 Chesapeake Computing
// SPDX-License-Identifier: Apache-2.0

/**
 * dn archive subcommand handler
 *
 * Reads a plan file, produces a commit message, deletes the plan file, and
 * commits the current workspace. With --dry-run, only prints the commit message.
 */

import { commitWorkspace, deriveCommitMessage } from "../sdk/mod.ts";

interface ArchiveArgs {
  planFilePath: string;
  dryRun: boolean;
  workspaceRoot?: string;
}

function parseArgs(args: string[]): ArchiveArgs {
  let planFilePath: string | null = null;
  let dryRun = false;
  let workspaceRoot: string | undefined;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--dry-run") {
      dryRun = true;
    } else if (arg === "--workspace-root") {
      workspaceRoot = args[++i];
    } else if (arg === "--help" || arg === "-h") {
      showHelp();
      Deno.exit(0);
    } else if (!arg.startsWith("--") && !planFilePath) {
      planFilePath = arg;
    }
  }

  return {
    planFilePath: planFilePath ?? "",
    dryRun,
    workspaceRoot,
  };
}

function showHelp(): void {
  console.log(
    "dn archive - Commit current workspace using a plan-derived message\n",
  );
  console.log("Usage:");
  console.log("  dn archive [options] <plan_file.plan.md>\n");
  console.log("Options:");
  console.log(
    "  --dry-run  Print the derived commit message without committing or deleting the plan file",
  );
  console.log(
    "  --workspace-root <path>  Run archive from an explicit workspace root",
  );
  console.log("  --help, -h  Show this help\n");
  console.log("Examples:");
  console.log("  dn archive plans/my-feature.plan.md");
  console.log("  dn archive plans/my-feature.plan.md --dry-run");
}

export async function handleArchive(args: string[]): Promise<void> {
  const { planFilePath, dryRun, workspaceRoot } = parseArgs(args);

  if (!planFilePath) {
    console.error("Error: Plan file path required.");
    console.error("\nUse 'dn archive --help' for usage information.");
    Deno.exit(1);
  }

  if (workspaceRoot) {
    try {
      Deno.chdir(workspaceRoot);
    } catch (e) {
      console.error(`Error: Cannot use workspace root: ${workspaceRoot}`);
      console.error(e instanceof Error ? e.message : String(e));
      Deno.exit(1);
    }
  }

  let planContent: string;
  try {
    planContent = await Deno.readTextFile(planFilePath);
  } catch (e) {
    console.error(`Error: Cannot read plan file: ${planFilePath}`);
    console.error(e instanceof Error ? e.message : String(e));
    Deno.exit(1);
  }

  const message = deriveCommitMessage(planContent, planFilePath);
  const fullMessage = message.body
    ? `${message.summary}\n\n${message.body}`
    : message.summary;
  console.log(fullMessage);

  if (dryRun) {
    Deno.exit(0);
  }

  let removedPlan = false;
  try {
    await Deno.remove(planFilePath);
    removedPlan = true;
    await commitWorkspace(message);
  } catch (e) {
    if (removedPlan) {
      try {
        await Deno.writeTextFile(planFilePath, planContent);
      } catch (restoreError) {
        console.error(
          `Warning: Could not restore plan file after archive failure: ${planFilePath}`,
        );
        console.error(
          restoreError instanceof Error
            ? restoreError.message
            : String(restoreError),
        );
      }
    }
    console.error(
      "Error archiving:",
      e instanceof Error ? e.message : String(e),
    );
    Deno.exit(1);
  }
  Deno.exit(0);
}
