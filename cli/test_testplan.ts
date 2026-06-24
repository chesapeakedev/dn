// Copyright 2026 Chesapeake Computing
// SPDX-License-Identifier: Apache-2.0

/**
 * Tests for dn testplan subcommand
 */

import { assert, assertThrows } from "@std/assert";
import { cleanupTestRepo, createTestRepo, runDnCommand } from "./test_utils.ts";
import {
  normalizeTestPlanSection,
  upsertTestPlanSection,
} from "../sdk/testplan/section.ts";

const SHORT_TEST_PLAN = `## Test Plan

- [ ] Run \`deno test cli/test_testplan.ts\` and verify it passes.
- [ ] Run \`deno check cli/testplan.ts\` and verify type checking passes.
`;

Deno.test("testplan command shows help", async () => {
  const testRepo = await createTestRepo();

  try {
    const result = await runDnCommand(["testplan", "--help"], {
      cwd: testRepo.path,
    });

    assert(result.success);
    assert(result.stdout.includes("dn testplan"));
    assert(result.stdout.includes("--dry-run"));
  } finally {
    await cleanupTestRepo(testRepo);
  }
});

Deno.test("testplan command fails without source", async () => {
  const testRepo = await createTestRepo();

  try {
    const result = await runDnCommand(["testplan"], {
      cwd: testRepo.path,
      expectFailure: true,
    });

    assert(result.stderr.includes("Plan file or GitHub issue URL required"));
  } finally {
    await cleanupTestRepo(testRepo);
  }
});

Deno.test("testplan dry-run prints generated section without editing file", async () => {
  const testRepo = await createTestRepo();
  const planPath = `${testRepo.path}/task.plan.md`;
  const planContent = `# Task

## Overview

Add the feature.

## Acceptance Criteria

- [ ] Feature works.
`;

  try {
    await Deno.writeTextFile(planPath, planContent);
    const result = await runDnCommand([
      "testplan",
      "task.plan.md",
      "--dry-run",
    ], {
      cwd: testRepo.path,
      env: { DN_TESTPLAN_FAKE_OUTPUT: SHORT_TEST_PLAN },
    });

    assert(result.success);
    assert(result.stdout.includes("## Test Plan"));
    assert(result.stdout.includes("deno test cli/test_testplan.ts"));
    assert((await Deno.readTextFile(planPath)) === planContent);
  } finally {
    await cleanupTestRepo(testRepo);
  }
});

Deno.test("testplan command inserts test plan after acceptance criteria", async () => {
  const testRepo = await createTestRepo();
  const planPath = `${testRepo.path}/task.plan.md`;
  const planContent = `# Task

## Overview

Add the feature.

## Acceptance Criteria

- [ ] Feature works.

## Notes

Keep this note.
`;

  try {
    await Deno.writeTextFile(planPath, planContent);
    const result = await runDnCommand(["testplan", "task.plan.md"], {
      cwd: testRepo.path,
      env: { DN_TESTPLAN_FAKE_OUTPUT: SHORT_TEST_PLAN },
    });

    assert(result.success);
    const updated = await Deno.readTextFile(planPath);
    assert(updated.includes("## Acceptance Criteria"));
    assert(updated.includes("## Test Plan"));
    assert(updated.includes("## Notes"));
    assert(
      updated.indexOf("## Acceptance Criteria") <
        updated.indexOf("## Test Plan"),
    );
    assert(updated.indexOf("## Test Plan") < updated.indexOf("## Notes"));
  } finally {
    await cleanupTestRepo(testRepo);
  }
});

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
  assert(updated.includes("deno check cli/testplan.ts"));
  assert(updated.includes("## Notes\n\nKeep this note."));
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

Deno.test("testplan command rejects issue numbers", async () => {
  const testRepo = await createTestRepo();

  try {
    const result = await runDnCommand(["testplan", "123"], {
      cwd: testRepo.path,
      expectFailure: true,
    });

    assert(result.stderr.includes("Issue numbers are not accepted"));
  } finally {
    await cleanupTestRepo(testRepo);
  }
});
