// Copyright 2026 Chesapeake Computing
// SPDX-License-Identifier: Apache-2.0

import { assertEquals } from "@std/assert";
import {
  addToTaskList,
  markQueueItemDoneIfPresent,
  readTaskList,
} from "./queue.ts";

async function withTempHome(fn: () => Promise<void>): Promise<void> {
  const previous = Deno.env.get("HOME");
  const tmp = await Deno.makeTempDir({ prefix: "dn-closeout-home-" });
  Deno.env.set("HOME", tmp);
  try {
    await fn();
  } finally {
    if (previous === undefined) Deno.env.delete("HOME");
    else Deno.env.set("HOME", previous);
    await Deno.remove(tmp, { recursive: true }).catch(() => {});
  }
}

Deno.test("markQueueItemDoneIfPresent is optional", async () => {
  await withTempHome(async () => {
    assertEquals(
      await markQueueItemDoneIfPresent("https://github.com/o/r/issues/99"),
      false,
    );
    await addToTaskList([{
      ref: "https://github.com/o/r/issues/42",
      score: 1,
    }]);
    assertEquals(
      await markQueueItemDoneIfPresent("https://github.com/o/r/issues/42"),
      true,
    );
    const list = await readTaskList();
    assertEquals(list.items[0]?.checked, true);
  });
});
