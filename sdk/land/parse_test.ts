// Copyright 2026 Chesapeake Computing
// SPDX-License-Identifier: Apache-2.0

import { assertEquals } from "@std/assert";
import { parseCommitPlan } from "./parse.ts";

Deno.test("parseCommitPlan accepts null body", () => {
  const plan = parseCommitPlan(
    [
      {
        files: ["a.ts"],
        summary: "feat: add a",
        body: null,
      },
      {
        files: ["b.ts"],
        summary: "test: add b",
      },
    ],
    ["a.ts", "b.ts"],
  );

  assertEquals(plan.length, 2);
  assertEquals(plan[0].body, undefined);
  assertEquals(plan[1].body, undefined);
});

Deno.test("parseCommitPlan rejects empty body string as undefined", () => {
  const plan = parseCommitPlan(
    [
      {
        files: ["a.ts"],
        summary: "feat: add a",
        body: "   ",
      },
    ],
    ["a.ts"],
  );

  assertEquals(plan[0].body, undefined);
});
