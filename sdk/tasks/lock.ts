// Copyright 2026 Chesapeake Computing
// SPDX-License-Identifier: Apache-2.0

import { ensureDnHome, getTaskListLockPath } from "./paths.ts";

const LOCK_STALE_MS = 30_000;

/**
 * Acquires a simple file lock for ~/.dn/todo.md mutations.
 */
export async function withTaskListLock<T>(
  fn: () => Promise<T>,
): Promise<T> {
  await ensureDnHome();
  const lockPath = getTaskListLockPath();
  const stat = await Deno.stat(lockPath).catch(() => null);
  if (stat) {
    const mtime = stat.mtime?.getTime();
    const age = mtime != null ? Date.now() - mtime : 0;
    if (age < LOCK_STALE_MS) {
      throw new Error(
        `Task list is locked (${lockPath}). If no other dn process is running, remove the lock file.`,
      );
    }
  }
  await Deno.writeTextFile(lockPath, String(Date.now()), {
    create: true,
  });
  try {
    return await fn();
  } finally {
    await Deno.remove(lockPath).catch(() => {});
  }
}
