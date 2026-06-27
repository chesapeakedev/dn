// Copyright 2026 Chesapeake Computing
// SPDX-License-Identifier: Apache-2.0

/**
 * Tests for dn land subcommand
 */

import { assert } from "@std/assert";
import {
  assertGitState,
  cleanupTestRepo,
  createProjectTestRepo,
  createTestRepo,
  runDnCommand,
} from "./test_utils.ts";

Deno.test("land command shows help", async () => {
  const testRepo = await createTestRepo();

  try {
    const result = await runDnCommand(["land", "--help"], {
      cwd: testRepo.path,
    });

    assert(result.stdout.includes("dn land"));
    assert(result.stdout.includes("--single"));
    assert(result.stdout.includes("--dry-run"));
    assert(result.success);
  } finally {
    await cleanupTestRepo(testRepo);
  }
});

Deno.test("land --single fails without plan file", async () => {
  const testRepo = await createTestRepo();

  try {
    await runDnCommand(["land", "--single"], {
      cwd: testRepo.path,
      expectFailure: true,
    });
  } finally {
    await cleanupTestRepo(testRepo);
  }
});

Deno.test("land --single fails with non-existent plan file", async () => {
  const testRepo = await createTestRepo();

  try {
    await runDnCommand(["land", "--single", "non-existent.plan.md"], {
      cwd: testRepo.path,
      expectFailure: true,
    });
  } finally {
    await cleanupTestRepo(testRepo);
  }
});

Deno.test("land --single derives commit message from plan file", async () => {
  const testRepo = await createProjectTestRepo();

  try {
    const planContent = `# Plan: Feature Implementation

## Issue
#123: Add user authentication feature

## Summary
Implement user authentication with JWT tokens and secure password handling.
`;

    await Deno.writeTextFile(
      `${testRepo.path}/auth-feature.plan.md`,
      planContent,
    );

    const result = await runDnCommand([
      "land",
      "--single",
      "auth-feature.plan.md",
      "--dry-run",
    ], { cwd: testRepo.path });

    assert(result.success);
    assert(
      result.stdout.includes("Feature Implementation") ||
        result.stdout.includes("authentication") ||
        result.stdout.includes("feature"),
    );
  } finally {
    await cleanupTestRepo(testRepo);
  }
});

Deno.test("land --single commits workspace and deletes plan", async () => {
  const testRepo = await createProjectTestRepo();

  try {
    await Deno.writeTextFile(
      `${testRepo.path}/new-feature.ts`,
      `export function newFeature(): string {
  return "New feature implemented";
}
`,
    );

    const planContent = `# Plan: New Feature

## Issue
#456: Add new feature

## Summary
Implement a simple new feature.
`;

    await Deno.writeTextFile(
      `${testRepo.path}/new-feature.plan.md`,
      planContent,
    );

    await assertGitState(testRepo.path, {
      commits: 1,
      files: ["README.md", "deno.json", "main.ts"],
    });

    const result = await runDnCommand([
      "land",
      "--single",
      "new-feature.plan.md",
    ], { cwd: testRepo.path });

    assert(result.success);

    await assertGitState(testRepo.path, {
      commits: 2,
      files: ["README.md", "deno.json", "main.ts", "new-feature.ts"],
    });

    try {
      await Deno.stat(`${testRepo.path}/new-feature.plan.md`);
      throw new Error("Plan file should have been deleted");
    } catch (error) {
      if (!(error instanceof Deno.errors.NotFound)) {
        throw error;
      }
    }
  } finally {
    await cleanupTestRepo(testRepo);
  }
});

Deno.test("land --single fails commit with no workspace changes", async () => {
  const testRepo = await createProjectTestRepo();

  try {
    const invalidPlanContent = `# Invalid Plan

This is not a valid plan file.
`;

    await Deno.writeTextFile(
      `${testRepo.path}/invalid.plan.md`,
      invalidPlanContent,
    );

    await runDnCommand([
      "land",
      "--single",
      "invalid.plan.md",
    ], {
      cwd: testRepo.path,
      expectFailure: true,
    });
  } finally {
    await cleanupTestRepo(testRepo);
  }
});

Deno.test("land --single with --workspace-root option", async () => {
  const testRepo = await createProjectTestRepo();
  const subDir = `${testRepo.path}/subdir`;

  try {
    await Deno.mkdir(subDir, { recursive: true });

    const planContent = `# Plan: Workspace Root Test

## Summary
Testing workspace root option in land command.
`;

    await Deno.writeTextFile(
      `${testRepo.path}/workspace-test.plan.md`,
      planContent,
    );

    const result = await runDnCommand([
      "land",
      "--single",
      "workspace-test.plan.md",
      "--workspace-root",
      testRepo.path,
      "--dry-run",
    ], { cwd: subDir });

    assert(result.success);
  } finally {
    await cleanupTestRepo(testRepo);
  }
});

