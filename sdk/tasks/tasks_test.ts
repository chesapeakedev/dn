// Copyright 2026 Chesapeake Computing
// SPDX-License-Identifier: Apache-2.0

import { assertEquals, assertRejects } from "@std/assert";
import {
  applyTaskSyncOp,
  deleteTask,
  getTask,
  getTasksDir,
  listTasks,
  upsertTask,
} from "./tasks.ts";

async function withTempHome(fn: () => Promise<void>): Promise<void> {
  const previous = Deno.env.get("HOME");
  const tmp = await Deno.makeTempDir({ prefix: "dn-tasks-home-" });
  Deno.env.set("HOME", tmp);
  try {
    await fn();
  } finally {
    if (previous === undefined) Deno.env.delete("HOME");
    else Deno.env.set("HOME", previous);
    await Deno.remove(tmp, { recursive: true }).catch(() => {});
  }
}

function sampleTask(
  overrides: Partial<{
    id: string;
    title: string;
    body: string;
    status: "open" | "in_progress" | "done" | "cancelled";
    updated_at: string;
  }> = {},
) {
  return {
    schema_version: "1.0" as const,
    id: overrides.id ?? "task-1",
    title: overrides.title ?? "Ship local sync",
    body: overrides.body ?? "Write tasks to ~/.dn/tasks.",
    status: overrides.status ?? "open" as const,
    updated_at: overrides.updated_at ?? "2026-08-11T12:00:00.000Z",
    created_at: "2026-08-11T11:00:00.000Z",
  };
}

Deno.test("tasks store upserts, lists, and deletes documents", async () => {
  await withTempHome(async () => {
    await upsertTask(sampleTask());
    await upsertTask(sampleTask({
      id: "task-2",
      title: "Second",
      updated_at: "2026-08-11T13:00:00.000Z",
    }));
    const listed = await listTasks();
    assertEquals(listed.map((t) => t.id), ["task-2", "task-1"]);
    assertEquals((await getTask("task-1"))?.title, "Ship local sync");
    assertEquals(await deleteTask("task-1"), true);
    assertEquals(await getTask("task-1"), null);
    assertEquals((await listTasks()).map((t) => t.id), ["task-2"]);
  });
});

Deno.test("tasks store rejects path traversal ids", async () => {
  await withTempHome(async () => {
    await assertRejects(
      () => upsertTask(sampleTask({ id: "../escape" })),
      Error,
      "Invalid task id",
    );
  });
});

Deno.test("applyTaskSyncOp last-write-wins on updated_at", async () => {
  await withTempHome(async () => {
    await upsertTask(sampleTask({
      updated_at: "2026-08-11T14:00:00.000Z",
      title: "Newer",
    }));
    await applyTaskSyncOp({
      op: "upsert",
      task_id: "task-1",
      task_document: sampleTask({
        updated_at: "2026-08-11T13:00:00.000Z",
        title: "Older",
      }),
    });
    assertEquals((await getTask("task-1"))?.title, "Newer");
    await applyTaskSyncOp({
      op: "upsert",
      task_id: "task-1",
      task_document: sampleTask({
        updated_at: "2026-08-11T15:00:00.000Z",
        title: "Latest",
      }),
    });
    assertEquals((await getTask("task-1"))?.title, "Latest");
    await applyTaskSyncOp({ op: "delete", task_id: "task-1" });
    assertEquals(await getTask("task-1"), null);
    assertEquals(getTasksDir().endsWith("/tasks"), true);
  });
});
