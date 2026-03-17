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
import { bootstrapFromEnv } from "./output.ts";
import { handleFixup } from "./fixup.ts";
import { handleIssue } from "./issue.ts";
import { handleKickstart } from "./kickstart.ts";
import { handleLoop } from "./loop.ts";
import { handleMeld } from "./meld.ts";
import { handlePrep } from "./prep.ts";
import { handleGlance } from "./glance.ts";
import { handleTodo } from "./todo.ts";
import { handleTidy } from "./tidy.ts";

/**
 * Parses global flags from args and returns bootstrap options plus remaining args.
 * Global flags: --unattended, --ci (alias), --no-color, --color.
 */
function parseGlobalFlags(
  args: string[],
): {
  unattended: boolean;
  noColor: boolean;
  forceColor: boolean;
  rest: string[];
} {
  let unattended = false;
  let noColor = false;
  let forceColor = false;
  const rest: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--unattended" || a === "--ci") {
      unattended = true;
    } else if (a === "--no-color") {
      noColor = true;
    } else if (a === "--color") {
      forceColor = true;
    } else {
      rest.push(a);
    }
  }
  return { unattended, noColor, forceColor, rest };
}

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
  console.error("  dn archive [options] <plan_file.plan.md>");
  console.error("  dn todo done [ref]");
  console.error("  dn tidy\n");
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
    "  archive      Derive commit message from plan file; --yolo to commit and delete plan",
  );
  console.error(
    "  todo         Manage prioritized task list (~/.dn/todo.md); 'done' marks item and closes issue",
  );
  console.error(
    "  tidy         Groom todo list: re-fetch issues, re-score, update ~/.dn/todo.md\n",
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
  const rawSubcommandArgs = args.slice(1);

  // Bootstrap output policy once at CLI entry: set NO_COLOR in CI, then apply global flags
  bootstrapFromEnv();
  const { unattended, noColor, forceColor, rest: subcommandArgs } =
    parseGlobalFlags(rawSubcommandArgs);
  bootstrapFromEnv({
    ...(unattended && { unattended: true }),
    ...(noColor && { noColor: true }),
    ...(forceColor && { forceColor: true }),
  });

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
    case "todo":
      await handleTodo(subcommandArgs);
      break;
    case "tidy":
      await handleTidy(subcommandArgs);
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
