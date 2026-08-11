// Copyright 2026 Chesapeake Computing
// SPDX-License-Identifier: Apache-2.0

/**
 * dn task — manage local Denoise task documents (~/.dn/tasks/).
 *
 * Distinct from `dn todo` (~/.dn/todo.md GitHub/plan kickstart queue).
 */

import {
  deleteTask,
  getTask,
  getTaskPath,
  listTasks,
  upsertTask,
} from "../sdk/tasks/tasks.ts";
import {
  type DenoiseTaskDocument,
  validateDenoiseTaskDocument,
} from "../sdk/runner/types.ts";

function showHelp(): void {
  console.log("dn task - Manage local Denoise task documents (~/.dn/tasks/)\n");
  console.log("Usage:");
  console.log("  dn task list [--json]");
  console.log("  dn task show <id> [--json]");
  console.log("  dn task upsert --file <path.json> | --stdin");
  console.log("  dn task delete <id>\n");
  console.log(
    "These documents are ticketless DenoiseTaskDocument JSON files used by",
  );
  console.log(
    "Void local sync and `dn kickstart --denoise-task`. They are not the",
  );
  console.log(
    "GitHub/plan queue in ~/.dn/todo.md (see `dn todo` / `dn tidy`).\n",
  );
}

/**
 * Handles the task subcommand.
 */
export async function handleTask(args: string[]): Promise<void> {
  if (args.length === 0 || args[0] === "--help" || args[0] === "-h") {
    showHelp();
    return;
  }

  const subcommand = args[0];
  const subArgs = args.slice(1);

  switch (subcommand) {
    case "list":
      await handleList(subArgs);
      break;
    case "show":
      await handleShow(subArgs);
      break;
    case "upsert":
      await handleUpsert(subArgs);
      break;
    case "delete":
      await handleDelete(subArgs);
      break;
    default:
      console.error(`Unknown subcommand: ${subcommand}\n`);
      showHelp();
      Deno.exit(1);
  }
}

async function handleList(args: string[]): Promise<void> {
  const json = args.includes("--json");
  const tasks = await listTasks();
  if (json) {
    console.log(JSON.stringify(tasks, null, 2));
    return;
  }
  if (tasks.length === 0) {
    console.log("No local tasks in ~/.dn/tasks/.");
    return;
  }
  for (const task of tasks) {
    console.log(
      `${task.status.padEnd(12)} ${task.id}  ${task.title}`,
    );
  }
}

async function handleShow(args: string[]): Promise<void> {
  const json = args.includes("--json");
  const id = args.find((a) => !a.startsWith("--"));
  if (!id) {
    console.error("Usage: dn task show <id> [--json]");
    Deno.exit(1);
  }
  const task = await getTask(id);
  if (!task) {
    console.error(`No task found: ${id}`);
    Deno.exit(1);
  }
  if (json) {
    console.log(JSON.stringify(task, null, 2));
    return;
  }
  console.log(`id:      ${task.id}`);
  console.log(`title:   ${task.title}`);
  console.log(`status:  ${task.status}`);
  console.log(`updated: ${task.updated_at}`);
  console.log(`path:    ${getTaskPath(task.id)}`);
  console.log("");
  console.log(task.body);
}

async function handleUpsert(args: string[]): Promise<void> {
  let file: string | null = null;
  let stdin = false;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--file" && i + 1 < args.length) {
      file = args[++i];
    } else if (arg === "--stdin") {
      stdin = true;
    } else if (arg === "--help" || arg === "-h") {
      showHelp();
      return;
    }
  }
  if ((file == null && !stdin) || (file != null && stdin)) {
    console.error("Usage: dn task upsert --file <path.json> | --stdin");
    Deno.exit(1);
  }
  const raw = stdin
    ? await new Response(Deno.stdin.readable).text()
    : await Deno.readTextFile(file!);
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    console.error("Task document must be valid JSON.");
    Deno.exit(1);
  }
  let task: DenoiseTaskDocument;
  try {
    task = validateDenoiseTaskDocument(parsed);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    Deno.exit(1);
  }
  const saved = await upsertTask(task);
  console.log(`Upserted ${saved.id} → ${getTaskPath(saved.id)}`);
}

async function handleDelete(args: string[]): Promise<void> {
  const id = args.find((a) => !a.startsWith("--"));
  if (!id) {
    console.error("Usage: dn task delete <id>");
    Deno.exit(1);
  }
  const removed = await deleteTask(id);
  if (!removed) {
    console.error(`No task found: ${id}`);
    Deno.exit(1);
  }
  console.log(`Deleted ${id}`);
}
