// Copyright 2026 Chesapeake Computing
// SPDX-License-Identifier: Apache-2.0

/**
 * dn release — Manage GitHub releases.
 *
 * Subcommands:
 *   dn release create   Create a new release
 */

import { handleCreate } from "./release/create.ts";

/**
 * Show usage for the release subcommand.
 */
function showHelp(): void {
  console.error("dn release - Manage GitHub releases\n");
  console.error("Usage:");
  console.error("  dn release <subcommand> [options]\n");
  console.error("Subcommands:");
  console.error("  create    Create a new release\n");
  console.error(
    "Use 'dn release <subcommand> --help' for subcommand-specific options.",
  );
}

/**
 * Main handler for the release subcommand.
 */
export async function handleRelease(args: string[]): Promise<void> {
  if (args.length === 0 || args[0] === "--help" || args[0] === "-h") {
    showHelp();
    return;
  }

  const subcommand = args[0];
  const subArgs = args.slice(1);

  try {
    switch (subcommand) {
      case "create":
      case "new":
        await handleCreate(subArgs);
        break;
      default:
        console.error(`Unknown subcommand: ${subcommand}\n`);
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
