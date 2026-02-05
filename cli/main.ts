#!/usr/bin/env -S deno run --allow-all
// Copyright 2026 Chesapeake Computing
// SPDX-License-Identifier: Apache-2.0
/**
 * dn CLI - Main entry point
 *
 * A Deno CLI that exposes kickstart-style workflows as subcommands.
 *
 * Usage:
 *   dn kickstart <issue_url_or_number>    # Full kickstart workflow
 *   dn prep <issue_url_or_number>          # Plan phase only
 *   dn loop --plan-file <path>   # Loop phase only
 */

import { handleArchive } from "./archive.ts";
import { handleAuth } from "./auth.ts";
import { handleFixup } from "./fixup.ts";
import { handleIssue } from "./issue.ts";
import { handleKickstart } from "./kickstart.ts";
import { handleLoop } from "./loop.ts";
import { handleMeld } from "./meld.ts";
import { handlePrep } from "./prep.ts";
import { handleGlance } from "./glance.ts";

/**
 * Shows usage information
 */
function showUsage(): void {
  console.error("dn - A CLI for kickstart-style workflows\n");
  console.error("Usage:");
  console.error("  dn auth");
  console.error("  dn issue <subcommand> [options]");
  console.error("  dn kickstart [options] <issue_url_or_number>");
  console.error("  dn prep [options] <issue_url_or_number>");
  console.error("  dn loop [options] --plan-file <path>");
  console.error("  dn fixup [options] <pr_url>");
  console.error("  dn glance [options]");
  console.error("  dn meld [options] <source> [source ...]");
  console.error("  dn archive [options] <plan_file.plan.md>\n");
  console.error("Subcommands:");
  console.error(
    "  auth         Sign in to GitHub in the browser (caches token for dn)",
  );
  console.error(
    "  issue        Manage GitHub issues (list, show, create, edit, close, reopen, comment)",
  );
  console.error(
    "  kickstart    Run full kickstart workflow (plan + implement)",
  );
  console.error("  prep         Run plan phase only (creates plan file)");
  console.error(
    "  loop         Run loop phase only (requires plan file from prep)",
  );
  console.error(
    "  fixup        Address PR feedback locally (fetch comments, plan, implement)",
  );
  console.error(
    "  glance       Project velocity overview",
  );
  console.error(
    "  meld         Merge and trim markdown sources (local paths and/or GitHub issue URLs)",
  );
  console.error(
    "  archive      Derive commit message from plan file; --yolo to commit and delete plan\n",
  );
  console.error(
    "Use 'dn <subcommand> --help' for subcommand-specific options.",
  );
  Deno.exit(1);
}

/**
 * Main entry point
 */
async function main(): Promise<void> {
  const args = Deno.args;

  if (args.length === 0) {
    showUsage();
    return;
  }

  const subcommand = args[0];
  const subcommandArgs = args.slice(1);

  switch (subcommand) {
    case "auth":
      await handleAuth(subcommandArgs);
      break;
    case "issue":
    case "issues":
      await handleIssue(subcommandArgs);
      break;
    case "kickstart":
      await handleKickstart(subcommandArgs);
      break;
    case "loop":
      await handleLoop(subcommandArgs);
      break;
    case "prep":
      await handlePrep(subcommandArgs);
      break;
    case "fixup":
      await handleFixup(subcommandArgs);
      break;
    case "meld":
      await handleMeld(subcommandArgs);
      break;
    case "archive":
      await handleArchive(subcommandArgs);
      break;
    case "glance":
      await handleGlance(subcommandArgs);
      break;
    case "--help":
    case "-h":
    case "help":
      showUsage();
      break;
    default:
      console.error(`Unknown subcommand: ${subcommand}\n`);
      showUsage();
  }
}

if (import.meta.main) {
  await main();
}
