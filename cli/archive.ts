// Copyright 2026 Chesapeake Computing
// SPDX-License-Identifier: Apache-2.0

/**
 * dn archive subcommand handler
 *
 * Reads a plan file and produces a commit message (stdout).
 * With --yolo: commits staged files with that message, then deletes the plan file.
 */

import { commitStaged, deriveCommitMessage } from "../sdk/archive/mod.ts";

interface ArchiveArgs {
  planFilePath: string;
  yolo: boolean;
}

function parseArgs(args: string[]): ArchiveArgs {
  let planFilePath: string | null = null;
  let yolo = false;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--yolo") {
      yolo = true;
    } else if (arg === "--help" || arg === "-h") {
      showHelp();
      Deno.exit(0);
    } else if (!arg.startsWith("--") && !planFilePath) {
      planFilePath = arg;
    }
  }

  return {
    planFilePath: planFilePath ?? "",
    yolo,
  };
}

function showHelp(): void {
  console.log("dn archive - Derive commit message from a plan file\n");
  console.log("Usage:");
  console.log("  dn archive [options] <plan_file.plan.md>\n");
  console.log("Options:");
  console.log(
    "  --yolo    Create commit from staged files with derived message, then delete the plan file",
  );
  console.log("  --help, -h  Show this help\n");
  console.log("Examples:");
  console.log("  dn archive plans/my-feature.plan.md");
  console.log("  dn archive 183-kickstart-runners.plan.md --yolo");
}

export async function handleArchive(args: string[]): Promise<void> {
  const { planFilePath, yolo } = parseArgs(args);

  if (!planFilePath) {
    console.error("Error: Plan file path required.");
    console.error("\nUse 'dn archive --help' for usage information.");
    Deno.exit(1);
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

  if (yolo) {
    try {
      await commitStaged(message);
    } catch (e) {
      console.error(
        "Error committing:",
        e instanceof Error ? e.message : String(e),
      );
      Deno.exit(1);
    }
    try {
      await Deno.remove(planFilePath);
    } catch (e) {
      console.error(
        `Warning: Commit succeeded but could not delete plan file: ${planFilePath}`,
      );
      console.error(e instanceof Error ? e.message : String(e));
      Deno.exit(1);
    }
  }
  Deno.exit(0);
}
