// Copyright 2026 Chesapeake Computing
// SPDX-License-Identifier: Apache-2.0

import { $ } from "$dax";
import { formatSummary } from "../archive/mod.ts";
import type { IssueData } from "./issue.ts";

/**
 * Represents the Git/Sapling version control context for branch operations.
 */
export interface GitContext {
  /** The version control system being used */
  vcs: "git" | "sapling";
  /** The name of the branch created for this issue */
  branchName: string;
  /** The branch that was active before creating the new branch */
  previousBranch: string;
}

/**
 * Detects which version control system is available in the current directory.
 * Checks for Sapling (sl) first, then falls back to Git.
 *
 * @returns Promise resolving to a minimal GitContext with VCS type detected,
 *          or `null` if neither git nor sapling is available
 */
export async function detectVcs(): Promise<GitContext | null> {
  // Check for sapling first, then git
  try {
    await $`sl root`.quiet();
    return { vcs: "sapling", branchName: "", previousBranch: "" };
  } catch {
    try {
      await $`git rev-parse --show-toplevel`.quiet();
      return { vcs: "git", branchName: "", previousBranch: "" };
    } catch {
      return null;
    }
  }
}

/**
 * Prefix for branches created by kickstart.
 * Used to identify auto-generated branches where force push is safe.
 */
export const KICKSTART_BRANCH_PREFIX = "kickstart/";

/**
 * Generates a suggested branch name from issue data.
 * Format: `kickstart/issue_{number}_{slug}` where slug is derived from the issue title.
 *
 * @param issueData - Issue data used to generate the branch name
 * @returns Suggested branch name with kickstart prefix
 */
export function generateBranchName(issueData: IssueData): string {
  const issueSlug = issueData.title
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .substring(0, 50);
  return `${KICKSTART_BRANCH_PREFIX}issue_${issueData.number}_${issueSlug}`;
}

/**
 * Prompts the user for a branch/bookmark name with a suggested default.
 *
 * @param suggestedName - The suggested branch name
 * @param vcs - The version control system ("git" or "sapling")
 * @returns Promise resolving to the branch name chosen by the user
 */
export function promptForBranchName(
  suggestedName: string,
  vcs: "git" | "sapling",
): string {
  const vcsTerm = vcs === "sapling" ? "bookmark" : "branch";
  console.log(`\nSuggested ${vcsTerm} name: ${suggestedName}`);
  const input = prompt(
    `Enter ${vcsTerm} name (or press Enter to use suggested): `,
  );

  if (!input || input.trim() === "") {
    return suggestedName;
  }

  return input.trim();
}

/**
 * Verifies that the working tree is clean (no uncommitted changes).
 * Excludes `.cursor/debug.log` from the check as it's a debug file.
 *
 * @param vcs - The version control system to use ("git" or "sapling")
 * @throws Error if there are uncommitted changes in the working tree
 */
export async function checkWorkingTreeClean(
  vcs: "git" | "sapling",
): Promise<void> {
  if (vcs === "sapling") {
    const changes = await $`sl status --no-status`.text();
    const filtered = changes
      .split("\n")
      .filter((line) => !line.includes(".cursor/debug.log"))
      .filter((line) => line.trim().length > 0);
    if (filtered.length > 0) {
      throw new Error(
        "Working tree is not clean. Please commit or shelve changes first.",
      );
    }
  } else {
    const changes = await $`git status --porcelain`.text();
    const filtered = changes
      .split("\n")
      .filter((line) => !line.includes(".cursor/debug.log"))
      .filter((line) => line.trim().length > 0);
    if (filtered.length > 0) {
      throw new Error(
        "Working tree is not clean. Please commit or stash changes first.",
      );
    }
  }
}

/**
 * Prompts the user to choose between using the current bookmark/branch or creating a new one.
 *
 * @param currentBranch - The current branch/bookmark name
 * @param vcs - The version control system ("git" or "sapling")
 * @returns Promise resolving to `true` if user wants to use current, `false` to create new
 */
