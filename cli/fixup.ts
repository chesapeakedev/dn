// Copyright 2026 Chesapeake Computing
// SPDX-License-Identifier: Apache-2.0

/**
 * dn fixup subcommand handler
 *
 * Given a GitHub PR URL, fetches the PR description and all comments,
 * creates a plan to address the feedback, and implements the fixes locally.
 */

import { $ } from "$dax";
import type { KickstartConfig } from "../kickstart/lib.ts";
import {
  fetchPullRequestWithComments,
  parsePullRequestUrl,
} from "../sdk/github/github-gql.ts";
import type { PRReview, PullRequestData } from "../sdk/github/github-gql.ts";
import { detectVcs } from "../sdk/github/vcs.ts";
import { runCursorAgent } from "../sdk/github/cursorAgent.ts";
import { runOpenCode } from "../sdk/github/opencode.ts";
import { assembleCombinedPrompt } from "../sdk/github/prompt.ts";
import {
  formatError,
  formatInfo,
  formatStep,
  formatSuccess,
  formatWarning,
} from "../kickstart/output.ts";

/**
 * Configuration for fixup command
 */
interface FixupConfig extends KickstartConfig {
  prUrl: string | null;
}

/**
 * Parses fixup-specific arguments
 */
function parseArgs(args: string[]): FixupConfig {
  let prUrl: string | null = null;
  let cursorEnabled = false;
  let workspaceRoot: string | undefined = undefined;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--cursor" || arg === "-c") {
      cursorEnabled = true;
    } else if (arg === "--workspace-root" && i + 1 < args.length) {
      workspaceRoot = args[++i];
    } else if (arg === "--help" || arg === "-h") {
      showHelp();
      Deno.exit(0);
    } else if (!arg.startsWith("--") && !prUrl) {
      prUrl = arg;
    }
  }

  // Fallback to environment variables
  if (!prUrl) {
    prUrl = Deno.env.get("PR_URL") || null;
  }

  if (!cursorEnabled) {
    cursorEnabled = Deno.env.get("CURSOR_ENABLED") === "1";
  }

  return {
    awp: false,
    cursorEnabled,
    allowCrossRepo: false,
    issueUrl: null,
    saveCtx: false,
    savedPlanName: null,
    workspaceRoot,
    prUrl,
  };
}

/**
 * Shows help for fixup subcommand
 */
function showHelp(): void {
  console.log("dn fixup - Address PR feedback locally\n");
  console.log("Usage:");
  console.log("  dn fixup [options] <pr_url>\n");
  console.log("Options:");
  console.log("  --cursor, -c             Enable Cursor IDE integration");
  console.log("  --workspace-root <path>  Workspace root directory");
  console.log("  --help, -h               Show this help message\n");
  console.log("Environment variables:");
  console.log("  WORKSPACE_ROOT           Workspace root directory");
  console.log(
    "  PR_URL                   GitHub PR URL (alternative to positional arg)",
  );
  console.log(
    "  CURSOR_ENABLED           Set to '1' to enable Cursor integration\n",
  );
  console.log("Examples:");
  console.log("  dn fixup https://github.com/owner/repo/pull/123");
  console.log("  dn fixup --cursor https://github.com/owner/repo/pull/123\n");
  console.log("Notes:");
  console.log(
    "  - If already on the correct branch, no git/sl commands are executed",
  );
  console.log(
    "  - If on a different branch, the PR branch will be checked out",
  );
  console.log("  - After fixup, changes remain uncommitted for your review");
}

/**
 * Gets the current branch/bookmark name.
 */
async function getCurrentBranch(vcs: "git" | "sapling"): Promise<string> {
  if (vcs === "sapling") {
    const bookmarksOutput = await $`sl bookmarks`.text();
    const activeLine = bookmarksOutput
      .split("\n")
      .find((line) => line.trim().startsWith("*"));
    if (activeLine) {
      const match = activeLine.match(/\*\s+(\S+)/);
      return match ? match[1] : "default";
    }
    return "default";
  } else {
    const currentBranchOutput = await $`git branch --show-current`.text();
    return currentBranchOutput.trim() || "main";
  }
}

/**
 * Checks out the PR branch using gh CLI or native VCS commands.
 */
