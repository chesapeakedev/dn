// Copyright 2026 Chesapeake Computing
// SPDX-License-Identifier: Apache-2.0

/**
 * Paths for the unified user task list at ~/.dn/todo.md.
 */

/** Returns the dn home directory (~/.dn on Unix). */
export function getDnHomeDir(): string {
  const home = Deno.env.get("HOME");
  const appData = Deno.env.get("APPDATA");
  if (appData) {
    return `${appData.replace(/\//g, "\\")}\\dn`;
  }
  if (home) {
    return `${home}/.dn`;
  }
  return ".dn";
}

/** Path to the unified markdown task list file. */
export function getTaskListPath(): string {
  return `${getDnHomeDir()}/todo.md`;
}

/** @deprecated Use {@link getTaskListPath}. */
export function getTodoPath(): string {
  return getTaskListPath();
}

/** Lock file for all task list mutations. */
export function getTaskListLockPath(): string {
  return `${getDnHomeDir()}/todo.md.lock`;
}

/** Legacy JSON task directory (import once, then rename). */
export function getLegacyTasksDir(): string {
  return `${getDnHomeDir()}/tasks`;
}

export function getLegacyTasksMigratedDir(): string {
  return `${getDnHomeDir()}/tasks.migrated`;
}

/** Ensures ~/.dn exists. */
export async function ensureDnHome(): Promise<void> {
  await Deno.mkdir(getDnHomeDir(), { recursive: true });
}
