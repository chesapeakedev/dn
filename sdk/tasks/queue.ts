// Copyright 2026 Chesapeake Computing
// SPDX-License-Identifier: Apache-2.0

/**
 * Kickstart queue operations on ~/.dn/todo.md checklist lines.
 */

import {
  addIssueComment,
  closeIssue,
  getCurrentRepoFromRemote,
} from "../github/github-gql.ts";
import {
  nativeTaskIdFromRef,
  parseTaskListFile,
  serializeTaskListFile,
  syncNativeStatusWithChecklist,
  type TaskList,
  type TaskListItem,
} from "./listFile.ts";
import { withTaskListLock } from "./lock.ts";
import { migrateLegacyJsonTaskDirIfNeeded } from "./migrate.ts";
import { ensureDnHome, getTaskListPath } from "./paths.ts";

export type { TaskList, TaskListItem, TodoItem, TodoList } from "./listFile.ts";
export { getTaskListPath, getTodoPath } from "./paths.ts";

const GITHUB_ISSUE_URL_RE =
  /^https?:\/\/github\.com\/([^/]+)\/([^/]+)\/issues\/(\d+)(?:\?.*)?$/i;
const ISSUE_NUMBER_RE = /^#?(\d+)$/;

async function readTaskListFileFromDisk() {
  await migrateLegacyJsonTaskDirIfNeeded();
  const path = getTaskListPath();
  try {
    const content = await Deno.readTextFile(path);
    return parseTaskListFile(content);
  } catch (e) {
    if (e instanceof Deno.errors.NotFound) {
      return { meta: {}, items: [], nativeTasks: {} };
    }
    throw e;
  }
}

/**
 * Reads the kickstart queue (checklist lines). Native payloads stay in file.
 */
export async function readTaskList(): Promise<TaskList> {
  const file = await readTaskListFileFromDisk();
  return { meta: file.meta, items: file.items };
}

/** @deprecated Use {@link readTaskList}. */
export const readTodoList = readTaskList;

/**
 * Writes checklist + preserves native task blocks on disk.
 */
export async function writeTaskList(list: TaskList): Promise<void> {
  await withTaskListLock(async () => {
    const existing = await readTaskListFileFromDisk();
    await ensureDnHome();
    await Deno.writeTextFile(
      getTaskListPath(),
      serializeTaskListFile({
        meta: list.meta,
        items: list.items,
        nativeTasks: existing.nativeTasks,
      }),
      { create: true },
    );
  });
}

/** @deprecated Use {@link writeTaskList}. */
export const writeTodoList = writeTaskList;

export function firstUnchecked(list: TaskList): TaskListItem | null {
  return list.items.find((i) => !i.checked) ?? null;
}

export async function resolveGitHubRef(ref: string): Promise<
  {
    owner: string;
    repo: string;
    number: number;
  } | null
> {
  const urlMatch = ref.match(GITHUB_ISSUE_URL_RE);
  if (urlMatch) {
    return {
      owner: urlMatch[1],
      repo: urlMatch[2],
      number: parseInt(urlMatch[3], 10),
    };
  }
  const numMatch = ref.match(ISSUE_NUMBER_RE);
  if (numMatch) {
    const { owner, repo } = await getCurrentRepoFromRemote();
    return { owner, repo, number: parseInt(numMatch[1], 10) };
  }
  return null;
}

export async function addToTaskList(
  items: Omit<TaskListItem, "checked">[],
  options?: { repo?: string; updated?: string },
): Promise<void> {
  await withTaskListLock(async () => {
    const file = await readTaskListFileFromDisk();
    const existingRefs = new Set(file.items.map((i) => i.ref));
    for (const item of items) {
      if (existingRefs.has(item.ref)) continue;
      file.items.push({ ...item, checked: false });
      existingRefs.add(item.ref);
    }
    if (options?.repo) file.meta.repo = options.repo;
    if (options?.updated) file.meta.updated = options.updated;
    await ensureDnHome();
    await Deno.writeTextFile(
      getTaskListPath(),
      serializeTaskListFile(file),
      { create: true },
    );
  });
}

/** @deprecated Use {@link addToTaskList}. */
export const addToTodoList = addToTaskList;