async function checkoutPRBranch(
  prNumber: number,
  headRefName: string,
  vcs: "git" | "sapling",
): Promise<void> {
  console.log(formatInfo(`Checking out PR branch: ${headRefName}`));

  if (vcs === "git") {
    // Try using gh pr checkout first (most reliable)
    try {
      await $`gh pr checkout ${prNumber}`.quiet();
      console.log(
        formatSuccess(`Checked out PR #${prNumber} branch: ${headRefName}`),
      );
      return;
    } catch {
      // gh not available or failed, try native git
    }

    // Fallback to native git commands
    try {
      // Fetch the branch first
      await $`git fetch origin ${headRefName}:${headRefName}`.quiet();
      await $`git checkout ${headRefName}`.quiet();
      console.log(formatSuccess(`Checked out branch: ${headRefName}`));
      return;
    } catch {
      // Try one more approach - checkout from remote
      await $`git fetch origin`.quiet();
      await $`git checkout -b ${headRefName} origin/${headRefName}`.quiet();
      console.log(formatSuccess(`Checked out branch: ${headRefName}`));
    }
  } else {
    // Sapling
    try {
      await $`sl pull --bookmark ${headRefName}`.quiet();
      await $`sl goto ${headRefName}`.quiet();
      console.log(formatSuccess(`Checked out bookmark: ${headRefName}`));
    } catch {
      throw new Error(
        `Failed to checkout PR branch ${headRefName} with sapling`,
      );
    }
  }
}

/**
 * Formats PR data as markdown context for the agent.
 */
function formatPRContext(prData: PullRequestData): string {
  let content = `# Pull Request #${prData.number}: ${prData.title}\n\n`;
  content += `**URL**: ${prData.url}\n`;
  content += `**Branch**: ${prData.headRefName}\n\n`;

  content += `## Description\n\n`;
  content += prData.body || "(No description provided)";
  content += "\n\n";

  // Issue-style comments (conversation)
  if (prData.comments.length > 0) {
    content += `## Conversation Comments\n\n`;
    for (const comment of prData.comments) {
      const date = new Date(comment.createdAt).toLocaleDateString();
      content += `### Comment by @${comment.author} (${date})\n\n`;
      content += comment.body + "\n\n";
    }
  }

  // Review comments grouped by review
  const activeReviews = prData.reviews.filter(
    (r) => r.state !== "DISMISSED" && (r.body || r.comments.length > 0),
  );

  if (activeReviews.length > 0) {
    content += `## Code Reviews\n\n`;
    for (const review of activeReviews) {
      const date = new Date(review.createdAt).toLocaleDateString();
      const stateEmoji = getReviewStateEmoji(review);
      content +=
        `### ${stateEmoji} Review by @${review.author} (${date}) - ${review.state}\n\n`;

      if (review.body) {
        content += review.body + "\n\n";
      }

      // Group review comments by file
      if (review.comments.length > 0) {
        const commentsByFile = new Map<
          string,
          typeof review.comments
        >();
        for (const comment of review.comments) {
          const existing = commentsByFile.get(comment.path) || [];
          existing.push(comment);
          commentsByFile.set(comment.path, existing);
        }

        for (const [filePath, fileComments] of commentsByFile) {
          content += `#### File: \`${filePath}\`\n\n`;
          for (const comment of fileComments) {
            const lineInfo = comment.line ? ` (line ${comment.line})` : "";
            content +=
              `**@${comment.author}**${lineInfo}:\n${comment.body}\n\n`;
          }
        }
      }
    }
  }

  return content;
}

/**
 * Gets an emoji representing the review state.
 */
function getReviewStateEmoji(review: PRReview): string {
  switch (review.state) {
    case "APPROVED":
      return "✅";
    case "CHANGES_REQUESTED":
      return "❌";
    case "COMMENTED":
      return "💬";
    default:
      return "📝";
  }
}

/**
 * Generates acceptance criteria from PR comments.
 */
function generateAcceptanceCriteria(prData: PullRequestData): string[] {
  const criteria: string[] = [];

  // Add criteria from review comments that request changes
  for (const review of prData.reviews) {
    if (review.state === "DISMISSED") continue;

    // If the review body has substance, add it
    if (review.body && review.body.trim().length > 20) {
      criteria.push(
        `Address ${review.author}'s ${review.state.toLowerCase()} review`,
      );
    }

    // Add criteria for each review comment
    for (const comment of review.comments) {
      const shortBody = comment.body.substring(0, 80).replace(/\n/g, " ");
      const ellipsis = comment.body.length > 80 ? "..." : "";
      criteria.push(
        `Address feedback in \`${comment.path}\`: "${shortBody}${ellipsis}"`,
      );
    }
  }

  // Add criteria from issue comments (conversation)
  for (const comment of prData.comments) {
    // Skip very short comments or simple acknowledgments
    if (comment.body.trim().length < 20) continue;
    if (/^(lgtm|looks good|thanks|ok|nice)/i.test(comment.body.trim())) {
      continue;
    }

    const shortBody = comment.body.substring(0, 80).replace(/\n/g, " ");
    const ellipsis = comment.body.length > 80 ? "..." : "";
    criteria.push(
      `Address ${comment.author}'s comment: "${shortBody}${ellipsis}"`,
    );
  }

  return criteria;
}

