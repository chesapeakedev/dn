// Copyright 2026 Chesapeake Computing
// SPDX-License-Identifier: Apache-2.0

/**
 * Native Denoise task documents embedded in ~/.dn/todo.md (Void task-sync).
 */

import {
  type DenoiseTaskDocument,
  validateDenoiseTaskDocument,
} from "../runner/types.ts";
import {
  checklistCheckedForNativeStatus,
  nativeTaskRef,
  serializeTaskListFile,
} from "./listFile.ts";
import { withTaskListLock } from "./lock.ts";
import { ensureDnHome, getTaskListPath } from "./paths.ts";
import { readFullTaskListFile } from "./queue.ts";

function sanitizeTaskId(taskId: string): string {
  const trimmed = taskId.trim();
  if (
    trimmed.length === 0 ||
    trimmed.includes("/") ||
    trimmed.includes("\\") ||
    trimmed.includes("..")
  ) {
    throw new Error("Invalid task id.");
  }
  return trimmed;
}

/** Path segment for a native task (within the unified list file). */
export function getTaskDocumentPath(taskId: string): string {
  sanitizeTaskId(taskId);
  return `${getTaskListPath()} (task:${taskId})`;
}

/** @deprecated Use {@link getTaskDocumentPath}. */
export const getTaskPath = getTaskDocumentPath;

/**
 * Lists native tasks from the unified file, newest updated_at first.
 */
export async function listNativeTasks(): Promise<DenoiseTaskDocument[]> {
  const file = await readFullTaskListFile();
  return Object.values(file.nativeTasks).sort((a, b) =>
    Date.parse(b.updated_at) - Date.parse(a.updated_at)
  );
}

/** @deprecated Use {@link listNativeTasks}. */
export const listTasks = listNativeTasks;

export async function getNativeTask(
  taskId: string,
): Promise<DenoiseTaskDocument | null> {
  const id = sanitizeTaskId(taskId);
  const file = await readFullTaskListFile();
  return file.nativeTasks[id] ?? null;
}

/** @deprecated Use {@link getNativeTask}. */
export const getTask = getNativeTask;

function upsertNativeInFile(
  file: Awaited<ReturnType<typeof readFullTaskListFile>>,
  task: DenoiseTaskDocument,
): void {
  const checked = checklistCheckedForNativeStatus(task);
  file.nativeTasks[task.id] = task;
  const ref = nativeTaskRef(task.id);
  const idx = file.items.findIndex((i) => i.ref === ref);
  const line = {
    checked,
    ref,
    title: task.title,
  };
  if (idx >= 0) {
    file.items[idx] = { ...file.items[idx], ...line };
  } else {
    file.items.push(line);
  }
}

export async function upsertNativeTask(
  document: unknown,
  options?: { requireNewer?: boolean },
): Promise<DenoiseTaskDocument> {
  const task = validateDenoiseTaskDocument(document);
  sanitizeTaskId(task.id);
  return await withTaskListLock(async () => {
    const file = await readFullTaskListFile();
    if (options?.requireNewer) {
      const existing = file.nativeTasks[task.id];
      if (
        existing &&
        Date.parse(existing.updated_at) > Date.parse(task.updated_at)
      ) {
        return existing;
      }
    }
    upsertNativeInFile(file, task);
    await ensureDnHome();
    await Deno.writeTextFile(
      getTaskListPath(),
      serializeTaskListFile(file),
      { create: true },
    );
    return task;
  });
}

/** @deprecated Use {@link upsertNativeTask}. */
export const upsertTask = upsertNativeTask;

export async function deleteNativeTask(taskId: string): Promise<boolean> {
  const id = sanitizeTaskId(taskId);
  return await withTaskListLock(async () => {
    const file = await readFullTaskListFile();
    const ref = nativeTaskRef(id);
    const hadDoc = id in file.nativeTasks;
    delete file.nativeTasks[id];
    const before = file.items.length;
    file.items = file.items.filter((i) => i.ref !== ref);
    const changed = hadDoc || file.items.length !== before;
    if (changed) {
      await Deno.writeTextFile(
        getTaskListPath(),
        serializeTaskListFile(file),
        { create: true },
      );
    }
    return changed;
  });
}

/** @deprecated Use {@link deleteNativeTask}. */
export const deleteTask = deleteNativeTask;

export async function applyTaskSyncOp(
  op: {
    op: "upsert" | "delete";
    task_id: string;
    task_document?: unknown;
  },
): Promise<void> {
  if (op.op === "delete") {
    await deleteNativeTask(op.task_id);
    return;
  }
  if (op.task_document === undefined) {
    throw new Error("Task upsert requires task_document.");
  }
  const task = validateDenoiseTaskDocument(op.task_document);
  if (task.id !== op.task_id) {
    throw new Error("Task upsert id mismatch.");
  }
  await upsertNativeTask(task, { requireNewer: true });
}
