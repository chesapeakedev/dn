// Copyright 2026 Chesapeake Computing
// SPDX-License-Identifier: Apache-2.0

import { assertEquals } from "@std/assert";
import { completionStatusFromPlanContent } from "./planCompletion.ts";

Deno.test("completionStatusFromPlanContent uses Acceptance Criteria section", () => {
  const content = `# Feature

## Overview
Work

## Acceptance Criteria

- [x] Done item
- [ ] Remaining item
`;

  const status = completionStatusFromPlanContent(content);
  assertEquals(status, {
    complete: false,
    total: 2,
    completed: 1,
    incomplete: ["Remaining item"],
  });
});

Deno.test("completionStatusFromPlanContent marks plan complete when all AC done", () => {
  const content = `# Feature

## Acceptance Criteria

- [x] First
- [x] Second
`;

  const status = completionStatusFromPlanContent(content);
  assertEquals(status.complete, true);
  assertEquals(status.total, 2);
  assertEquals(status.completed, 2);
  assertEquals(status.incomplete, []);
});

Deno.test("completionStatusFromPlanContent falls back to document checkboxes", () => {
  const content = `# project todo

- [x] finished task
- [ ] open task
`;

  const status = completionStatusFromPlanContent(content);
  assertEquals(status.complete, false);
  assertEquals(status.total, 2);
  assertEquals(status.completed, 1);
  assertEquals(status.incomplete, ["open task"]);
});
