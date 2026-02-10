// Copyright 2026 Chesapeake Computing
// SPDX-License-Identifier: Apache-2.0

/**
 * Tests for dn loop subcommand
 *
 * These tests create temporary git repositories with plan files and run the loop command
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

Deno.test("loop command shows help", async () => {
  const testRepo = await createTestRepo();

  try {
    const result = await runDnCommand(["loop", "--help"], {
      cwd: testRepo.path,
    });

    assert(result.stdout.includes("dn loop"));
    assert(result.stdout.includes("--plan-file"));
    assert(result.stdout.includes("--iterations"));
    assert(result.success);
  } finally {
    await cleanupTestRepo(testRepo);
  }
});

Deno.test("loop command fails without --plan-file", async () => {
  const testRepo = await createTestRepo();

  try {
    await runDnCommand(["loop"], {
      cwd: testRepo.path,
      expectFailure: true,
    });
  } finally {
    await cleanupTestRepo(testRepo);
  }
});

Deno.test("loop command fails with non-existent plan file", async () => {
  const testRepo = await createTestRepo();

  try {
    await runDnCommand(["loop", "--plan-file", "non-existent.plan.md"], {
      cwd: testRepo.path,
      expectFailure: true,
    });
  } finally {
    await cleanupTestRepo(testRepo);
  }
});

Deno.test("loop command works with valid plan file", async () => {
  const testRepo = await createProjectTestRepo();

  try {
    // Create a mock plan file
    const planContent = `# Plan: Test Feature Implementation

## Issue
#123: Add test feature

## Summary
This plan implements a test feature for demonstration purposes.

## Implementation Steps

### Step 1: Create basic structure
- Create the main module file
- Add basic functionality
- Write initial tests

### Step 2: Add advanced features
- Implement advanced functionality
- Add error handling
- Optimize performance

### Step 3: Documentation and cleanup
- Update documentation
- Add examples
- Code review and cleanup

## Acceptance Criteria
- [ ] Basic functionality works
- [ ] Advanced features implemented
- [ ] Documentation is complete
- [ ] Tests pass

## Files to Create
- src/test-feature.ts
- tests/test-feature.test.ts
- README.md

## Dependencies
- @std/testing
- @std/assert

## Notes
This is a test plan for loop command testing.
`;

    await Deno.writeTextFile(`${testRepo.path}/test-plan.plan.md`, planContent);

    // Run loop command with dry-run to avoid actual implementation
    const result = await runDnCommand([
      "loop",
      "--plan-file",
      "test-plan.plan.md",
      "--dry-run",
      "--iterations",
      "1",
    ], { cwd: testRepo.path });

    assert(result.success);
    assert(result.stdout.includes("loop") || result.stdout.includes("plan"));
  } finally {
    await cleanupTestRepo(testRepo);
  }
});

Deno.test("loop command respects --iterations option", async () => {
  const testRepo = await createProjectTestRepo();

  try {
    const planContent = `# Plan: Iteration Test

## Issue
#456: Test iterations

## Summary
Testing the iterations option.

## Implementation Steps
1. Create file
2. Modify file
3. Finalize file

## Acceptance Criteria
- [ ] File created
- [ ] File modified
- [ ] File finalized
`;

    await Deno.writeTextFile(
      `${testRepo.path}/iteration-test.plan.md`,
      planContent,
    );

    // Run with specific iteration count
    const result = await runDnCommand([
      "loop",
      "--plan-file",
      "iteration-test.plan.md",
      "--dry-run",
      "--iterations",
      "2",
    ], { cwd: testRepo.path });

    assert(result.success);
  } finally {
    await cleanupTestRepo(testRepo);
  }
});

Deno.test("loop command with --continue-on-error", async () => {
  const testRepo = await createProjectTestRepo();

  try {
    const planContent = `# Plan: Error Handling Test

## Issue
#789: Test error handling

## Summary
Testing continue-on-error functionality.

## Implementation Steps
1. Step that might fail
2. Step that should continue
3. Final step

## Acceptance Criteria
- [ ] Error handling works
- [ ] Continuation works
`;

    await Deno.writeTextFile(
      `${testRepo.path}/error-test.plan.md`,
      planContent,
    );

    // Run with continue-on-error option
    const result = await runDnCommand([
      "loop",
      "--plan-file",
      "error-test.plan.md",
      "--dry-run",
      "--continue-on-error",
    ], { cwd: testRepo.path });

    assert(result.success);
  } finally {
    await cleanupTestRepo(testRepo);
  }
});

Deno.test("loop command validates plan file format", async () => {
  const testRepo = await createProjectTestRepo();

  try {
    // Create invalid plan file (missing required sections)
    const invalidPlanContent = `# Invalid Plan

This is not a valid plan file.
Missing required sections.
`;

    await Deno.writeTextFile(
      `${testRepo.path}/invalid.plan.md`,
      invalidPlanContent,
    );

    await runDnCommand([
      "loop",
      "--plan-file",
      "invalid.plan.md",
      "--dry-run",
    ], {
      cwd: testRepo.path,
      expectFailure: true,
    });
  } finally {
    await cleanupTestRepo(testRepo);
  }
});

Deno.test("loop command creates expected git state", async () => {
  const testRepo = await createProjectTestRepo();

  try {
    const planContent = `# Plan: Git State Test

## Issue
#999: Test git state changes

## Summary
Testing git state modifications during loop.

## Implementation Steps
1. Create new file
2. Modify existing file
3. Create commit

## Files to Create
- new-file.ts

## Files to Modify
- main.ts

## Acceptance Criteria
- [ ] New file created
- [ ] Existing file modified
- [ ] Changes committed
`;

    await Deno.writeTextFile(
      `${testRepo.path}/git-state-test.plan.md`,
      planContent,
    );

    // Get initial git state
    await assertGitState(testRepo.path, {
      commits: 1,
      files: ["README.md", "deno.json", "main.ts"],
    });

    // Run loop command (dry-run to avoid actual changes)
    const result = await runDnCommand([
      "loop",
      "--plan-file",
      "git-state-test.plan.md",
      "--dry-run",
    ], { cwd: testRepo.path });

    assert(result.success);

    // Git state should be unchanged in dry-run mode
    await assertGitState(testRepo.path, {
      commits: 1,
      files: ["README.md", "deno.json", "main.ts"],
    });
  } finally {
    await cleanupTestRepo(testRepo);
  }
});

Deno.test("loop command handles complex plan with multiple sections", async () => {
  const testRepo = await createProjectTestRepo();

  try {
    const complexPlanContent = `# Plan: Complex Feature Implementation

## Issue
#1000: Complex feature with multiple components

## Summary
This plan implements a complex feature with multiple components and dependencies.

## Implementation Steps

### Phase 1: Foundation
1. Set up project structure
2. Create base classes
3. Define interfaces
4. Set up configuration

### Phase 2: Core Implementation
1. Implement main functionality
2. Add business logic
3. Create data models
4. Set up API endpoints

### Phase 3: Advanced Features
1. Add caching layer
2. Implement authentication
3. Add monitoring
4. Performance optimization

### Phase 4: Testing and Documentation
1. Write unit tests
2. Add integration tests
3. Create documentation
4. Add examples

## Files to Create
- src/core/base.ts
- src/core/interfaces.ts
- src/api/endpoints.ts
- src/auth/auth.ts
- src/cache/cache.ts
- tests/unit/
- tests/integration/
- docs/api.md

## Files to Modify
- main.ts
- deno.json

## Dependencies
- @std/http
- @std/testing
- @std/assert

## Acceptance Criteria
- [ ] Project structure set up
- [ ] Core functionality implemented
- [ ] Advanced features working
- [ ] Tests passing
- [ ] Documentation complete

## Notes
This is a complex plan to test loop command's ability to handle large plans.
`;

    await Deno.writeTextFile(
      `${testRepo.path}/complex-plan.plan.md`,
      complexPlanContent,
    );

    // Run loop command on complex plan
    const result = await runDnCommand([
      "loop",
      "--plan-file",
      "complex-plan.plan.md",
      "--dry-run",
      "--iterations",
      "1",
    ], { cwd: testRepo.path });

    assert(result.success);
  } finally {
    await cleanupTestRepo(testRepo);
  }
});

Deno.test("loop command with --workspace-root option", async () => {
  // Create nested directory structure
  const testRepo = await createProjectTestRepo();
  const subDir = `${testRepo.path}/subdir`;

  try {
    await Deno.mkdir(subDir, { recursive: true });

    const planContent = `# Plan: Workspace Root Test

## Issue
#1111: Test workspace root option

## Summary
Testing workspace root option in loop command.

## Implementation Steps
1. Create file in workspace root
2. Verify file location

## Acceptance Criteria
- [ ] File created in correct location
`;

    await Deno.writeTextFile(
      `${testRepo.path}/workspace-test.plan.md`,
      planContent,
    );

    // Run loop command from subdirectory with explicit workspace root
    const result = await runDnCommand([
      "loop",
      "--plan-file",
      "workspace-test.plan.md",
      "--dry-run",
      "--workspace-root",
      testRepo.path,
    ], { cwd: subDir });

    assert(result.success);
  } finally {
    await cleanupTestRepo(testRepo);
  }
});
