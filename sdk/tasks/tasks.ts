// Copyright 2026 Chesapeake Computing
// SPDX-License-Identifier: Apache-2.0

/**
 * Local Denoise task document store at ~/.dn/tasks/<id>.json.
 *
 * Separate from ~/.dn/todo.md (GitHub/plan kickstart queue). See device-runners
 * docs for the Void ↔ dn relay that writes here.
 */

import {
  type DenoiseTaskDocument,
  validateDenoiseTaskDocument,
} from "../runner/types.ts";
import { getDnHomeDir } from "../todo/todo.ts";

const LOCK_STALE_MS = 30_000;

/** Returns the directory that holds portable task documents. */
export function getTasksDir(): string {
  return `${getDnHomeDir()}/tasks`;
}

function getLockPath(): string {
  return `${getTasksDir()}/.lock`;
}

/** Absolute path for one task document. */
export function getTaskPath(taskId: string): string {
  const id = sanitizeTaskId(taskId);
  return `${getTasksDir()}/${id}.json`;
}

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

async function ensureTasksDir(): Promise<void> {
  await Deno.mkdir(getTasksDir(), { recursive: true });
}

async function withLock<T>(fn: () => Promise<T>): Promise<T> {
  await ensureTasksDir();
  const lockPath = getLockPath();
  const stat = await Deno.stat(lockPath).catch(() => null);
  if (stat) {
    const mtime = stat.mtime?.getTime();
    const age = mtime != null ? Date.now() - mtime : 0;
    if (age < LOCK_STALE_MS) {
      throw new Error(
        `Task store is locked (${lockPath}). If no other dn process is running, remove the lock file.`,
      );
    }
  }
  await Deno.writeTextFile(lockPath, String(Date.now()), { create: true });
  try {
    return await fn();
  } finally {
    await Deno.remove(lockPath).catch(() => {});
  }
}

/**
 * Lists all local Denoise task documents, newest updated_at first.
 */
export async function listTasks(): Promise<DenoiseTaskDocument[]> {
  await ensureTasksDir();
  const tasks: DenoiseTaskDocument[] = [];
  for await (const entry of Deno.readDir(getTasksDir())) {
    if (!entry.isFile || !entry.name.endsWith(".json")) continue;
    try {
      const raw = await Deno.readTextFile(`${getTasksDir()}/${entry.name}`);
      tasks.push(validateDenoiseTaskDocument(JSON.parse(raw)));
    } catch {
      // Skip corrupt or non-document files.
    }
  }
  return tasks.sort((a, b) =>
    Date.parse(b.updated_at) - Date.parse(a.updated_at)
  );
}

/**
 * Reads one task by id, or null when missing.
 */
export async function getTask(
  taskId: string,
): Promise<DenoiseTaskDocument | null> {
  const path = getTaskPath(taskId);
  try {
    const raw = await Deno.readTextFile(path);
    return validateDenoiseTaskDocument(JSON.parse(raw));
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) return null;
    throw error;
  }
}

/**
 * Writes a validated task document. Last-write-wins on updated_at when
 * `options.requireNewer` is set and an older or equal document exists.
 */
export async function upsertTask(
  document: unknown,
  options?: { requireNewer?: boolean },
): Promise<DenoiseTaskDocument> {
  const task = validateDenoiseTaskDocument(document);
  return await withLock(async () => {
    if (options?.requireNewer) {
      const existing = await getTask(task.id);
      if (
        existing &&
        Date.parse(existing.updated_at) > Date.parse(task.updated_at)
      ) {
        return existing;
      }
    }
    await ensureTasksDir();
    await Deno.writeTextFile(
      getTaskPath(task.id),
      `${JSON.stringify(task, null, 2)}\n`,
      { create: true },
    );
    return task;
  });
}

/**
 * Deletes a task document. Returns true when a file was removed.
 */
export async function deleteTask(taskId: string): Promise<boolean> {
  const path = getTaskPath(taskId);
  return await withLock(async () => {
    try {
      await Deno.remove(path);
      return true;
    } catch (error) {
      if (error instanceof Deno.errors.NotFound) return false;
      throw error;
    }
  });
}

/**
 * Applies a relay sync operation from denoise (upsert or delete).
 */
export async function applyTaskSyncOp(
  op: {
    op: "upsert" | "delete";
    task_id: string;
    task_document?: unknown;
  },
): Promise<void> {
  if (op.op === "delete") {
    await deleteTask(op.task_id);
    return;
  }
  if (op.task_document === undefined) {
    throw new Error("Task upsert requires task_document.");
  }
  const task = validateDenoiseTaskDocument(op.task_document);
  if (task.id !== op.task_id) {
    throw new Error("Task upsert id mismatch.");
  }
  await upsertTask(task, { requireNewer: true });
}
