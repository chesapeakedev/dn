// Copyright 2026 Chesapeake Computing
// SPDX-License-Identifier: Apache-2.0

/**
 * `dn workflow` — GitHub Actions workflow commands (gh workflow parity).
 *
 * Distinct from `dn workflows`, which manages canonical template installation.
 */

import { handleWorkflowRun } from "./workflow/run.ts";

function showHelp(): void {
  console.log("dn workflow - Run GitHub Actions workflows\n");
  console.log("Usage:");
  console.log("  dn workflow <subcommand> [options]\n");
  console.log("Subcommands:");
  console.log("  run       Create a workflow_dispatch event for a workflow\n");
  console.log("Examples:");
  console.log("  dn workflow run release.yml");
  console.log("  dn workflow run triage.yml --ref main -f name=value\n");
  console.log("See also:");
  console.log(
    "  dn workflows   Install and validate canonical dn workflow templates",
  );
}

/**
 * Handle `dn workflow` subcommands.
 */
export async function handleWorkflow(args: string[]): Promise<void> {
  if (args.length === 0 || args[0] === "--help" || args[0] === "-h") {
    showHelp();
    return;
  }

  const subcommand = args[0];
  const subArgs = args.slice(1);

  try {
    switch (subcommand) {
      case "run":
        await handleWorkflowRun(subArgs);
        break;
      default:
        console.error(`Unknown workflow subcommand: ${subcommand}\n`);
        showHelp();
        Deno.exit(1);
    }
  } catch (error) {
    console.error(
      `Error: ${error instanceof Error ? error.message : String(error)}`,
    );
    Deno.exit(1);
  }
}
