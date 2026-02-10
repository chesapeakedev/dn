// Copyright 2026 Chesapeake Computing
// SPDX-License-Identifier: Apache-2.0

/**
 * Tests for dn prep subcommand
 *
 * These tests create temporary git repositories and run the prep command
 * to verify its behavior in isolated environments.
 */

import { assert } from "@std/assert";
import {
  assertGitState,
  cleanupTestRepo,
  createProjectTestRepo,
  createTestRepo,
  runDnCommand,
} from "./test_utils.ts";

Deno.test("prep command shows help", async () => {
  const testRepo = await createTestRepo();

  try {
    const result = await runDnCommand(["prep", "--help"], {
      cwd: testRepo.path,
    });

    assert(result.stdout.includes("dn prep"));
    assert(result.stdout.includes("--plan-name"));
    assert(result.success);
  } finally {
    await cleanupTestRepo(testRepo);
  }
});

Deno.test("prep command fails without arguments", async () => {
  const testRepo = await createTestRepo();

  try {
    await runDnCommand(["prep"], {
      cwd: testRepo.path,
      expectFailure: true,
    });
  } finally {
    await cleanupTestRepo(testRepo);
  }
});

Deno.test("prep command fails with invalid issue number", async () => {
  const testRepo = await createTestRepo();

  try {
    await runDnCommand(["prep", "notanumber"], {
      cwd: testRepo.path,
      expectFailure: true,
    });
  } finally {
    await cleanupTestRepo(testRepo);
  }
});

Deno.test("prep command creates plan file", async () => {
  const testRepo = await createProjectTestRepo();

  try {
    // Create a mock issue file for testing
    const issueContent = `# Test Issue

## Description
This is a test issue for the prep command.

## Acceptance Criteria
- [ ] Test criterion 1
- [ ] Test criterion 2

## Implementation Notes
Some implementation notes here.
`;

    await Deno.writeTextFile(`${testRepo.path}/test-issue.md`, issueContent);

    // Run prep command with local file
    const result = await runDnCommand([
      "prep",
      "test-issue.md",
      "--plan-name",
      "test-plan",
    ], { cwd: testRepo.path });

    assert(result.success);

    // Check that plan file was created
    const planPath = `${testRepo.path}/test-plan.plan.md`;
    try {
      await Deno.stat(planPath);
    } catch {
      throw new Error("Plan file was not created");
    }

    // Check plan file content
    const planContent = await Deno.readTextFile(planPath);
    assert(planContent.includes("# Plan"));
    assert(planContent.includes("Test Issue"));
  } finally {
    await cleanupTestRepo(testRepo);
  }
});

Deno.test("prep command with --dry-run does not create files", async () => {
  const testRepo = await createProjectTestRepo();

  try {
    const issueContent = `# Test Issue

## Description
This is a test issue for dry run testing.
`;

    await Deno.writeTextFile(`${testRepo.path}/test-issue.md`, issueContent);

    // Run prep command with --dry-run
    const result = await runDnCommand([
      "prep",
      "test-issue.md",
      "--dry-run",
      "--plan-name",
      "test-plan",
    ], { cwd: testRepo.path });

    assert(result.success);

    // Check that plan file was NOT created
    const planPath = `${testRepo.path}/test-plan.plan.md`;
    try {
      await Deno.stat(planPath);
      throw new Error("Plan file should not be created in dry-run mode");
    } catch (error) {
      if (!(error instanceof Deno.errors.NotFound)) {
        throw error;
      }
      // Expected - file should not exist
    }
  } finally {
    await cleanupTestRepo(testRepo);
  }
});

Deno.test("prep command respects --workspace-root option", async () => {
  // Create nested directory structure
  const testRepo = await createProjectTestRepo();
  const subDir = `${testRepo.path}/subdir`;

  try {
    await Deno.mkdir(subDir, { recursive: true });

    const issueContent = `# Test Issue

## Description
Testing workspace root option.
`;

    await Deno.writeTextFile(`${subDir}/test-issue.md`, issueContent);

    // Run prep command from subdirectory with explicit workspace root
    const result = await runDnCommand([
      "prep",
      "test-issue.md",
      "--plan-name",
      "test-plan",
      "--workspace-root",
      testRepo.path,
    ], { cwd: subDir });

    assert(result.success);

    // Plan file should be created in workspace root, not subdirectory
    const planPath = `${testRepo.path}/test-plan.plan.md`;
    try {
      await Deno.stat(planPath);
    } catch {
      throw new Error("Plan file was not created in workspace root");
    }

    // Plan file should NOT exist in subdirectory
    const subDirPlanPath = `${subDir}/test-plan.plan.md`;
    try {
      await Deno.stat(subDirPlanPath);
      throw new Error("Plan file should not be created in subdirectory");
    } catch (error) {
      if (!(error instanceof Deno.errors.NotFound)) {
        throw error;
      }
      // Expected - file should not exist
    }
  } finally {
    await cleanupTestRepo(testRepo);
  }
});

Deno.test("prep command handles GitHub issue URL format", async () => {
  const testRepo = await createProjectTestRepo();

  try {
    // Test with a mock GitHub issue URL (this will likely fail due to auth,
    // but we can test that it parses the URL correctly)
    const result = await runDnCommand([
      "prep",
      "https://github.com/owner/repo/issues/123",
      "--dry-run", // Use dry-run to avoid actual API calls
    ], {
      cwd: testRepo.path,
      expectFailure: true, // Expected to fail due to auth/network
    });

    // The error should be related to GitHub API, not URL parsing
    assert(
      result.stderr.includes("GitHub") || result.stderr.includes("issue") ||
        result.stderr.includes("auth") || result.stderr.includes("token"),
    );
  } finally {
    await cleanupTestRepo(testRepo);
  }
});

Deno.test("prep command validates plan name format", async () => {
  const testRepo = await createProjectTestRepo();

  try {
    const issueContent = `# Test Issue

## Description
Testing plan name validation.
`;

    await Deno.writeTextFile(`${testRepo.path}/test-issue.md`, issueContent);

    // Test with invalid plan name (contains invalid characters)
    await runDnCommand([
      "prep",
      "test-issue.md",
      "--plan-name",
      "invalid/name",
    ], {
      cwd: testRepo.path,
      expectFailure: true,
    });
  } finally {
    await cleanupTestRepo(testRepo);
  }
});

Deno.test("prep command creates git state expectations", async () => {
  const testRepo = await createProjectTestRepo();

  try {
    const issueContent = `# Test Issue

## Description
Testing git state changes.
`;

    await Deno.writeTextFile(`${testRepo.path}/test-issue.md`, issueContent);

    // Get initial git state
    await assertGitState(testRepo.path, {
      commits: 1, // Initial commit from createProjectTestRepo
      files: ["README.md", "deno.json", "main.ts"],
    });

    // Run prep command
    const result = await runDnCommand([
      "prep",
      "test-issue.md",
      "--plan-name",
      "test-plan",
    ], { cwd: testRepo.path });

    assert(result.success);

    // Check git state after prep
    await assertGitState(testRepo.path, {
      commits: 1, // Should not create commits
      files: ["README.md", "deno.json", "main.ts", "test-plan.plan.md"],
      status: {
        "test-plan.plan.md": "??", // Untracked file
      },
    });
  } finally {
    await cleanupTestRepo(testRepo);
  }
});
