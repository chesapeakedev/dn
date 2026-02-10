// Copyright 2026 Chesapeake Computing
// SPDX-License-Identifier: Apache-2.0

/**
 * Test utilities for dn CLI manual testing
 *
 * Provides reusable functions to create temporary git repositories
 * and run dn CLI commands in isolated test environments.
 */

import { assert } from "@std/assert";

/**
 * Configuration options for test repositories
 */
export interface TestRepoOptions {
  /** Keep temporary directory after test (for manual inspection) */
  keepTemp?: boolean;
  /** Initial files to create in the repository */
  initialFiles?: Record<string, string>;
  /** Git configuration for the test repository */
  gitConfig?: { user: string; email: string };
  /** Initial git commits to create */
  initialCommits?: Array<{ message: string; files: Record<string, string> }>;
}

/**
 * Configuration options for running dn commands
 */
export interface DnCommandOptions {
  /** Working directory for the command */
  cwd?: string;
  /** Environment variables for the command */
  env?: Record<string, string>;
  /** Expect the command to fail (non-zero exit code) */
  expectFailure?: boolean;
  /** Timeout in milliseconds (default: 30000) */
  timeout?: number;
}

/**
 * Result of running a dn command
 */
export interface DnCommandResult {
  /** Exit code */
  code: number;
  /** Standard output */
  stdout: string;
  /** Standard error */
  stderr: string;
  /** Whether the command succeeded */
  success: boolean;
}

/**
 * Test repository information
 */
export interface TestRepo {
  /** Path to the temporary repository */
  path: string;
  /** Whether to keep the directory after cleanup */
  keepTemp: boolean;
}

/**
 * Environment variable to control temporary directory cleanup
 */
const KEEP_TEMP_ENV = "DN_TEST_KEEP_TEMP";

/**
 * Environment variable to enable verbose logging
 */
const VERBOSE_ENV = "DN_TEST_VERBOSE";

/**
 * Default git configuration for test repositories
 */
const DEFAULT_GIT_CONFIG = {
  user: "Test User",
  email: "test@example.com",
};

/**
 * Creates a temporary git repository for testing
 *
 * @param options Configuration options for the test repository
 * @returns Test repository information
 */
export async function createTestRepo(
  options: TestRepoOptions = {},
): Promise<TestRepo> {
  const keepTemp = options.keepTemp ?? (Deno.env.get(KEEP_TEMP_ENV) === "1");
  const verbose = Deno.env.get(VERBOSE_ENV) === "1";

  // Create temporary directory
  const tempDir = await Deno.makeTempDir({
    prefix: "dn-test-",
    suffix: keepTemp ? "" : undefined,
  });

  if (verbose) {
    console.log(`Created test repository: ${tempDir}`);
  }

  try {
    // Initialize git repository
    await runCommand(["git", "init"], { cwd: tempDir });

    // Configure git
    const gitConfig = options.gitConfig ?? DEFAULT_GIT_CONFIG;
    await runCommand(["git", "config", "user.name", gitConfig.user], {
      cwd: tempDir,
    });
    await runCommand(["git", "config", "user.email", gitConfig.email], {
      cwd: tempDir,
    });

    // Create initial files
    if (options.initialFiles) {
      for (const [filePath, content] of Object.entries(options.initialFiles)) {
        const fullPath = `${tempDir}/${filePath}`;
        await Deno.mkdir(dirname(fullPath), { recursive: true });
        await Deno.writeTextFile(fullPath, content);
      }
    }

    // Create initial commits
    if (options.initialCommits) {
      for (const commit of options.initialCommits) {
        // Create files for this commit
        for (const [filePath, content] of Object.entries(commit.files)) {
          const fullPath = `${tempDir}/${filePath}`;
          await Deno.mkdir(dirname(fullPath), { recursive: true });
          await Deno.writeTextFile(fullPath, content);
        }

        // Add and commit files
        await runCommand(["git", "add", "."], { cwd: tempDir });
        await runCommand(["git", "commit", "-m", commit.message], {
          cwd: tempDir,
        });
      }
    } else if (options.initialFiles) {
      // Commit initial files if no explicit commits specified
      await runCommand(["git", "add", "."], { cwd: tempDir });
      await runCommand(["git", "commit", "-m", "Initial commit"], {
        cwd: tempDir,
      });
    }

    return { path: tempDir, keepTemp };
  } catch (error) {
    // Clean up on failure
    if (!keepTemp) {
      await Deno.remove(tempDir, { recursive: true }).catch(() => {});
    }
    throw error;
  }
}

/**
 * Runs a dn CLI command in the specified environment
 *
 * @param args Command arguments (excluding the dn executable)
 * @param options Configuration options for running the command
 * @returns Command execution result
 */
export async function runDnCommand(
  args: string[],
  options: DnCommandOptions = {},
): Promise<DnCommandResult> {
  const verbose = Deno.env.get(VERBOSE_ENV) === "1";
  const _timeout = options.timeout ?? 30000;

  // Build command arguments - use absolute path to CLI main file
  const cliPath = `${Deno.cwd()}/cli/main.ts`;
  const commandArgs = [
    "run",
    "--allow-all", // dn CLI requires extensive permissions
    "--quiet",
    cliPath,
    ...args,
  ];

  // Build environment
  const env = { ...Deno.env.toObject(), ...options.env };

  if (verbose) {
    console.log(`Running dn command: deno ${commandArgs.join(" ")}`);
    if (options.cwd) {
      console.log(`Working directory: ${options.cwd}`);
    }
  }

  // Execute command
  const command = new Deno.Command(Deno.execPath(), {
    args: commandArgs,
    cwd: options.cwd,
    env,
    stdout: "piped",
    stderr: "piped",
  });

  const { code, stdout, stderr } = await command.output();

  const stdoutText = new TextDecoder().decode(stdout);
  const stderrText = new TextDecoder().decode(stderr);
  const success = code === 0;

  if (verbose) {
    console.log(`Exit code: ${code}`);
    if (stdoutText) {
      console.log(`STDOUT:\n${stdoutText}`);
    }
    if (stderrText) {
      console.log(`STDERR:\n${stderrText}`);
    }
  }

  // Check expectations
  if (options.expectFailure) {
    assert(
      code !== 0,
      `Expected command to fail but it succeeded with code ${code}`,
    );
  } else {
    assert(code === 0, `Command failed with code ${code}: ${stderrText}`);
  }

  return {
    code,
    stdout: stdoutText,
    stderr: stderrText,
    success,
  };
}

