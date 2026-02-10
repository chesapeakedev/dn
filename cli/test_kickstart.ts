// Copyright 2026 Chesapeake Computing
// SPDX-License-Identifier: Apache-2.0

/**
 * Tests for dn kickstart subcommand
 *
 * These tests create temporary git repositories and run the kickstart command
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

Deno.test("kickstart command shows help", async () => {
  const testRepo = await createTestRepo();

  try {
    const result = await runDnCommand(["kickstart", "--help"], {
      cwd: testRepo.path,
    });

    assert(result.stdout.includes("dn kickstart"));
    assert(result.stdout.includes("--plan-name"));
    assert(result.stdout.includes("--save-plan"));
    assert(result.stdout.includes("--iterations"));
    assert(result.success);
  } finally {
    await cleanupTestRepo(testRepo);
  }
});

Deno.test("kickstart command fails without arguments", async () => {
  const testRepo = await createTestRepo();

  try {
    await runDnCommand(["kickstart"], {
      cwd: testRepo.path,
      expectFailure: true,
    });
  } finally {
    await cleanupTestRepo(testRepo);
  }
});

Deno.test("kickstart command fails with invalid issue number", async () => {
  const testRepo = await createTestRepo();

  try {
    await runDnCommand(["kickstart", "notanumber"], {
      cwd: testRepo.path,
      expectFailure: true,
    });
  } finally {
    await cleanupTestRepo(testRepo);
  }
});

Deno.test("kickstart command runs full workflow with local issue file", async () => {
  const testRepo = await createProjectTestRepo();

  try {
    // Create a mock issue file
    const issueContent = `# Test Feature Request

## Description
This is a test feature request for the kickstart command. It should create a simple feature that demonstrates the full workflow.

## Acceptance Criteria
- [ ] Create a new module file
- [ ] Add basic functionality
- [ ] Write tests
- [ ] Update documentation

## Implementation Notes
- Use TypeScript
- Follow existing code patterns
- Add proper error handling

## Technical Details
- Module should be exportable
- Should handle edge cases
- Include type definitions
`;

    await Deno.writeTextFile(`${testRepo.path}/test-feature.md`, issueContent);

    // Run kickstart command with dry-run to avoid actual implementation
    const result = await runDnCommand([
      "kickstart",
      "test-feature.md",
      "--dry-run",
      "--plan-name",
      "test-feature",
      "--iterations",
      "1",
    ], { cwd: testRepo.path });

    assert(result.success);
    assert(
      result.stdout.includes("kickstart") || result.stdout.includes("plan") ||
        result.stdout.includes("loop"),
    );
  } finally {
    await cleanupTestRepo(testRepo);
  }
});

Deno.test("kickstart command creates plan file with --save-plan", async () => {
  const testRepo = await createProjectTestRepo();

  try {
    const issueContent = `# Simple Feature

## Description
A simple feature to test plan creation.
`;

    await Deno.writeTextFile(
      `${testRepo.path}/simple-feature.md`,
      issueContent,
    );

    // Run kickstart with save-plan but dry-run implementation
    const result = await runDnCommand([
      "kickstart",
      "simple-feature.md",
      "--save-plan",
      "--plan-name",
      "simple-feature",
      "--dry-run",
    ], { cwd: testRepo.path });

    assert(result.success);

    // Check that plan file was created
    const planPath = `${testRepo.path}/simple-feature.plan.md`;
    try {
      await Deno.stat(planPath);
    } catch {
      throw new Error("Plan file was not created");
    }

    // Check plan file content
    const planContent = await Deno.readTextFile(planPath);
    assert(planContent.includes("# Plan"));
    assert(planContent.includes("Simple Feature"));
  } finally {
    await cleanupTestRepo(testRepo);
  }
});

Deno.test("kickstart command respects --workspace-root option", async () => {
  // Create nested directory structure
  const testRepo = await createProjectTestRepo();
  const subDir = `${testRepo.path}/subdir`;

  try {
    await Deno.mkdir(subDir, { recursive: true });

    const issueContent = `# Workspace Root Test

## Description
Testing workspace root option in kickstart.
`;

    await Deno.writeTextFile(`${subDir}/workspace-test.md`, issueContent);

    // Run kickstart from subdirectory with explicit workspace root
    const result = await runDnCommand([
      "kickstart",
      "workspace-test.md",
      "--dry-run",
      "--plan-name",
      "workspace-test",
      "--workspace-root",
      testRepo.path,
    ], { cwd: subDir });

    assert(result.success);
  } finally {
    await cleanupTestRepo(testRepo);
  }
});

Deno.test("kickstart command handles GitHub issue URL", async () => {
  const testRepo = await createProjectTestRepo();

  try {
    // Test with GitHub issue URL (will likely fail due to auth, but tests URL parsing)
    const result = await runDnCommand([
      "kickstart",
      "https://github.com/owner/repo/issues/123",
      "--dry-run",
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

Deno.test("kickstart command with --continue-on-error", async () => {
  const testRepo = await createProjectTestRepo();

  try {
    const issueContent = `# Error Handling Test

## Description
Testing continue-on-error in kickstart workflow.
`;

    await Deno.writeTextFile(`${testRepo.path}/error-test.md`, issueContent);

    // Run kickstart with continue-on-error
    const result = await runDnCommand([
      "kickstart",
      "error-test.md",
      "--dry-run",
      "--continue-on-error",
    ], { cwd: testRepo.path });

    assert(result.success);
  } finally {
    await cleanupTestRepo(testRepo);
  }
});

Deno.test("kickstart command validates plan name format", async () => {
  const testRepo = await createProjectTestRepo();

  try {
    const issueContent = `# Plan Name Validation Test

## Description
Testing plan name validation.
`;

    await Deno.writeTextFile(
      `${testRepo.path}/validation-test.md`,
      issueContent,
    );

    // Test with invalid plan name
    await runDnCommand([
      "kickstart",
      "validation-test.md",
      "--dry-run",
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

Deno.test("kickstart command creates expected git state", async () => {
  const testRepo = await createProjectTestRepo();

  try {
    const issueContent = `# Git State Test

## Description
Testing git state changes in kickstart workflow.

## Files to Create
- new-feature.ts

## Files to Modify
- main.ts
`;

    await Deno.writeTextFile(
      `${testRepo.path}/git-state-test.md`,
      issueContent,
    );

    // Get initial git state
    await assertGitState(testRepo.path, {
      commits: 1,
      files: ["README.md", "deno.json", "main.ts"],
    });

    // Run kickstart with dry-run (should not change git state)
    const result = await runDnCommand([
      "kickstart",
      "git-state-test.md",
      "--dry-run",
      "--plan-name",
      "git-state-test",
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

Deno.test("kickstart command with complex issue", async () => {
  const testRepo = await createProjectTestRepo();

  try {
    const complexIssueContent = `# Complex Feature Implementation

## Description
This is a complex feature that requires multiple components and careful implementation.

## Background
We need to implement a comprehensive data processing system that can handle various input formats, transform data according to configurable rules, and output results in multiple formats. The system should be extensible, performant, and well-tested.

## Requirements

### Functional Requirements
- Support CSV, JSON, and XML input formats
- Configurable transformation rules
- Output to CSV, JSON, and database
- Real-time processing capability
- Batch processing mode

### Non-Functional Requirements
- Handle files up to 1GB
- Process at least 1000 records/second
- Memory usage under 512MB
- 99.9% uptime

## Acceptance Criteria

### Core Functionality
- [ ] Parse CSV files with custom delimiters
- [ ] Parse JSON files with nested structures
- [ ] Parse XML files with namespaces
- [ ] Apply transformation rules based on configuration
- [ ] Output to CSV with custom formatting
- [ ] Output to JSON with schema validation
- [ ] Store results in SQLite database

### Performance
- [ ] Process 1000 records within 1 second
- [ ] Handle 1GB files without memory overflow
- [ ] Maintain response time under 100ms for real-time mode

### Error Handling
- [ ] Validate input file formats
- [ ] Handle malformed data gracefully
- [ ] Provide detailed error messages
- [ ] Log all processing errors

### Testing
- [ ] Unit tests for all parsers
- [ ] Integration tests for end-to-end workflows
- [ ] Performance tests with large datasets
- [ ] Error scenario tests

## Implementation Approach

### Phase 1: Core Infrastructure
1. Set up project structure
2. Define interfaces and types
3. Create configuration system
4. Implement logging framework

### Phase 2: Input Parsers
1. CSV parser with configurable delimiters
2. JSON parser with schema validation
3. XML parser with namespace support
4. Input format detection

### Phase 3: Transformation Engine
1. Rule parser and validator
2. Transformation engine core
3. Built-in transformation functions
4. Custom function support

### Phase 4: Output Handlers
1. CSV output formatter
2. JSON output with schema
3. Database connection and operations
4. Output format selection

### Phase 5: Performance and Optimization
1. Streaming processing for large files
2. Memory management optimization
3. Parallel processing support
4. Caching mechanisms

## Technical Specifications

### Architecture
- Modular plugin-based architecture
- Event-driven processing pipeline
- Configuration-driven behavior
- Comprehensive error handling

### Dependencies
- @std/csv for CSV processing
- @std/json for JSON operations
- @std/xml for XML parsing
- sqlite3 for database operations

### File Structure
- src/core/ (interfaces, types, config, logger)
- src/parsers/ (csv-parser, json-parser, xml-parser, format-detector)
- src/transformations/ (rule-engine, built-in-functions, custom-functions)
- src/outputs/ (csv-output, json-output, database-output)
- src/processing/ (pipeline, stream-processor, batch-processor)
- tests/ (unit, integration, performance)
- config/ (default-config.json, transformation-rules.json)

## Testing Strategy
- Unit tests for each component
- Integration tests for workflows
- Performance benchmarks
- Error handling validation

## Success Metrics
- All acceptance criteria met
- Performance requirements satisfied
- Code coverage > 90%
- Zero critical bugs in production

## Notes
This is a comprehensive test of the kickstart command's ability to handle complex, multi-phase projects with detailed requirements and implementation plans.
`;

    await Deno.writeTextFile(
      `${testRepo.path}/complex-feature.md`,
      complexIssueContent,
    );

    // Run kickstart on complex issue
    const result = await runDnCommand([
      "kickstart",
      "complex-feature.md",
      "--dry-run",
      "--plan-name",
      "complex-feature",
      "--iterations",
      "1",
    ], { cwd: testRepo.path });

    assert(result.success);
  } finally {
    await cleanupTestRepo(testRepo);
  }
});

Deno.test("kickstart command with issue number format", async () => {
  const testRepo = await createProjectTestRepo();

  try {
    // Test with issue number format (will fail due to no GitHub connection)
    const result = await runDnCommand([
      "kickstart",
      "#123",
      "--dry-run",
    ], {
      cwd: testRepo.path,
      expectFailure: true,
    });

    // Should fail due to GitHub API access, not issue number parsing
    assert(
      result.stderr.includes("GitHub") || result.stderr.includes("issue") ||
        result.stderr.includes("auth") || result.stderr.includes("token"),
    );
  } finally {
    await cleanupTestRepo(testRepo);
  }
});