export function formatTaskQueuePrompt(
  items: Omit<TaskListItem, "checked">[],
): string {
  const listPath = getTaskListPath();
  const formatItem = (item: Omit<TaskListItem, "checked">): string =>
    item.title ? `\`${item.ref}\` ("${item.title}")` : `\`${item.ref}\``;

  if (items.length === 1) {
    return `Queue ${
      formatItem(items[0])
    } in ${listPath} for future dn kickstart sessions? (y/n): `;
  }

  const lines = items.map((item) => `  - ${formatItem(item)}`).join("\n");
  return `Queue these items in ${listPath} for future dn kickstart sessions?\n${lines}\n(y/n): `;
}

/** @deprecated Use {@link formatTaskQueuePrompt}. */
export const formatTodoQueuePrompt = formatTaskQueuePrompt;

export async function promptAndAddToTaskList(
  items: Omit<TaskListItem, "checked">[],
  options?: { repo?: string; updated?: string },
): Promise<boolean> {
  const answer = prompt(formatTaskQueuePrompt(items))?.trim()
    .toLowerCase();
  if (answer !== "y" && answer !== "yes") return false;
  await addToTaskList(items, options);
  return true;
}

/** @deprecated Use {@link promptAndAddToTaskList}. */
export const promptAndAddToTodoList = promptAndAddToTaskList;

export function itemRefMatchesTarget(
  itemRef: string,
  targetRef: string,
  targetGh: { owner: string; repo: string; number: number } | null,
): boolean {
  if (itemRef === targetRef) return true;
  if (!targetGh) return false;
  if (
    itemRef === `#${targetGh.number}` || itemRef === String(targetGh.number)
  ) {
    return true;
  }
  if (itemRef.endsWith(`/issues/${targetGh.number}`)) return true;
  return false;
}

export async function completeGitHubIssueForRef(
  gh: { owner: string; repo: string; number: number },
  options?: { closeComment?: string },
): Promise<void> {
  const comment = options?.closeComment ?? "Completed via dn task done";
  await addIssueComment(gh.owner, gh.repo, gh.number, comment);
  await closeIssue(gh.owner, gh.repo, gh.number, "COMPLETED");
}

function findUncheckedItem(
  list: TaskList,
  ref: string,
  gh: { owner: string; repo: string; number: number } | null,
): number {
  return list.items.findIndex((i) => {
    if (i.checked) return false;
    return itemRefMatchesTarget(i.ref, ref, gh);
  });
}

export async function markDone(
  ref: string,
  options?: { closeComment?: string; updated?: string },
): Promise<{ closedIssue: boolean }> {
  const list = await readTaskList();
  const gh = await resolveGitHubRef(ref);
  const matchIndex = findUncheckedItem(list, ref, gh);
  if (matchIndex < 0) {
    throw new Error(`No unchecked task list item found for ref: ${ref}`);
  }
  if (gh) {
    await completeGitHubIssueForRef(gh, options);
  }
  await withTaskListLock(async () => {
    const file = await readTaskListFileFromDisk();
    const idx = findUncheckedItem(
      { meta: file.meta, items: file.items },
      ref,
      gh,
    );
    if (idx >= 0) {
      file.items[idx].checked = true;
      const nativeId = nativeTaskIdFromRef(file.items[idx].ref);
      if (nativeId && file.nativeTasks[nativeId]) {
        file.nativeTasks[nativeId] = syncNativeStatusWithChecklist(
          file.nativeTasks[nativeId],
          true,
        );
      }
    }
    if (options?.updated) file.meta.updated = options.updated;
    await Deno.writeTextFile(
      getTaskListPath(),
      serializeTaskListFile(file),
      { create: true },
    );
  });
  return { closedIssue: !!gh };
}

/** Reads full file for native module (includes nativeTasks). */
export async function readFullTaskListFile() {
  await migrateLegacyJsonTaskDirIfNeeded();
  return await readTaskListFileFromDisk();
}

/** Writes full file under lock. */
export async function writeFullTaskListFile(
  file: Awaited<ReturnType<typeof readTaskListFileFromDisk>>,
): Promise<void> {
  await withTaskListLock(async () => {
    await ensureDnHome();
    await Deno.writeTextFile(
      getTaskListPath(),
      serializeTaskListFile(file),
      { create: true },
    );
  });
}
