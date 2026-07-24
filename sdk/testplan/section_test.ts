// Copyright 2026 Chesapeake Computing
// SPDX-License-Identifier: Apache-2.0

import { assert, assertThrows } from "@std/assert";
import { normalizeTestPlanSection, upsertTestPlanSection } from "./section.ts";

const SHORT_TEST_PLAN = `## Test Plan

- [ ] Run \`deno test sdk/testplan/section_test.ts\` and verify it passes.
- [ ] Run \`deno check sdk/testplan/section.ts\` and verify type checking passes.
`;

Deno.test("upsertTestPlanSection replaces existing test plan only", () => {
  const source = `# Task

## Acceptance Criteria

- [ ] Feature works.

## Test Plan

- [ ] Old check.

## Notes

Keep this note.
`;

  const updated = upsertTestPlanSection(source, SHORT_TEST_PLAN);

  assert(!updated.includes("Old check"));
  assert(updated.includes("deno check sdk/testplan/section.ts"));
  assert(updated.includes("## Notes\n\nKeep this note."));
});

Deno.test("upsertTestPlanSection inserts after acceptance criteria", () => {
  const source = `# Task

## Overview

Add the feature.

## Acceptance Criteria

- [ ] Feature works.

## Notes

Keep this note.
`;

  const updated = upsertTestPlanSection(source, SHORT_TEST_PLAN);
  assert(updated.includes("## Acceptance Criteria"));
  assert(updated.includes("## Test Plan"));
  assert(updated.includes("## Notes"));
  assert(
    updated.indexOf("## Acceptance Criteria") <
      updated.indexOf("## Test Plan"),
  );
  assert(updated.indexOf("## Test Plan") < updated.indexOf("## Notes"));
});

Deno.test("normalizeTestPlanSection rejects oversized test plans", () => {
  const bullets = Array.from(
    { length: 13 },
    (_, index) => `- [ ] Check ${index + 1}.`,
  ).join("\n");

  assertThrows(
    () => normalizeTestPlanSection(`## Test Plan\n\n${bullets}`),
    Error,
    "12 or fewer",
  );
});

Deno.test("normalizeTestPlanSection allows split recommendation for broad work", () => {
  const bullets = Array.from(
    { length: 3 },
    (_, index) => `- [ ] Check ${index + 1}.`,
  ).join("\n");
  const section = normalizeTestPlanSection(
    `## Test Plan\n\n${bullets}\n\n## Split Recommendation\n\nSplit this plan before implementation.`,
  );

  assert(section.includes("## Split Recommendation"));
});