/**
 * Creates a fixup plan file.
 */
function createFixupPlan(prData: PullRequestData): string {
  const criteria = generateAcceptanceCriteria(prData);

  let plan = `# Fixup: ${prData.title}\n\n`;
  plan += `## Overview\n\n`;
  plan += `Address feedback on PR #${prData.number}.\n\n`;
  plan += `- **PR URL**: ${prData.url}\n`;
  plan += `- **Branch**: ${prData.headRefName}\n\n`;

  plan += `## PR Context\n\n`;
  plan += formatPRContext(prData);

  plan += `## Implementation Plan\n\n`;
  plan += `Review each piece of feedback and make the necessary changes.\n\n`;

  plan += `## Acceptance Criteria\n\n`;
  if (criteria.length > 0) {
    for (const criterion of criteria) {
      plan += `- [ ] ${criterion}\n`;
    }
  } else {
    plan +=
      `- [ ] Review PR feedback and determine if any changes are needed\n`;
  }

  return plan;
}

/**
 * Gets the binary directory (works in compiled binary and development mode).
 */
function getBinaryDir(): string {
  const url = new URL(import.meta.url);
  if (url.protocol === "file:") {
    // Development mode - go up one level from cli/ to dn/, then into kickstart/
    return new URL("../kickstart/", url).pathname;
  }
  return new URL("../kickstart/", import.meta.url).pathname;
}

/**
 * Reads an included system prompt (works in compiled binary and development mode).
 */
async function readIncludedPrompt(
  filename: string,
  workspaceRoot: string,
): Promise<string> {
  const binaryDir = getBinaryDir();

  try {
    // Try included file first (works in compiled binary)
    if (typeof import.meta.dirname !== "undefined") {
      try {
        return await Deno.readTextFile(
          import.meta.dirname + `/../kickstart/${filename}`,
        );
      } catch {
        // Fall through to file system fallback
      }
    }
  } catch {
    // Fall through to file system fallback
  }

  // Try binary directory
  try {
    return await Deno.readTextFile(`${binaryDir}/${filename}`);
  } catch {
    // Try workspace root
    return await Deno.readTextFile(`${workspaceRoot}/dn/kickstart/${filename}`);
  }
}

/**
 * Handles the fixup subcommand
 */
