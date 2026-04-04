// Copyright 2026 Chesapeake Computing
// SPDX-License-Identifier: Apache-2.0

/**
 * dn release — Manage GitHub releases.
 *
 * Subcommands:
 *   dn release create   Create a new release
 *   dn release list     List releases
 *   dn release view     View release details
 *   dn release edit     Edit a release
 *   dn release delete   Delete a release
 */

import { handleCreate } from "./release/create.ts";
import { handleDelete } from "./release/delete.ts";
import { handleEdit } from "./release/edit.ts";
import { handleList } from "./release/list.ts";
import { handleView } from "./release/view.ts";

/**
 * Show usage for the release subcommand.
 */
function showHelp(): void {
  console.error("dn release - Manage GitHub releases\n");
  console.error("Usage:");
  console.error("  dn release <subcommand> [options]\n");
  console.error("Subcommands:");
  console.error("  create    Create a new release");
  console.error("  list      List releases");
  console.error("  view      View release details");
  console.error("  edit      Edit a release");
  console.error("  delete    Delete a release\n");
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
      case "list":
      case "ls":
        await handleList(subArgs);
        break;
      case "view":
      case "show":
        await handleView(subArgs);
        break;
      case "edit":
      case "update":
        await handleEdit(subArgs);
        break;
      case "delete":
      case "rm":
        await handleDelete(subArgs);
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