function promptUseCurrentOrNew(
  currentBranch: string,
  vcs: "git" | "sapling",
): boolean {
  const vcsTerm = vcs === "sapling" ? "bookmark" : "branch";
  console.log(`\nCurrent ${vcsTerm}: ${currentBranch}`);
  const input = prompt(
    `Use current ${vcsTerm} [${currentBranch}]? (y/N): `,
  );

  // Default to creating new if empty or invalid input
  if (!input || input.trim() === "") {
    return false;
  }

  const normalized = input.trim().toLowerCase();
  return normalized === "y" || normalized === "yes";
}

/**
 * Prepares the version control state for processing an issue in awp mode.
 * - Gets the current branch/bookmark
 * - Prompts user whether to use current bookmark or create new one
 * - If creating new: prompts for branch name (with suggestion) and creates it
 * - If using current: uses the current bookmark/branch
 *
 * @param issueData - Issue data used to generate the suggested branch name. Must not be null.
 * @returns Promise resolving to GitContext with branch information
 * @throws Error if VCS is not available, working tree is not clean, or branch already exists
 */
export async function prepareVcsStateInteractive(
  issueData: IssueData | null,
): Promise<GitContext> {
  const vcsContext = await detectVcs();
  if (!vcsContext) {
    throw new Error("Neither sapling (sl) nor git found in PATH");
  }

  console.log(`Using ${vcsContext.vcs}`);

  // Get current branch/bookmark
  let currentBranch: string;
  if (vcsContext.vcs === "sapling") {
    // Sapling doesn't have --active flag, so parse output to find active bookmark (marked with *)
    const bookmarksOutput = await $`sl bookmarks`.text();
    const activeLine = bookmarksOutput
      .split("\n")
      .find((line) => line.trim().startsWith("*"));
    if (activeLine) {
      // Extract bookmark name: line format is " * bookmark-name    commit-hash"
      const match = activeLine.match(/\*\s+(\S+)/);
      currentBranch = match ? match[1] : "default";
    } else {
      currentBranch = "default";
    }
  } else {
    const currentBranchOutput = await $`git branch --show-current`.text();
    currentBranch = currentBranchOutput.trim() || "main";
  }

  // Prompt user whether to use current bookmark or create new one
  const useCurrent = await promptUseCurrentOrNew(
    currentBranch,
    vcsContext.vcs,
  );

  let branchName: string;
  let previousBranch: string;

  if (useCurrent) {
    // Use the current bookmark/branch
    branchName = currentBranch;
    previousBranch = currentBranch;
    console.log(
      `Using current ${
        vcsContext.vcs === "sapling" ? "bookmark" : "branch"
      }: ${branchName}`,
    );
  } else {
    // Generate and prompt for new branch name
    if (!issueData) {
      throw new Error("Issue data required to create branch name");
    }

    const suggestedName = generateBranchName(issueData);
    branchName = await promptForBranchName(suggestedName, vcsContext.vcs);
    previousBranch = currentBranch;

    // Create branch/bookmark
    if (vcsContext.vcs === "sapling") {
      // Check if bookmark already exists
      const bookmarksOutput = await $`sl bookmarks`.text();
      const bookmarkExists = bookmarksOutput
        .split("\n")
        .some((line) => {
          const match = line.match(/^\s*\*?\s+(\S+)/);
          return match && match[1] === branchName;
        });
      if (bookmarkExists) {
        throw new Error(
          `Bookmark ${branchName} already exists. Please delete it or use a different name.`,
        );
      }
      await $`sl bookmark ${branchName}`;
    } else {
      // Check if branch already exists
      try {
        await $`git show-ref --verify --quiet refs/heads/${branchName}`.quiet();
        throw new Error(
          `Branch ${branchName} already exists. Please delete it or use a different name.`,
        );
      } catch (error) {
        if (
          error instanceof Error && error.message.includes("already exists")
        ) {
          throw error;
        }
        // Branch doesn't exist, create it
      }
      await $`git checkout -b ${branchName}`;
    }
  }

  return {
    vcs: vcsContext.vcs,
    branchName,
    previousBranch,
  };
}

/**
 * Checks if there are any changes in the working tree after opencode execution.
 *
 * @param vcs - The version control system to use ("git" or "sapling")
 * @returns Promise resolving to `true` if there are changes, `false` otherwise
 */
