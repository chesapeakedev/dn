// Copyright 2026 Chesapeake Computing
// SPDX-License-Identifier: Apache-2.0

import { validateDenoiseTaskDocument } from "../runner/types.ts";
import {
  nativeTaskRef,
  parseTaskListFile,
  serializeTaskListFile,
  type TaskListFile,
} from "./listFile.ts";
import { withTaskListLock } from "./lock.ts";
import {
  ensureDnHome,
  getLegacyTasksDir,
  getLegacyTasksMigratedDir,
  getTaskListPath,
} from "./paths.ts";

async function legacyTasksDirExists(): Promise<boolean> {
  try {
    const stat = await Deno.stat(getLegacyTasksDir());
    return stat.isDirectory;
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) return false;
    throw error;
  }
}

async function migratedMarkerExists(): Promise<boolean> {
  try {
    await Deno.stat(getLegacyTasksMigratedDir());
    return true;
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) return false;
    throw error;
  }
}

/**
 * Imports ~/.dn/tasks/*.json into the unified list once, then renames the directory.
 */
export async function migrateLegacyJsonTaskDirIfNeeded(): Promise<void> {
  if (await migratedMarkerExists()) return;
  if (!(await legacyTasksDirExists())) return;

  await withTaskListLock(async () => {
    if (await migratedMarkerExists()) return;
    const dir = getLegacyTasksDir();
    let file: TaskListFile;
    try {
      const content = await Deno.readTextFile(getTaskListPath());
      file = parseTaskListFile(content);
    } catch (error) {
      if (error instanceof Deno.errors.NotFound) {
        file = { meta: {}, items: [], nativeTasks: {} };
      } else {
        throw error;
      }
    }

    const existingRefs = new Set(file.items.map((i) => i.ref));
    for await (const entry of Deno.readDir(dir)) {
      if (!entry.isFile || !entry.name.endsWith(".json")) continue;
      if (entry.name === ".lock") continue;
      try {
        const raw = await Deno.readTextFile(`${dir}/${entry.name}`);
        const doc = validateDenoiseTaskDocument(JSON.parse(raw));
        file.nativeTasks[doc.id] = doc;
        const ref = nativeTaskRef(doc.id);
        if (!existingRefs.has(ref)) {
          file.items.push({
            checked: doc.status === "done" || doc.status === "cancelled",
            ref,
            title: doc.title,
          });
          existingRefs.add(ref);
        }
      } catch {
        // Skip corrupt files.
      }
    }

    await ensureDnHome();
    await Deno.writeTextFile(
      getTaskListPath(),
      serializeTaskListFile(file),
      { create: true },
    );
    await Deno.rename(dir, getLegacyTasksMigratedDir());
  });
}