export async function handleFixup(args: string[]): Promise<void> {
  const config = parseArgs(args);

  if (!config.prUrl) {
    console.error(
      "Error: Either provide a PR URL as argument or set PR_URL environment variable",
    );
    console.error("\nUse 'dn fixup --help' for usage information.");
    Deno.exit(1);
  }

  // Validate PR URL format
  const parsed = parsePullRequestUrl(config.prUrl);
  if (!parsed) {
    console.error(
      `Error: Invalid PR URL format: ${config.prUrl}`,
    );
    console.error(
      "Expected format: https://github.com/owner/repo/pull/123",
    );
    Deno.exit(1);
  }

  const workspaceRoot = config.workspaceRoot ||
    Deno.env.get("WORKSPACE_ROOT") || Deno.cwd();

  try {
    // Step 1: Detect VCS and current branch
    console.log(formatStep(1, "Detecting VCS and current branch..."));
    const vcsContext = await detectVcs();
    if (!vcsContext) {
      throw new Error(
        "Neither git nor sapling found. Make sure you're in a repository.",
      );
    }

    const currentBranch = await getCurrentBranch(vcsContext.vcs);
    console.log(
      formatInfo(`Using ${vcsContext.vcs}, current branch: ${currentBranch}`),
    );

    // Step 2: Fetch PR data with comments
    console.log(formatStep(2, "Fetching PR data and comments..."));
    const prData = await fetchPullRequestWithComments(config.prUrl);
    console.log(
      formatSuccess(
        `Fetched PR #${prData.number}: ${prData.title}`,
      ),
    );
    console.log(
      formatInfo(
        `Found ${prData.comments.length} conversation comments, ${prData.reviews.length} reviews`,
      ),
    );

    // Step 3: Check if we need to switch branches
    console.log(formatStep(3, "Checking branch status..."));
    if (currentBranch === prData.headRefName) {
      console.log(
        formatSuccess(
          `Already on correct branch: ${currentBranch}`,
        ),
      );
    } else {
      console.log(
        formatInfo(
          `Need to switch from ${currentBranch} to ${prData.headRefName}`,
        ),
      );
      await checkoutPRBranch(prData.number, prData.headRefName, vcsContext.vcs);
    }

    // Step 4: Create plan file
    console.log(formatStep(4, "Creating fixup plan..."));
    const tmpDir = await Deno.makeTempDir({ prefix: "geo-fixup-" });
    const planContent = createFixupPlan(prData);
    const planFilePath =
      `${workspaceRoot}/plans/fixup-pr-${prData.number}.plan.md`;

    // Ensure plans directory exists
    try {
      await Deno.mkdir(`${workspaceRoot}/plans`, { recursive: true });
    } catch {
      // Directory already exists
    }

    await Deno.writeTextFile(planFilePath, planContent);
    console.log(formatSuccess(`Plan file created: ${planFilePath}`));

    // Step 5: Run implement phase
    console.log(formatStep(5, "Running fixup implementation..."));

    // Load fixup system prompt
    let fixupSystemPromptPath: string;
    try {
      let promptContent = await readIncludedPrompt(
        "system.prompt.fixup.md",
        workspaceRoot,
      );

      const planPathInstruction =
        `\n\n## Plan File Path\n\n**CRITICAL**: You MUST update the Acceptance Criteria checklist in the plan file at this exact path:\n\n\`${planFilePath}\`\n\nUpdate the checkboxes to reflect what was actually addressed. This is MORE IMPORTANT than completing the implementation.\n`;

      if (
        promptContent.includes(
          "---\n\nThe PR context (description + comments) will be provided below.",
        )
      ) {
        promptContent = promptContent.replace(
          "---\n\nThe PR context (description + comments) will be provided below.",
          planPathInstruction +
            "\n---\n\nThe PR context (description + comments) will be provided below.",
        );
      } else {
        promptContent = promptContent + planPathInstruction;
      }

      fixupSystemPromptPath = `${tmpDir}/system.prompt.fixup.md`;
      await Deno.writeTextFile(fixupSystemPromptPath, promptContent);
    } catch (error) {
      throw new Error(
        `Fixup system prompt not found. Error: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }

    // Write plan output for the implement phase
    const planOutputPath = `${tmpDir}/plan_output.txt`;
    await Deno.writeTextFile(planOutputPath, planContent);

    // Assemble combined prompt
    const combinedPromptPath = `${tmpDir}/combined_prompt_implement.txt`;
    await assembleCombinedPrompt(
      combinedPromptPath,
      fixupSystemPromptPath,
      workspaceRoot,
      undefined, // No issue context needed - PR context is in the plan
      planOutputPath,
    );

    // Run the implement phase
    const runImplement = config.cursorEnabled ? runCursorAgent : runOpenCode;
    const implementResult = await runImplement(
      "implement",
      combinedPromptPath,
      workspaceRoot,
      false, // useReadonlyConfig
    );

    if (implementResult.code !== 0) {
      console.error("\n=== Implement Phase STDERR ===");
      console.error(implementResult.stderr || "(empty)");
      console.error("\n=== Implement Phase STDOUT ===");
      console.error(implementResult.stdout || "(empty)");
      throw new Error(
        `Implement phase failed with exit code ${implementResult.code}`,
      );
    }

    // Step 6: Report results
    console.log(`\n${formatSuccess("Fixup complete!")}`);
    console.log(
      formatInfo(
        "Changes have been applied to your local workspace. Review them and commit when ready.",
      ),
    );

    // Check if there are changes
    const hasChanges = vcsContext.vcs === "git"
      ? (await $`git status --porcelain`.text()).trim().length > 0
      : (await $`sl status --no-status`.text()).trim().length > 0;

    if (hasChanges) {
      console.log(
        `\n${
          formatInfo(
            "To view changes: " +
              (vcsContext.vcs === "git" ? "git diff" : "sl diff"),
          )
        }`,
      );
      console.log(
        formatInfo(
          "To commit changes: " +
            (vcsContext.vcs === "git"
              ? 'git add -A && git commit -m "Address PR feedback"'
              : 'sl add . && sl commit -m "Address PR feedback"'),
        ),
      );
    } else {
      console.log(
        `\n${formatWarning("No changes were made by the agent.")}`,
      );
    }

    Deno.exit(0);
  } catch (error) {
    console.error(
      `\n${
        formatError(error instanceof Error ? error.message : String(error))
      }`,
    );
    Deno.exit(1);
  }
}