Deno.test("land --single dry-run preserves workspace state", async () => {
  const testRepo = await createProjectTestRepo();

  try {
    await Deno.writeTextFile(
      `${testRepo.path}/test-feature.ts`,
      `export function testFeature(): string {
  return "Test feature";
}
`,
    );

    const planContent = `# Plan: Test Feature

## Summary
Implement a test feature.
`;

    await Deno.writeTextFile(
      `${testRepo.path}/test-feature.plan.md`,
      planContent,
    );

    await assertGitState(testRepo.path, {
      commits: 1,
      files: ["README.md", "deno.json", "main.ts"],
    });

    const result = await runDnCommand([
      "land",
      "--single",
      "test-feature.plan.md",
      "--dry-run",
    ], { cwd: testRepo.path });

    assert(result.success);

    await assertGitState(testRepo.path, {
      commits: 1,
      files: [
        "README.md",
        "deno.json",
        "main.ts",
        "test-feature.ts",
        "test-feature.plan.md",
      ],
    });
  } finally {
    await cleanupTestRepo(testRepo);
  }
});

Deno.test("land --single commits unstaged workspace changes", async () => {
  const testRepo = await createProjectTestRepo();

  try {
    await Deno.writeTextFile(
      `${testRepo.path}/unstaged.ts`,
      `export function unstagedFeature(): string {
  return "Unstaged feature";
}
`,
    );

    const planContent = `# Plan: Unstaged Changes

## Summary
Test land with unstaged changes.
`;

    await Deno.writeTextFile(`${testRepo.path}/unstaged.plan.md`, planContent);

    const result = await runDnCommand([
      "land",
      "--single",
      "unstaged.plan.md",
    ], { cwd: testRepo.path });

    assert(result.success);

    await assertGitState(testRepo.path, {
      commits: 2,
      files: ["README.md", "deno.json", "main.ts", "unstaged.ts"],
    });
  } finally {
    await cleanupTestRepo(testRepo);
  }
});

Deno.test("land default creates multiple commits from fake agent output", async () => {
  const testRepo = await createProjectTestRepo();

  try {
    await Deno.mkdir(`${testRepo.path}/plans`, { recursive: true });
    await Deno.writeTextFile(
      `${testRepo.path}/src-feature.ts`,
      "export const feature = true;\n",
    );
    await Deno.writeTextFile(
      `${testRepo.path}/src-feature.test.ts`,
      "export const featureTest = true;\n",
    );

    const planContent = `# Plan: Split Feature

## Summary
Add feature and tests.
`;
    await Deno.writeTextFile(
      `${testRepo.path}/plans/split-feature.plan.md`,
      planContent,
    );

    const fakeOutput = JSON.stringify([
      {
        files: ["src-feature.ts"],
        summary: "feat: add feature module",
      },
      {
        files: ["src-feature.test.ts"],
        summary: "test: add feature module tests",
      },
    ]);

    const result = await runDnCommand(["land"], {
      cwd: testRepo.path,
      env: { DN_LAND_FAKE_OUTPUT: fakeOutput },
    });

    assert(result.success);
    await assertGitState(testRepo.path, {
      commits: 3,
      files: [
        "README.md",
        "deno.json",
        "main.ts",
        "src-feature.ts",
        "src-feature.test.ts",
      ],
    });

    try {
      await Deno.stat(`${testRepo.path}/plans/split-feature.plan.md`);
      throw new Error("Plan file should have been deleted");
    } catch (error) {
      if (!(error instanceof Deno.errors.NotFound)) {
        throw error;
      }
    }
  } finally {
    await cleanupTestRepo(testRepo);
  }
});

Deno.test("land default dry-run preserves workspace", async () => {
  const testRepo = await createProjectTestRepo();

  try {
    await Deno.mkdir(`${testRepo.path}/plans`, { recursive: true });
    await Deno.writeTextFile(
      `${testRepo.path}/changed.ts`,
      "export const x = 1;\n",
    );
    await Deno.writeTextFile(
      `${testRepo.path}/plans/dry-run.plan.md`,
      "# Plan: Dry Run\n\n## Summary\nTest dry run.\n",
    );

    const fakeOutput = JSON.stringify([
      {
        files: ["changed.ts"],
        summary: "feat: add changed module",
      },
    ]);

    const result = await runDnCommand(["land", "--dry-run"], {
      cwd: testRepo.path,
      env: { DN_LAND_FAKE_OUTPUT: fakeOutput },
    });

    assert(result.success);
    assert(result.stdout.includes("feat: add changed module"));

    await assertGitState(testRepo.path, {
      commits: 1,
      files: [
        "README.md",
        "deno.json",
        "main.ts",
        "changed.ts",
        "plans/dry-run.plan.md",
      ],
    });
  } finally {
    await cleanupTestRepo(testRepo);
  }
});
