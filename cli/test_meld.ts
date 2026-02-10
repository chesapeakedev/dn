// Copyright 2026 Chesapeake Computing
// SPDX-License-Identifier: Apache-2.0

/**
 * Tests for dn meld subcommand
 *
 * These tests create temporary git repositories with markdown files and run the meld command
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

Deno.test("meld command shows help", async () => {
  const testRepo = await createTestRepo();

  try {
    const result = await runDnCommand(["meld", "--help"], {
      cwd: testRepo.path,
    });

    assert(result.stdout.includes("dn meld"));
    assert(result.stdout.includes("--output"));
    assert(result.stdout.includes("--trim"));
    assert(result.success);
  } finally {
    await cleanupTestRepo(testRepo);
  }
});

Deno.test("meld command fails without sources", async () => {
  const testRepo = await createTestRepo();

  try {
    await runDnCommand(["meld"], {
      cwd: testRepo.path,
      expectFailure: true,
    });
  } finally {
    await cleanupTestRepo(testRepo);
  }
});

Deno.test("meld command merges local markdown files", async () => {
  const testRepo = await createProjectTestRepo();

  try {
    // Create multiple markdown files
    const file1Content = `# Document 1

This is the first document.

## Section 1
Content for section 1.

## Section 2
Content for section 2.
`;

    const file2Content = `# Document 2

This is the second document.

## Section A
Content for section A.

## Section B
Content for section B.
`;

    await Deno.writeTextFile(`${testRepo.path}/doc1.md`, file1Content);
    await Deno.writeTextFile(`${testRepo.path}/doc2.md`, file2Content);

    // Run meld command to merge files
    const result = await runDnCommand([
      "meld",
      "doc1.md",
      "doc2.md",
      "--output",
      "merged.md",
    ], { cwd: testRepo.path });

    assert(result.success);

    // Check that merged file was created
    const mergedPath = `${testRepo.path}/merged.md`;
    try {
      await Deno.stat(mergedPath);
    } catch {
      throw new Error("Merged file was not created");
    }

    // Check merged file content
    const mergedContent = await Deno.readTextFile(mergedPath);
    assert(mergedContent.includes("Document 1"));
    assert(mergedContent.includes("Document 2"));
    assert(mergedContent.includes("Section 1"));
    assert(mergedContent.includes("Section A"));
  } finally {
    await cleanupTestRepo(testRepo);
  }
});

Deno.test("meld command with --trim option", async () => {
  const testRepo = await createProjectTestRepo();

  try {
    // Create markdown files with extra content
    const file1Content = `# Document 1

This is the first document.

## Section 1
Content for section 1.

## Section 2
Content for section 2.

---

Some extra content that should be trimmed.
`;

    const file2Content = `# Document 2

This is the second document.

## Section A
Content for section A.

## Section B
Content for section B.

## Metadata
- Author: Test
- Date: 2026-02-10
`;

    await Deno.writeTextFile(`${testRepo.path}/doc1.md`, file1Content);
    await Deno.writeTextFile(`${testRepo.path}/doc2.md`, file2Content);

    // Run meld command with trim option
    const result = await runDnCommand([
      "meld",
      "doc1.md",
      "doc2.md",
      "--output",
      "trimmed.md",
      "--trim",
    ], { cwd: testRepo.path });

    assert(result.success);

    // Check trimmed file content
    const trimmedContent = await Deno.readTextFile(
      `${testRepo.path}/trimmed.md`,
    );
    assert(trimmedContent.includes("Document 1"));
    assert(trimmedContent.includes("Document 2"));
    // Should not include metadata sections when trimmed
    assert(
      !trimmedContent.includes("Some extra content that should be trimmed"),
    );
    assert(!trimmedContent.includes("Metadata"));
  } finally {
    await cleanupTestRepo(testRepo);
  }
});

Deno.test("meld command handles GitHub issue URLs", async () => {
  const testRepo = await createProjectTestRepo();

  try {
    // Test with GitHub issue URL (will likely fail due to auth, but tests URL parsing)
    const result = await runDnCommand([
      "meld",
      "https://github.com/owner/repo/issues/123",
      "--output",
      "github-issue.md",
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

Deno.test("meld command with multiple sources", async () => {
  const testRepo = await createProjectTestRepo();

  try {
    // Create multiple markdown files
    const files = {
      "intro.md": `# Introduction

This is the introduction document.
`,
      "body.md": `# Main Content

This is the main body content.

## Chapter 1
Content for chapter 1.

## Chapter 2
Content for chapter 2.
`,
      "conclusion.md": `# Conclusion

This is the conclusion document.

## Summary
Summary of the content.
`,
    };

    for (const [filename, content] of Object.entries(files)) {
      await Deno.writeTextFile(`${testRepo.path}/${filename}`, content);
    }

    // Run meld command with multiple sources
    const result = await runDnCommand([
      "meld",
      "intro.md",
      "body.md",
      "conclusion.md",
      "--output",
      "complete.md",
    ], { cwd: testRepo.path });

    assert(result.success);

    // Check complete file content
    const completeContent = await Deno.readTextFile(
      `${testRepo.path}/complete.md`,
    );
    assert(completeContent.includes("Introduction"));
    assert(completeContent.includes("Main Content"));
    assert(completeContent.includes("Conclusion"));
    assert(completeContent.includes("Chapter 1"));
    assert(completeContent.includes("Summary"));
  } finally {
    await cleanupTestRepo(testRepo);
  }
});

Deno.test("meld command with --deduplicate option", async () => {
  const testRepo = await createProjectTestRepo();

  try {
    // Create files with overlapping content
    const file1Content = `# Document 1

## Common Section
This is a common section that appears in both files.

## Unique Section 1
This is unique to file 1.
`;

    const file2Content = `# Document 2

## Common Section
This is a common section that appears in both files.

## Unique Section 2
This is unique to file 2.
`;

    await Deno.writeTextFile(`${testRepo.path}/doc1.md`, file1Content);
    await Deno.writeTextFile(`${testRepo.path}/doc2.md`, file2Content);

    // Run meld command with deduplicate option
    const result = await runDnCommand([
      "meld",
      "doc1.md",
      "doc2.md",
      "--output",
      "dedup.md",
      "--deduplicate",
    ], { cwd: testRepo.path });

    assert(result.success);

    // Check deduplicated file content
    const dedupContent = await Deno.readTextFile(`${testRepo.path}/dedup.md`);
    assert(dedupContent.includes("Document 1"));
    assert(dedupContent.includes("Document 2"));
    assert(dedupContent.includes("Common Section"));
    assert(dedupContent.includes("Unique Section 1"));
    assert(dedupContent.includes("Unique Section 2"));

    // Common section should only appear once
    const commonSectionMatches = dedupContent.match(/Common Section/g);
    assert(commonSectionMatches ? commonSectionMatches.length === 1 : false);
  } finally {
    await cleanupTestRepo(testRepo);
  }
});

Deno.test("meld command validates output file path", async () => {
  const testRepo = await createProjectTestRepo();

  try {
    const fileContent = `# Test Document

Simple test content.
`;

    await Deno.writeTextFile(`${testRepo.path}/test.md`, fileContent);

    // Test with invalid output path (directory that doesn't exist)
    await runDnCommand([
      "meld",
      "test.md",
      "--output",
      "nonexistent/output.md",
    ], {
      cwd: testRepo.path,
      expectFailure: true,
    });
  } finally {
    await cleanupTestRepo(testRepo);
  }
});

Deno.test("meld command creates expected git state", async () => {
  const testRepo = await createProjectTestRepo();

  try {
    const file1Content = `# Source 1

Content from source 1.
`;

    const file2Content = `# Source 2

Content from source 2.
`;

    await Deno.writeTextFile(`${testRepo.path}/source1.md`, file1Content);
    await Deno.writeTextFile(`${testRepo.path}/source2.md`, file2Content);

    // Get initial git state
    await assertGitState(testRepo.path, {
      commits: 1,
      files: ["README.md", "deno.json", "main.ts"],
    });

    // Run meld command
    const result = await runDnCommand([
      "meld",
      "source1.md",
      "source2.md",
      "--output",
      "merged.md",
    ], { cwd: testRepo.path });

    assert(result.success);

    // Check git state after meld
    await assertGitState(testRepo.path, {
      commits: 1, // Should not create commits
      files: [
        "README.md",
        "deno.json",
        "main.ts",
        "source1.md",
        "source2.md",
        "merged.md",
      ],
      status: {
        "source1.md": "??", // Untracked files
        "source2.md": "??",
        "merged.md": "??",
      },
    });
  } finally {
    await cleanupTestRepo(testRepo);
  }
});

Deno.test("meld command with --workspace-root option", async () => {
  // Create nested directory structure
  const testRepo = await createProjectTestRepo();
  const subDir = `${testRepo.path}/subdir`;

  try {
    await Deno.mkdir(subDir, { recursive: true });

    const fileContent = `# Workspace Root Test

Testing workspace root option.
`;

    await Deno.writeTextFile(`${subDir}/test.md`, fileContent);

    // Run meld from subdirectory with explicit workspace root
    const result = await runDnCommand([
      "meld",
      "test.md",
      "--output",
      "merged.md",
      "--workspace-root",
      testRepo.path,
    ], { cwd: subDir });

    assert(result.success);

    // Merged file should be created in workspace root
    const mergedPath = `${testRepo.path}/merged.md`;
    try {
      await Deno.stat(mergedPath);
    } catch {
      throw new Error("Merged file was not created in workspace root");
    }
  } finally {
    await cleanupTestRepo(testRepo);
  }
});

Deno.test("meld command handles mixed sources (local files and URLs)", async () => {
  const testRepo = await createProjectTestRepo();

  try {
    const localFileContent = `# Local File

This is a local markdown file.
`;

    await Deno.writeTextFile(`${testRepo.path}/local.md`, localFileContent);

    // Test with mixed local file and GitHub URL (will fail due to auth)
    const result = await runDnCommand([
      "meld",
      "local.md",
      "https://github.com/owner/repo/issues/123",
      "--output",
      "mixed.md",
    ], {
      cwd: testRepo.path,
      expectFailure: true, // Expected to fail due to auth/network
    });

    // Should fail due to GitHub API access
    assert(
      result.stderr.includes("GitHub") || result.stderr.includes("issue") ||
        result.stderr.includes("auth") || result.stderr.includes("token"),
    );
  } finally {
    await cleanupTestRepo(testRepo);
  }
});
