// Copyright 2026 Chesapeake Computing
// SPDX-License-Identifier: Apache-2.0

/**
 * dn task — manage the unified task list at ~/.dn/todo.md.
 */

import {
  deleteTask,
  firstUnchecked,
  getNativeTask,
  getTaskDocumentPath,
  getTaskListLockPath,
  getTaskListPath,
  listNativeTasks,
  markDone,
  nativeTaskIdFromRef,
  readTaskList,
  upsertTask,
} from "../sdk/tasks/tasks.ts";
import { loadRunnerCredential } from "../sdk/runner/config.ts";
import {
  type DenoiseTaskDocument,
  validateDenoiseTaskDocument,
} from "../sdk/runner/types.ts";
import { handleTaskWithBackend } from "./taskWorkspace.ts";

function showHelp(): void {
  console.log(
    "dn task - Tasks: local queue, GitHub issues, or Denoise cloud\n",
  );
  console.log("Usage:");
  console.log("  dn task list [--json] [--todo | --github | --denoise]");
  console.log("  dn task show <id|ref> [--json]");
  console.log(
    "  dn task create --title <t> --milestone <id>  (with --denoise)",
  );
  console.log(
    "  dn task edit|close|reopen|comment  (GitHub or Denoise via flags)",
  );
  console.log("  dn task upsert --file <path.json> | --stdin   (--todo)");
  console.log("  dn task delete <id>");
  console.log(
    "  dn task done [ref] [--comment <text>]   Mark item done; close GitHub issue when applicable\n",
  );
  console.log("  dn task sync status [--json]\n");
  console.log(
    "Default backend: workspace.default_backend in dn.json (~/.dn/config.json).",
  );
  console.log(
    "  todo    → ~/.dn/todo.md queue (also: upsert, delete, done, sync)",
  );
  console.log("  github  → same as dn issue");
  console.log("  denoise → Denoise milestone tasks (GitHub bearer auth)\n");
}

/**
 * Handles the task subcommand.
 */
export async function handleTask(args: string[]): Promise<void> {
  if (args.length === 0 || args[0] === "--help" || args[0] === "-h") {
    showHelp();
    return;
  }

  try {
    if (await handleTaskWithBackend(args)) return;
  } catch (error) {
    console.error(
      `Error: ${error instanceof Error ? error.message : String(error)}`,
    );
    Deno.exit(1);
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
    case "done":
      await handleDone(subArgs);
      break;
    case "sync":
      await handleSync(subArgs);
      break;
    default:
      console.error(`Unknown subcommand: ${subcommand}\n`);
      showHelp();
      Deno.exit(1);
  }
}

const LOCK_STALE_MS = 30_000;

async function handleList(args: string[]): Promise<void> {
  const json = args.includes("--json");
  const natives = await listNativeTasks();
  const queue = await readTaskList();
  if (json) {
    console.log(
      JSON.stringify(
        {
          path: getTaskListPath(),
          native_tasks: natives,
          queue_items: queue.items,
          meta: queue.meta,
        },
        null,
        2,
      ),
    );
    return;
  }
  if (natives.length === 0 && queue.items.length === 0) {
    console.log(`No tasks in ${getTaskListPath()}.`);
    return;
  }
  if (natives.length > 0) {
    console.log("Native tasks:");
    for (const task of natives) {
      console.log(
        `  ${task.status.padEnd(12)} ${task.id}  ${task.title}`,
      );
    }
  }
  const queueOpen = queue.items.filter((i) => !i.checked);
  if (queueOpen.length > 0) {
    console.log("Kickstart queue (unchecked):");
    for (const item of queueOpen) {
      const title = item.title ? `  ${item.title}` : "";
      console.log(`  - ${item.ref}${title}`);
    }
  }
}

