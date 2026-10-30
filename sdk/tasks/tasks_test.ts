// Copyright 2026 Chesapeake Computing
// SPDX-License-Identifier: Apache-2.0

import { assertEquals, assertRejects } from "@std/assert";
import {
  applyTaskSyncOp,
  deleteTask,
  getNativeTask,
  getTaskListPath,
  listNativeTasks,
  parseTaskListFile,
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
    body: overrides.body ?? "Write tasks to ~/.dn/todo.md.",
    status: overrides.status ?? "open" as const,
    updated_at: overrides.updated_at ?? "2026-08-11T12:00:00.000Z",
    created_at: "2026-08-11T11:00:00.000Z",
  };
}

Deno.test("native tasks upsert, list, and delete in unified todo.md", async () => {
  await withTempHome(async () => {
    await upsertTask(sampleTask());
    await upsertTask(sampleTask({
      id: "task-2",
      title: "Second",
      updated_at: "2026-08-11T13:00:00.000Z",
    }));
    const listed = await listNativeTasks();
    assertEquals(listed.map((t) => t.id), ["task-2", "task-1"]);
    assertEquals((await getNativeTask("task-1"))?.title, "Ship local sync");
    assertEquals(await deleteTask("task-1"), true);
    assertEquals(await getNativeTask("task-1"), null);
    assertEquals((await listNativeTasks()).map((t) => t.id), ["task-2"]);
    const raw = await Deno.readTextFile(getTaskListPath());
    assertEquals(raw.includes("<!-- dn-task:task-2 -->"), true);
    assertEquals(raw.includes("task:task-2"), true);
  });
});

Deno.test("native tasks reject path traversal ids", async () => {
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
    assertEquals((await getNativeTask("task-1"))?.title, "Newer");
    await applyTaskSyncOp({
      op: "upsert",
      task_id: "task-1",
      task_document: sampleTask({
        updated_at: "2026-08-11T15:00:00.000Z",
        title: "Latest",
      }),
    });
    assertEquals((await getNativeTask("task-1"))?.title, "Latest");
    await applyTaskSyncOp({ op: "delete", task_id: "task-1" });
    assertEquals(await getNativeTask("task-1"), null);
  });
});

Deno.test("parseTaskListFile round-trips native blocks", () => {
  const content = `---
updated: 2026-08-11
---

- [ ] task:abc-1 Fix parser

<!-- dn-task:abc-1 -->
\`\`\`json
{
  "schema_version": "1.0",
  "id": "abc-1",
  "title": "Fix parser",
  "body": "Body text",
  "status": "open",
  "updated_at": "2026-08-11T12:00:00.000Z"
}
\`\`\`
`;
  const parsed = parseTaskListFile(content);
  assertEquals(parsed.items.length, 1);
  assertEquals(parsed.items[0].ref, "task:abc-1");
  assertEquals(parsed.nativeTasks["abc-1"]?.title, "Fix parser");
});