export async function checkForChanges(
  vcs: "git" | "sapling",
): Promise<boolean> {
  if (vcs === "sapling") {
    const changes = await $`sl status --no-status`.text();
    return changes.trim().length > 0;
  } else {
    const changes = await $`git status --porcelain`.text();
    return changes.trim().length > 0;
  }
}

/**
 * Gets a list of changed files from the working tree.
 *
 * @param vcs - The version control system to use ("git" or "sapling")
 * @returns Promise resolving to array of changed file paths
 */
export async function getChangedFiles(
  vcs: "git" | "sapling",
): Promise<string[]> {
  let files: string[] = [];
  if (vcs === "sapling") {
    const statusOutput = await $`sl status --no-status`.text();
    files = statusOutput
      .split("\n")
      .filter((line) => line.trim().length > 0)
      .map((line) => line.trim().replace(/^[MADRC?]+\s+/, "").trim())
      .filter((file) => !file.includes(".cursor/debug.log"));
  } else {
    const statusOutput = await $`git status --porcelain`.text();
    files = statusOutput
      .split("\n")
      .filter((line) => line.trim().length > 0)
      .map((line) => line.trim().replace(/^[MADRC?]+\s+/, "").trim())
      .filter((file) => !file.includes(".cursor/debug.log"));
  }

  return files;
}

/**
 * Displays the changes made by opencode.
 * Shows both a summary (stat) and the full diff.
 * Disables pager to prevent hanging in headless mode by capturing output.
 *
 * @param vcs - The version control system to use ("git" or "sapling")
 * @returns Promise resolving to object with changed files list and diff stats
 */
export async function showChanges(
  vcs: "git" | "sapling",
): Promise<{ files: string[]; stat: string; diff: string }> {
  let stat: string;
  let diff: string;

  if (vcs === "sapling") {
    // Disable pager for sapling by setting PAGER=cat in environment
    stat = await $`sl diff --stat`.env({ PAGER: "cat" }).text();
    console.log(stat);
    console.log("\n=== Full diff ===");
    diff = await $`sl diff`.env({ PAGER: "cat" }).text();
    console.log(diff);
  } else {
    // Disable pager for git using --no-pager flag and capture output
    stat = await $`git --no-pager diff --stat`.text();
    console.log(stat);
    console.log("\n=== Full diff ===");
    diff = await $`git --no-pager diff`.text();
    console.log(diff);
  }

  // Get changed files list
  const files = await getChangedFiles(vcs);

  return { files, stat, diff };
}

/**
 * Commits all changes and pushes the branch to the remote repository.
 * Commit message format: `#{issueNumber} {issueTitle}`
 *
 * @param gitContext - Git context containing VCS type and branch information
 * @param issueData - Issue data used to generate the commit message
 */
export async function commitAndPush(
  gitContext: GitContext,
  issueData: IssueData,
): Promise<void> {
  const commitMessage = formatSummary(
    `#${issueData.number} ${issueData.title}`,
  );

  if (gitContext.vcs === "sapling") {
    await $`sl add .`;
    await $`sl commit -m ${commitMessage}`;
  } else {
    await $`git add -A`;
    await $`git commit -m ${commitMessage}`;
  }

  // Push branch
  console.log(`Pushing branch ${gitContext.branchName}...`);
  if (gitContext.vcs === "sapling") {
    await $`sl push --to ${gitContext.branchName}`;
  } else {
    await $`git push -u --force-with-lease origin ${gitContext.branchName}`;
  }
}

/**
 * Cleans up the branch created for the issue by switching back to the previous branch
 * and deleting the issue branch (for git) or switching to top (for sapling).
 * Errors during cleanup are silently ignored.
 *
 * @param gitContext - Git context containing branch information to clean up
 */
export async function cleanupBranch(gitContext: GitContext): Promise<void> {
  try {
    if (gitContext.vcs === "sapling") {
      await $`sl top`.quiet();
    } else {
      await $`git checkout ${gitContext.previousBranch}`.quiet();
      await $`git branch -D ${gitContext.branchName}`.quiet().noThrow();
    }
  } catch {
    // Ignore cleanup errors
  }
}