async function handleShow(args: string[]): Promise<void> {
  const json = args.includes("--json");
  const idOrRef = args.find((a) => !a.startsWith("--"));
  if (!idOrRef) {
    console.error("Usage: dn task show <id|ref> [--json]");
    Deno.exit(1);
  }
  const nativeId = nativeTaskIdFromRef(idOrRef) ?? idOrRef;
  const task = await getNativeTask(nativeId);
  if (task) {
    if (json) {
      console.log(JSON.stringify(task, null, 2));
      return;
    }
    console.log(`id:      ${task.id}`);
    console.log(`title:   ${task.title}`);
    console.log(`status:  ${task.status}`);
    console.log(`updated: ${task.updated_at}`);
    console.log(`path:    ${getTaskDocumentPath(task.id)}`);
    console.log("");
    console.log(task.body);
    return;
  }
  const list = await readTaskList();
  const item = list.items.find((i) => i.ref === idOrRef);
  if (!item) {
    console.error(`No task found: ${idOrRef}`);
    Deno.exit(1);
  }
  if (json) {
    console.log(JSON.stringify(item, null, 2));
    return;
  }
  console.log(`ref:     ${item.ref}`);
  console.log(`checked: ${item.checked}`);
  if (item.score != null) console.log(`score:   ${item.score}`);
  if (item.title) console.log(`title:   ${item.title}`);
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
  console.log(`Upserted ${saved.id} → ${getTaskDocumentPath(saved.id)}`);
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

async function handleDone(args: string[]): Promise<void> {
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

  const list = await readTaskList();
  const targetRef = ref ?? firstUnchecked(list)?.ref;
  if (!targetRef) {
    if (ref !== null) {
      console.error(`No unchecked task list item found for ref: ${ref}`);
    } else {
      console.error("No unchecked items in task list.");
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

async function handleSync(args: string[]): Promise<void> {
  if (args.length === 0 || args[0] === "--help" || args[0] === "-h") {
    console.log("Usage: dn task sync status [--json]");
    return;
  }
  if (args[0] !== "status") {
    console.error(`Unknown sync subcommand: ${args[0]}`);
    console.log("Usage: dn task sync status [--json]");
    Deno.exit(1);
  }
  const json = args.includes("--json");
  const listPath = getTaskListPath();
  const lockPath = getTaskListLockPath();
  const listStat = await Deno.stat(listPath).catch(() => null);
  const lockStat = await Deno.stat(lockPath).catch(() => null);
  let lockHeld = false;
  if (lockStat) {
    const mtime = lockStat.mtime?.getTime();
    const age = mtime != null ? Date.now() - mtime : LOCK_STALE_MS;
    lockHeld = age < LOCK_STALE_MS;
  }
  const credential = await loadRunnerCredential();
  const runnerPaired = credential != null;
  const runnerExpired = credential != null &&
    Date.parse(credential.expires_at) <= Date.now();
  const natives = await listNativeTasks().catch(() => []);
  const status = {
    task_list_path: listPath,
    task_list_exists: listStat != null,
    task_list_modified_at: listStat?.mtime?.toISOString() ?? null,
    lock_path: lockPath,
    lock_held: lockHeld,
    runner_paired: runnerPaired,
    runner_id: credential?.runner_id ?? null,
    runner_credential_expired: runnerExpired,
    native_task_count: natives.length,
  };
  if (json) {
    console.log(JSON.stringify(status, null, 2));
    return;
  }
  console.log(`Task list: ${listPath}`);
  if (listStat) {
    console.log(`  modified: ${listStat.mtime?.toISOString() ?? "unknown"}`);
  } else {
    console.log("  (file not created yet)");
  }
  console.log(
    `  lock: ${lockHeld ? "held (another dn process may be writing)" : "free"}`,
  );
  if (runnerPaired) {
    const cred = credential!;
    console.log(
      `Runner: paired (${cred.runner_id})${
        runnerExpired
          ? " — credential expired, re-pair with dn runner connect"
          : ""
      }`,
    );
  } else {
    console.log("Runner: not paired (Void task-sync needs dn runner serve)");
  }
  console.log(`Native tasks on disk: ${natives.length}`);
}
