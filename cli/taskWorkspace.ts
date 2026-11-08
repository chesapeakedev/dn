// Copyright 2026 Chesapeake Computing
// SPDX-License-Identifier: Apache-2.0

import { resolve } from "@std/path";
import { resolveGitHubToken } from "../sdk/github/token.ts";
import { resolveDnConfig } from "../sdk/config/mod.ts";
import {
  closeDenoiseTask,
  createDenoiseTasks,
  listDenoiseTasks,
  reopenDenoiseTask,
  updateDenoiseTask,
} from "../sdk/denoise/tasks.ts";
import { fetchDenoiseTaskRefFromParsed } from "../sdk/denoise/fetchTaskRef.ts";
import { parseDenoiseTaskUrl } from "../sdk/denoise/taskUrl.ts";
import {
  parseWorkspaceFlags,
  resolveWorkspaceBackend,
} from "../sdk/denoise/workspaceBackend.ts";
import { DEFAULT_DENOISE_API_URL } from "../sdk/runner/client.ts";
import { handleIssue } from "./issue.ts";

const ISSUE_ALIASES = new Set([
  "list",
  "ls",
  "show",
  "view",
  "create",
  "new",
  "edit",
  "update",
  "close",
  "reopen",
  "comment",
  "split",
  "relationship",
  "relationships",
]);

const TODO_ONLY = new Set(["upsert", "delete", "done", "sync"]);

function optionValue(args: string[], index: number, option: string): string {
  const value = args[index + 1];
  if (!value || value.startsWith("--")) {
    throw new Error(`${option} requires a value`);
  }
  return value;
}

async function resolveClientOptions(apiUrl: string | null) {
  const token = await resolveGitHubToken();
  const config = await resolveDnConfig({ repoRoot: Deno.cwd() });
  const origin = apiUrl?.trim() ||
    config.workspace?.api_url ||
    config.defaults?.workspace?.api_url ||
    DEFAULT_DENOISE_API_URL;
  return { githubToken: token, apiUrl: origin };
}

export async function resolveTaskBackend(
  args: string[],
  ref?: string,
): Promise<{
  backend: ReturnType<typeof resolveWorkspaceBackend>;
  args: string[];
  apiUrl: string | null;
}> {
  const { backend: explicit, apiUrl, args: rest } = parseWorkspaceFlags(args);
  const config = await resolveDnConfig({ repoRoot: Deno.cwd() });
  const backend = resolveWorkspaceBackend({
    explicit,
    config,
    ref,
  });
  return { backend, args: rest, apiUrl };
}

async function handleDenoiseList(args: string[]): Promise<void> {
  let milestoneId: string | undefined;
  let json = false;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--milestone") {
      milestoneId = optionValue(args, i++, "--milestone");
    } else if (args[i] === "--json") json = true;
    else if (args[i] === "--help" || args[i] === "-h") {
      console.log("Usage: dn task list --denoise --milestone <id> [--json]");
      return;
    }
  }
  if (!milestoneId) {
    throw new Error("--milestone is required for Denoise task list");
  }
  const { githubToken, apiUrl } = await resolveClientOptions(null);
  const tasks = await listDenoiseTasks(milestoneId, { githubToken, apiUrl });
  if (json) {
    console.log(JSON.stringify({ tasks }, null, 2));
    return;
  }
  if (tasks.length === 0) {
    console.log("No tasks in milestone.");
    return;
  }
  for (const task of tasks) {
    const status = task.completed ? "done" : "open";
    console.log(`${status.padEnd(6)} ${task.id}  ${task.text}`);
  }
}

