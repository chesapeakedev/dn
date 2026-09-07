// Copyright 2026 Chesapeake Computing
// SPDX-License-Identifier: Apache-2.0

import { assertEquals } from "@std/assert";
import {
  acceptanceCriteriaReportFromPlanContent,
  completionStatusFromPlanContent,
} from "./planCompletion.ts";

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

Deno.test("acceptance criteria report preserves final checklist identity", () => {
  const report = acceptanceCriteriaReportFromPlanContent(
    `# Feature\n\n## Acceptance Criteria\n\n- [x] First\n- [ ] Second\n\n## Notes\n\n- [ ] not a criterion\n`,
    "plans/feature.plan.md",
  );
  assertEquals(report, {
    schema_version: "1.0",
    plan_path: "plans/feature.plan.md",
    completed: 1,
    total: 2,
    criteria: [
      { text: "First", completed: true },
      { text: "Second", completed: false },
    ],
    checklist_complete: false,
  });
});
