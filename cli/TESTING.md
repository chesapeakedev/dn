# dn CLI Testing Framework

This directory contains a comprehensive testing framework for manually testing
the dn CLI in isolated environments.

## Overview

The testing framework allows you to test individual dn CLI subcommands without
affecting the main dn repository. It creates temporary git repositories, runs dn
commands, and validates results in a controlled environment.

## Structure

```
cli/
├── test_utils.ts          # Core testing utilities and helper functions
├── test_prep.ts           # Tests for the prep subcommand
├── test_loop.ts           # Tests for the loop subcommand
├── test_kickstart.ts      # Tests for the kickstart subcommand
├── test_meld.ts           # Tests for the meld subcommand
├── test_archive.ts        # Tests for the archive subcommand
└── main_test.ts           # Existing CLI tests
```

## Core Features

### Test Utilities (`test_utils.ts`)

The test utilities library provides:

- **`createTestRepo()`**: Creates temporary git repositories
- **`runDnCommand()`**: Executes dn CLI commands in test environments
- **`cleanupTestRepo()`**: Removes temporary directories
- **`assertGitState()`**: Validates git repository state
- **`createProjectTestRepo()`**: Creates repositories with basic project
  structure

### Environment Variables

Control test behavior with these environment variables:

- **`DN_TEST_KEEP_TEMP=1`**: Keep temporary directories for manual inspection
- **`DN_TEST_VERBOSE=1`**: Enable verbose logging during tests

## Usage Examples

### Basic Test Pattern

```typescript
import { cleanupTestRepo, createTestRepo, runDnCommand } from "./test_utils.ts";

Deno.test("my test", async () => {
  const testRepo = await createTestRepo();

  try {
    const result = await runDnCommand(["prep", "--help"], {
      cwd: testRepo.path,
    });
    // Add assertions here
  } finally {
    await cleanupTestRepo(testRepo);
  }
});
```

### Testing with Custom Repository

```typescript
Deno.test("test with project structure", async () => {
  const testRepo = await createProjectTestRepo({
    initialFiles: {
      "custom.md": "# Custom content",
    },
    gitConfig: {
      user: "Test User",
      email: "test@example.com",
    },
  });

  try {
    // Run tests
  } finally {
    await cleanupTestRepo(testRepo);
  }
});
```

### Git State Validation

```typescript
Deno.test("validate git state", async () => {
  const testRepo = await createProjectTestRepo();

  try {
    // Run command that creates files
    await runDnCommand(["prep", "issue.md", "--save-plan"], {
      cwd: testRepo.path,
    });

    // Validate git state
    await assertGitState(testRepo.path, {
      commits: 1, // Should not create commits
      files: ["README.md", "deno.json", "main.ts", "plan.plan.md"],
      status: {
        "plan.plan.md": "??", // Untracked file
      },
    });
  } finally {
    await cleanupTestRepo(testRepo);
  }
});
```

## Running Tests

### Run All Tests

```bash
deno test cli/test_*.ts
```

### Run Specific Test File

```bash
deno test cli/test_prep.ts
```

### Run with Verbose Output

```bash
DN_TEST_VERBOSE=1 deno test cli/test_prep.ts
```

### Keep Temporary Directories for Inspection

```bash
DN_TEST_KEEP_TEMP=1 deno test cli/test_prep.ts
```

## Test Patterns

### Happy Path Tests

Test normal operation scenarios:

```typescript
Deno.test("prep command creates plan file", async () => {
  const testRepo = await createProjectTestRepo();

  try {
    await Deno.writeTextFile(`${testRepo.path}/issue.md`, issueContent);

    const result = await runDnCommand([
      "prep",
      "issue.md",
      "--save-plan",
      "--plan-name",
      "test",
    ], { cwd: testRepo.path });

    assert(result.success);

    // Verify plan file exists
    await Deno.stat(`${testRepo.path}/test.plan.md`);
  } finally {
    await cleanupTestRepo(testRepo);
  }
});
```

### Error Handling Tests

Test invalid inputs and error conditions:

```typescript
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
```

### Git Operations Tests

Test git-related functionality:

```typescript
Deno.test("archive command commits with --yolo", async () => {
  const testRepo = await createProjectTestRepo();

  try {
    // Create changes and plan file
    await Deno.writeTextFile(
      `${testRepo.path}/feature.ts`,
      "export const feature = true;",
    );
    await Deno.writeTextFile(`${testRepo.path}/plan.plan.md`, planContent);

    // Stage changes
    await runCommand(["git", "add", "."], { cwd: testRepo.path });

    // Run archive with --yolo
    await runDnCommand(["archive", "plan.plan.md", "--yolo"], {
      cwd: testRepo.path,
    });

    // Verify commit was created
    await assertGitState(testRepo.path, { commits: 2 });
  } finally {
    await cleanupTestRepo(testRepo);
  }
});
```

## Best Practices

### 1. Always Clean Up

Use try/finally blocks to ensure cleanup:

```typescript
const testRepo = await createTestRepo();
try {
  // Test code here
} finally {
  await cleanupTestRepo(testRepo);
}
```

### 2. Use Dry-Run Mode When Possible

Many dn commands support `--dry-run` to avoid making actual changes:

```typescript
const result = await runDnCommand([
  "kickstart",
  "issue.md",
  "--dry-run",
], { cwd: testRepo.path });
```

### 3. Test Both Success and Failure Cases

Ensure commands handle both valid and invalid inputs correctly:

```typescript
// Test success case
const successResult = await runDnCommand(["prep", "valid.md"], {
  cwd: testRepo.path,
});
assert(successResult.success);

// Test failure case
await runDnCommand(["prep"], {
  cwd: testRepo.path,
  expectFailure: true,
});
```

### 4. Validate File System Changes

Check that files are created, modified, or deleted as expected:

```typescript
// Before
try {
  await Deno.stat(`${testRepo.path}/output.md`);
  throw new Error("File should not exist yet");
} catch (error) {
  if (!(error instanceof Deno.errors.NotFound)) throw error;
}

// Run command
await runDnCommand(["meld", "input.md", "--output", "output.md"], {
  cwd: testRepo.path,
});

// After
await Deno.stat(`${testRepo.path}/output.md`); // Should succeed
```

### 5. Use Descriptive Test Names

Make test names clear and specific:

```typescript
Deno.test("prep command creates plan file with --save-plan option", async () => {
  // Test implementation
});
```

## Adding New Tests

### 1. Create Test File

Create a new test file following the naming convention `test_<subcommand>.ts`:

```typescript
// cli/test_newsubcommand.ts
import { cleanupTestRepo, createTestRepo, runDnCommand } from "./test_utils.ts";

Deno.test("newsubcommand basic functionality", async () => {
  const testRepo = await createTestRepo();

  try {
    const result = await runDnCommand(["newsubcommand", "--help"], {
      cwd: testRepo.path,
    });
    // Add assertions
  } finally {
    await cleanupTestRepo(testRepo);
  }
});
```

### 2. Follow Existing Patterns

Use the same patterns as existing tests:

- Create test repository
- Use try/finally for cleanup
- Test both success and failure cases
- Validate git state when relevant
- Use dry-run mode when available

### 3. Add Comprehensive Coverage

Include tests for:

- Basic functionality
- Error handling
- Option validation
- Git operations
- File system changes
- Edge cases

## Troubleshooting

### Tests Fail with Permission Errors

Ensure dn CLI has necessary permissions:

```bash
deno test --allow-all cli/test_*.ts
```

### Temporary Directories Not Cleaned Up

Check if `DN_TEST_KEEP_TEMP=1` is set. Unset it to enable automatic cleanup:

```bash
unset DN_TEST_KEEP_TEMP
deno test cli/test_*.ts
```

### Git Operations Fail

Ensure git is available and properly configured:

```bash
git --version
git config --list
```

### Tests Timeout

Increase timeout for long-running operations:

```typescript
const result = await runDnCommand(["kickstart", "complex-issue.md"], {
  cwd: testRepo.path,
  timeout: 60000, // 60 seconds
});
```

## Integration with CI

The tests can be integrated into CI pipelines:

```yaml
# Example GitHub Actions step
- name: Run dn CLI tests
  run: |
    deno test --allow-all cli/test_*.ts
```

For CI environments, consider:

- Setting appropriate timeouts
- Using dry-run modes to avoid external dependencies
- Configuring git for automated operations
- Handling authentication for GitHub operations