async function handleDenoiseShow(args: string[]): Promise<void> {
  let json = false;
  const ref = args.find((a) => !a.startsWith("--") && a !== "--json");
  if (args.includes("--json")) json = true;
  if (!ref) {
    throw new Error("Usage: dn task show --denoise <task-url-or-id>");
  }
  const { githubToken, apiUrl } = await resolveClientOptions(null);
  const parsed = parseDenoiseTaskUrl(ref) ??
    parseDenoiseTaskUrl(
      new URL(`/task/${ref}`, apiUrl).href,
    );
  if (!parsed) {
    throw new Error(`Not a Denoise task reference: ${ref}`);
  }
  const taskRef = await fetchDenoiseTaskRefFromParsed(parsed, {
    githubToken,
    fetch: fetch,
  });
  if (json) {
    console.log(JSON.stringify(taskRef, null, 2));
    return;
  }
  console.log(`milestone: ${taskRef.milestone_id}`);
  console.log(`task:      ${taskRef.task_id}`);
  console.log(`url:       ${taskRef.canonical_url}`);
  console.log(`title:     ${taskRef.task_document.title}`);
  console.log(`status:    ${taskRef.task_document.status}`);
  if (taskRef.task_document.body) {
    console.log("");
    console.log(taskRef.task_document.body);
  }
}

async function handleDenoiseCreate(args: string[]): Promise<void> {
  let title: string | undefined;
  let milestoneId: string | undefined;
  let bodyFile: string | undefined;
  let count: number | undefined;
  let json = false;
  const { apiUrl: flagApiUrl, args: flagArgs } = parseWorkspaceFlags(args);
  void flagApiUrl;
  for (let i = 0; i < flagArgs.length; i++) {
    switch (flagArgs[i]) {
      case "--title":
        title = optionValue(flagArgs, i++, "--title");
        break;
      case "--milestone":
        milestoneId = optionValue(flagArgs, i++, "--milestone");
        break;
      case "--body-file":
        bodyFile = optionValue(flagArgs, i++, "--body-file");
        break;
      case "--count":
        count = Number(optionValue(flagArgs, i++, "--count"));
        break;
      case "--json":
        json = true;
        break;
      case "--help":
      case "-h":
        console.log(
          "Usage: dn task create --denoise --title <t> --milestone <id> [--body-file f] [--count n] [--json]",
        );
        return;
    }
  }
  if (!milestoneId) {
    throw new Error("--milestone is required");
  }
  if (!title && count == null) {
    throw new Error("--title or --count is required");
  }
  const description = bodyFile
    ? await Deno.readTextFile(resolve(Deno.cwd(), bodyFile))
    : undefined;
  const { githubToken, apiUrl } = await resolveClientOptions(null);
  const result = await createDenoiseTasks(
    {
      milestoneId,
      ...(title !== undefined ? { title } : {}),
      ...(count !== undefined && Number.isFinite(count) ? { count } : {}),
      ...(description !== undefined ? { description } : {}),
    },
    { githubToken, apiUrl },
  );
  if (json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }
  for (const row of result.tasks) {
    const url = row.canonical_url ??
      new URL(row.task_path ?? `/task/${row.task_id}`, apiUrl).href;
    console.log(`Created task ${row.task_id}`);
    console.log(`  ${url}`);
    console.log(`  dn kickstart ${url}`);
  }
}

async function handleDenoiseEdit(args: string[]): Promise<void> {
  let milestoneId: string | undefined;
  let taskId: string | undefined;
  let title: string | undefined;
  let bodyFile: string | undefined;
  let json = false;
  const ref = args.find((a) =>
    !a.startsWith("--") && a !== "--json" && ![
      "--milestone",
      "--title",
      "--body-file",
    ].includes(a)
  );
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--milestone") {
      milestoneId = optionValue(args, i++, "--milestone");
    } else if (args[i] === "--title") title = optionValue(args, i++, "--title");
    else if (args[i] === "--body-file") {
      bodyFile = optionValue(args, i++, "--body-file");
    } else if (args[i] === "--json") json = true;
  }
  taskId = ref;
  if (!taskId) {
    throw new Error(
      "Usage: dn task edit --denoise <task-id> --milestone <id> [--title] [--body-file]",
    );
  }
  if (!milestoneId) {
    const parsed = parseDenoiseTaskUrl(taskId);
    if (parsed?.kind === "milestone" && parsed.milestoneId) {
      milestoneId = parsed.milestoneId;
      taskId = parsed.taskId ?? taskId;
    }
  }
  if (!milestoneId) {
    throw new Error("--milestone is required when task id is not a full URL");
  }
  const description = bodyFile
    ? await Deno.readTextFile(resolve(Deno.cwd(), bodyFile))
    : undefined;
  const { githubToken, apiUrl } = await resolveClientOptions(null);
  const task = await updateDenoiseTask(
    milestoneId,
    taskId,
    {
      ...(title !== undefined ? { title } : {}),
      ...(description !== undefined ? { description } : {}),
    },
    { githubToken, apiUrl },
  );
  if (json) {
    console.log(JSON.stringify(task, null, 2));
    return;
  }
  console.log(`Updated task ${task.id}: ${task.text}`);
}