/**
 * Runs a generic command (useful for git operations)
 *
 * @param args Command arguments
 * @param options Configuration options
 * @returns Command execution result
 */
export async function runCommand(
  args: string[],
  options: { cwd?: string; env?: Record<string, string> } = {},
): Promise<{ code: number; stdout: string; stderr: string }> {
  const verbose = Deno.env.get(VERBOSE_ENV) === "1";

  if (verbose) {
    console.log(`Running command: ${args.join(" ")}`);
    if (options.cwd) {
      console.log(`Working directory: ${options.cwd}`);
    }
  }

  const command = new Deno.Command(args[0], {
    args: args.slice(1),
    cwd: options.cwd,
    env: { ...Deno.env.toObject(), ...options.env },
    stdout: "piped",
    stderr: "piped",
  });

  const { code, stdout, stderr } = await command.output();

  const stdoutText = new TextDecoder().decode(stdout);
  const stderrText = new TextDecoder().decode(stderr);

  if (verbose) {
    console.log(`Exit code: ${code}`);
    if (stdoutText) {
      console.log(`STDOUT:\n${stdoutText}`);
    }
    if (stderrText) {
      console.log(`STDERR:\n${stderrText}`);
    }
  }

  return { code, stdout: stdoutText, stderr: stderrText };
}

/**
 * Cleans up a test repository
 *
 * @param testRepo Test repository to clean up
 */
export async function cleanupTestRepo(testRepo: TestRepo): Promise<void> {
  if (!testRepo.keepTemp) {
    const verbose = Deno.env.get(VERBOSE_ENV) === "1";
    if (verbose) {
      console.log(`Cleaning up test repository: ${testRepo.path}`);
    }
    await Deno.remove(testRepo.path, { recursive: true }).catch(() => {});
  } else {
    console.log(`Keeping test repository for inspection: ${testRepo.path}`);
  }
}

/**
 * Asserts the state of a git repository
 *
 * @param repoPath Path to the git repository
 * @param expectations Expected state of the repository
 */
export async function assertGitState(
  repoPath: string,
  expectations: {
    branch?: string;
    commits?: number;
    files?: string[];
    status?: Record<string, string>;
  },
): Promise<void> {
  // Check current branch
  if (expectations.branch) {
    const { stdout } = await runCommand(["git", "branch", "--show-current"], {
      cwd: repoPath,
    });
    assert(
      stdout.trim() === expectations.branch,
      `Expected branch ${expectations.branch}, got ${stdout.trim()}`,
    );
  }

  // Check number of commits
  if (expectations.commits !== undefined) {
    const { stdout } = await runCommand(
      ["git", "rev-list", "--count", "HEAD"],
      { cwd: repoPath },
    );
    const commitCount = parseInt(stdout.trim(), 10);
    assert(
      commitCount === expectations.commits,
      `Expected ${expectations.commits} commits, got ${commitCount}`,
    );
  }

  // Check files exist
  if (expectations.files) {
    for (const file of expectations.files) {
      const filePath = `${repoPath}/${file}`;
      try {
        await Deno.stat(filePath);
      } catch {
        throw new Error(`Expected file ${file} to exist`);
      }
    }
  }

  // Check git status
  if (expectations.status) {
    const { stdout } = await runCommand(["git", "status", "--porcelain"], {
      cwd: repoPath,
    });
    const statusLines = stdout.trim().split("\n").filter((line) => line);

    for (const [file, expectedStatus] of Object.entries(expectations.status)) {
      const matchingLine = statusLines.find((line) => line.endsWith(file));
      if (expectedStatus === "clean") {
        assert(
          !matchingLine,
          `Expected file ${file} to be clean, but found status: ${matchingLine}`,
        );
      } else {
        assert(
          matchingLine && matchingLine.startsWith(expectedStatus),
          `Expected file ${file} to have status ${expectedStatus}, got ${matchingLine}`,
        );
      }
    }
  }
}

/**
 * Gets the directory name from a file path
 */
function dirname(filePath: string): string {
  const parts = filePath.split("/");
  return parts.slice(0, -1).join("/");
}

/**
 * Creates a test repository with a basic project structure
 *
 * @param options Additional configuration options
 * @returns Test repository information
 */
export async function createProjectTestRepo(
  options: TestRepoOptions = {},
): Promise<TestRepo> {
  return await createTestRepo({
    ...options,
    initialFiles: {
      "README.md": "# Test Project\n\nA test project for dn CLI testing.",
      "deno.json": JSON.stringify(
        {
          name: "test-project",
          version: "1.0.0",
          tasks: {
            start: "deno run --allow-all main.ts",
          },
        },
        null,
        2,
      ),
      "main.ts": `#!/usr/bin/env -S deno run --allow-all
// Test project main file

console.log("Hello from test project!");

if (import.meta.main) {
  console.log("Running as main module");
}
`,
      ...options.initialFiles,
    },
  });
}
