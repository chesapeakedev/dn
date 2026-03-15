// Copyright 2026 Chesapeake Computing
// SPDX-License-Identifier: Apache-2.0

/**
 * dn todo subcommand handler
 *
 * Manages the user-level prioritized task list at ~/.dn/todo.md.
 */

import { firstUnchecked, markDone, readTodoList } from "../sdk/todo/todo.ts";

function showHelp(): void {
  console.log("dn todo - Manage prioritized task list (~/.dn/todo.md)\n");
  console.log("Usage:");
  console.log(
    "  dn todo done [ref]   Mark item done (first unchecked if ref omitted)\n",
  );
  console.log("Arguments:");
  console.log(
    "  ref   Optional. Issue URL, issue number, or path (e.g. plans/foo.plan.md).",
  );
  console.log(
    "        If omitted, the first unchecked item is marked done.\n",
  );
  console.log("Options:");
  console.log("  --comment <text>   Comment when closing a GitHub issue");
  console.log("  --help, -h         Show this help message\n");
  console.log(
    "When ref is a GitHub issue, the issue is closed with a comment.",
  );
}

/**
 * Handles the todo subcommand.
 */
export async function handleTodo(args: string[]): Promise<void> {
  if (args.length === 0 || args[0] === "--help" || args[0] === "-h") {
    showTodoHelp();
    return;
  }

  const subcommand = args[0];
  const subArgs = args.slice(1);

  switch (subcommand) {
    case "done":
      await handleTodoDone(subArgs);
      break;
    default:
      console.error(`Unknown subcommand: ${subcommand}\n`);
      showTodoHelp();
      Deno.exit(1);
  }
}

function showTodoHelp(): void {
  console.log("dn todo - Manage prioritized task list\n");
  console.log("Usage:");
  console.log(
    "  dn todo done [ref]   Mark item done (and close GitHub issue if applicable)\n",
  );
  console.log("Subcommands:");
  console.log(
    "  done   Mark the first unchecked item done, or the item matching <ref>.\n",
  );
  console.log("Use 'dn todo done --help' for options.");
}

async function handleTodoDone(args: string[]): Promise<void> {
  let ref: string | null = null;
  let closeComment: string | undefined;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--comment" && i + 1 < args.length) {
      closeComment = args[++i];
    } else if (arg === "--help" || arg === "-h") {
      showHelp();
      return;
    } else if (!arg.startsWith("--") && ref === null) {
      ref = arg;
    }
  }

  const list = await readTodoList();
  const targetRef = ref ?? firstUnchecked(list)?.ref;
  if (!targetRef) {
    if (ref !== null) {
      console.error(`No unchecked todo item found for ref: ${ref}`);
    } else {
      console.error("No unchecked items in todo list.");
    }
    Deno.exit(1);
  }

  try {
    const { closedIssue } = await markDone(targetRef, {
      closeComment,
    });
    console.log(`Marked done: ${targetRef}`);
    if (closedIssue) {
      console.log("Closed the GitHub issue.");
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    Deno.exit(1);
  }
}