async function handleDenoiseClose(args: string[]): Promise<void> {
  const taskId = args.find((a) => !a.startsWith("--"));
  if (!taskId) throw new Error("Usage: dn task close --denoise <task-id>");
  const { githubToken, apiUrl } = await resolveClientOptions(null);
  const id = parseDenoiseTaskUrl(taskId)?.taskId ?? taskId;
  const task = await closeDenoiseTask(id, { githubToken, apiUrl });
  console.log(`Closed task ${task.id}`);
}

async function handleDenoiseReopen(args: string[]): Promise<void> {
  const taskId = args.find((a) => !a.startsWith("--"));
  if (!taskId) throw new Error("Usage: dn task reopen --denoise <task-id>");
  const { githubToken, apiUrl } = await resolveClientOptions(null);
  const id = parseDenoiseTaskUrl(taskId)?.taskId ?? taskId;
  const task = await reopenDenoiseTask(id, { githubToken, apiUrl });
  console.log(`Reopened task ${task.id}`);
}

function handleDenoiseComment(): void {
  throw new Error(
    "Denoise task comment is not supported; use dn task edit --denoise --body-file to update description",
  );
}

const TODO_SUBCOMMANDS = new Set([
  "list",
  "ls",
  "show",
  "upsert",
  "delete",
  "done",
  "sync",
]);

/** @returns true when the request was handled (cloud/github backends). */
export async function handleTaskWithBackend(
  rawArgs: string[],
): Promise<boolean> {
  const subcommand = rawArgs[0];
  if (!subcommand || subcommand === "--help" || subcommand === "-h") {
    return false;
  }
  const rest = rawArgs.slice(1);
  const ref =
    ["show", "close", "reopen", "edit", "comment"].includes(subcommand)
      ? rest.find((a) => !a.startsWith("--"))
      : undefined;
  const { backend, args, apiUrl } = await resolveTaskBackend(rest, ref);

  if (backend === "todo") {
    if (TODO_SUBCOMMANDS.has(subcommand)) return false;
    throw new Error(
      `${subcommand} requires --github or --denoise (or workspace.default_backend in dn.json)`,
    );
  }

  if (backend === "github" && ISSUE_ALIASES.has(subcommand)) {
    if (apiUrl) {
      console.error("Note: --api-url applies to Denoise backend only");
    }
    await handleIssue([subcommand, ...args]);
    return true;
  }

  if (backend === "denoise") {
    if (TODO_ONLY.has(subcommand)) {
      throw new Error(
        `dn task ${subcommand} is only supported with --todo (local ~/.dn/todo.md)`,
      );
    }
    void apiUrl;
    switch (subcommand) {
      case "list":
      case "ls":
        await handleDenoiseList(args);
        return true;
      case "show":
      case "view":
        await handleDenoiseShow(args);
        return true;
      case "create":
      case "new":
        await handleDenoiseCreate(["create", ...rest]);
        return true;
      case "edit":
      case "update":
        await handleDenoiseEdit(args);
        return true;
      case "close":
        await handleDenoiseClose(args);
        return true;
      case "reopen":
        await handleDenoiseReopen(args);
        return true;
      case "comment":
        await handleDenoiseComment();
        return true;
      default:
        throw new Error(
          `Unknown subcommand for Denoise backend: ${subcommand}`,
        );
    }
  }

  if (ISSUE_ALIASES.has(subcommand)) {
    await handleIssue([subcommand, ...args]);
    return true;
  }
  throw new Error(
    `Unknown task subcommand for backend ${backend}: ${subcommand}`,
  );
}
