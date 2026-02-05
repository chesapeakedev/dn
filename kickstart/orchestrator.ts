// Copyright 2026 Chesapeake Computing
// SPDX-License-Identifier: Apache-2.0

import type { IssueData } from "../sdk/github/issue.ts";
import { fetchIssueFromUrl, writeIssueContext } from "../sdk/github/issue.ts";
import type { GitContext } from "../sdk/github/vcs.ts";
import {
  checkForChanges,
  cleanupBranch,
  commitAndPush,
  detectVcs,
  prepareVcsStateInteractive,
} from "../sdk/github/vcs.ts";
import { runCursorAgent } from "../sdk/github/cursorAgent.ts";
import { assembleCombinedPrompt } from "../sdk/github/prompt.ts";
import { runOpenCode } from "../sdk/github/opencode.ts";
import { createPR } from "../sdk/github/github.ts";
import type { PRPlanSummary } from "../sdk/github/github.ts";
import { createCursorRule, generateAgentsMd } from "./artifacts.ts";
import { extractPlanSummary } from "./lib.ts";
import type { PlanSummary } from "./lib.ts";
import {
  configureForCI,
  formatError,
  formatInfo,
  formatStep,
  formatSuccess,
  formatWarning,
} from "./output.ts";
import { $ } from "$dax";

/**
 * Detects if the implement phase output contains a blocking error.
 * Blocking errors are conditions that prevent implementation from proceeding.
 *
 * @param stdout - Standard output from the implement phase
 * @param stderr - Standard error from the implement phase
 * @returns Error message if blocking error detected, null otherwise
 */
function detectBlockingError(stdout: string, stderr: string): string | null {
  const combinedOutput = (stdout + "\n" + stderr).toLowerCase();

  // Patterns that indicate blocking errors
  const blockingPatterns = [
    /error:\s*cannot proceed/i,
    /error:\s*implementation blocked/i,
    /cannot proceed with implementation/i,
    /implementation blocked:/i,
    /codebase not present/i,
    /required.*not present/i,
    /missing.*codebase/i,
    /workspace.*not found/i,
    /critical.*missing/i,
  ];

  for (const pattern of blockingPatterns) {
    const match = combinedOutput.match(pattern);
    if (match) {
      // Extract the error message from the original output (preserve case)
      const originalOutput = stdout + "\n" + stderr;
      const errorMatch = originalOutput.match(new RegExp(pattern.source, "i"));
      if (errorMatch) {
        // Try to extract a few lines around the error for context
        const lines = originalOutput.split("\n");
        const errorLineIndex = lines.findIndex((line) =>
          pattern.test(line.toLowerCase())
        );
        if (errorLineIndex >= 0) {
          // Get the error line and a few surrounding lines for context
          const start = Math.max(0, errorLineIndex - 1);
          const end = Math.min(lines.length, errorLineIndex + 3);
          const errorContext = lines.slice(start, end).join("\n");
          return errorContext.trim();
        }
      }
      return match[0];
    }
  }

  return null;
}

/**
 * Get binary directory (works in both compiled binary and development mode)
 */
function getBinaryDir(): string {
  const url = new URL(import.meta.url);
  if (url.protocol === "file:") {
    return new URL(".", url).pathname;
  }
  return new URL(".", import.meta.url).pathname;
}

/**
 * Gets the path to the kickstart binary.
 * Works in both compiled binary and development mode.
 */
function getKickstartPath(): string {
  // In compiled binary, use exec path
  try {
    return Deno.execPath();
  } catch {
    // Fallback: try to detect from import.meta
    const url = new URL(import.meta.url);
    if (url.protocol === "file:") {
      return url.pathname;
    }
    return "kickstart";
  }
}

/**
 * Get workspace root (where opencode runs)
 */
function getWorkspaceRoot(): string {
  return Deno.env.get("WORKSPACE_ROOT") || Deno.cwd();
}

const BINARY_DIR = getBinaryDir();
const WORKSPACE_ROOT = getWorkspaceRoot();

/**
 * Read included system prompt (works in compiled binary and development mode)
 * @param filename - Name of the prompt file (e.g., "system.prompt.plan.md")
 * @returns Promise resolving to prompt file contents
 */
async function readIncludedPrompt(filename: string): Promise<string> {
  try {
    // Try included file first (works in compiled binary with --include flag)
    // import.meta.dirname points to the directory containing the executable
    // Check if import.meta.dirname is available (Deno 2.1+)
    if (typeof import.meta.dirname !== "undefined") {
      try {
        return await Deno.readTextFile(
          import.meta.dirname + `/${filename}`,
        );
      } catch {
        // Fall through to file system fallback
      }
    }
  } catch {
    // Fall through to file system fallback
  }

  // Fallback to file system (development mode)
  // Try binary directory first
  try {
    return await Deno.readTextFile(`${BINARY_DIR}/${filename}`);
  } catch {
    // Final fallback: try workspace root
    return await Deno.readTextFile(`${WORKSPACE_ROOT}/${filename}`);
  }
}

/**
 * Configuration for orchestrator execution.
 */
export interface OrchestratorConfig {
  /** Whether to run in awp mode (branches, commits, PRs) */
  awp: boolean;
  /** Whether to enable Cursor IDE integration (creates .cursor/rules/kickstart.mdc) */
  cursorEnabled: boolean;
  /** Issue URL to fetch */
  issueUrl: string | null;
  /** Whether to save context files on success */
  saveCtx: boolean;
  /** Whether to force a named plan to be saved */
  savePlan: boolean;
  /** Specific plan name to use (if provided via --saved-plan) */
  savedPlanName: string | null;
}

/**
 * Result of orchestrator execution.
 */
export interface OrchestratorResult {
  /** Whether execution succeeded */
  success: boolean;
  /** Path to temp directory (for debugging) */
  tmpDir: string;
  /** Path to plan output file */
  planOutputPath: string;
  /** Path to combined prompt files */
  combinedPromptPaths: {
    plan: string;
    implement: string;
  };
}

/**
 * Ensures the plans directory exists in the workspace root.
 *
 * @param workspaceRoot - Root directory of the workspace
 */
async function ensurePlansDirectory(workspaceRoot: string): Promise<void> {
  const plansDir = `${workspaceRoot}/plans`;
  try {
    await Deno.mkdir(plansDir, { recursive: true });
  } catch {
    // Directory already exists or creation failed - continue anyway
  }
}

/**
 * Prompts the user for a plan name with an optional suggestion.
 *
 * @param suggestion - Optional suggested plan name
 * @returns Promise resolving to the plan name chosen by the user
 */
function promptForPlanName(suggestion?: string): string {
  if (suggestion) {
    console.log(`\n${formatInfo(`Suggested plan name: ${suggestion}`)}`);
    const input = prompt(
      `Enter plan name (or press Enter to use suggested): `,
    );
    if (!input || input.trim() === "") {
      return suggestion;
    }
    return input.trim();
  } else {
    const input = prompt(`Enter plan name: `);
    if (!input || input.trim() === "") {
      throw new Error("Plan name is required");
    }
    return input.trim();
  }
}

/**
 * Prompts the user whether to continue an existing plan or start a new one.
 *
 * @param planPath - Path to the existing plan file
 * @returns Promise resolving to `true` if user wants to continue, `false` to start new
 */
function promptContinueOrNewPlan(planPath: string): boolean {
  console.log(`\n${formatInfo(`Found existing plan at: ${planPath}`)}`);
  const input = prompt(
    `Continue existing plan? (y/n, default: n): `,
  );

  if (!input || input.trim() === "") {
    return false;
  }

  const normalized = input.trim().toLowerCase();
  return normalized === "y" || normalized === "yes";
}

/**
 * Reads an existing plan file if it exists.
 *
 * @param planPath - Path to the plan file
 * @returns Promise resolving to plan content or null if file doesn't exist
 */
async function readExistingPlan(planPath: string): Promise<string | null> {
  try {
    const content = await Deno.readTextFile(planPath);
    return content;
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) {
      return null;
    }
    throw error;
  }
}

/**
 * Resolves the plan file path based on configuration and mode.
 *
 * @param config - Orchestrator configuration
 * @param workspaceRoot - Root directory of the workspace
 * @param gitContext - Git context (for branch name suggestion)
 * @returns The plan file path
 */
function resolvePlanFilePath(
  config: OrchestratorConfig,
  workspaceRoot: string,
  gitContext: GitContext | null,
): string {
  const plansDir = `${workspaceRoot}/plans`;

  // If savedPlanName is provided, use it
  if (config.savedPlanName) {
    return `${plansDir}/${config.savedPlanName}.plan.md`;
  }

  // Always prompt for plan name (suggest branch name if available)
  const suggestion = gitContext?.branchName || undefined;
  const planName = promptForPlanName(suggestion);
  return `${plansDir}/${planName}.plan.md`;
}

/**
 * Validates the plan file structure and required sections.
 *
 * @param planFilePath - Path to the plan file
 * @returns Promise resolving to `true` if plan file is valid
 * @throws Error if file doesn't exist, is malformed, or missing required sections
 */
async function checkPlanFile(planFilePath: string): Promise<boolean> {
  try {
    const content = await Deno.readTextFile(planFilePath);

    if (!content || content.trim().length === 0) {
      throw new Error(
        `Plan file exists but is empty at ${planFilePath}`,
      );
    }

    // Check for required sections
    const requiredSections = [
      /^#\s+.+$/m, // H1 title
      /^##\s+Overview/mi, // Overview section
      /^##\s+Implementation\s+Plan/mi, // Implementation Plan section
      /^##\s+Acceptance\s+Criteria/mi, // Acceptance Criteria section
    ];

    const missingSections: string[] = [];
    if (!requiredSections[0].test(content)) {
      missingSections.push("Title (H1)");
    }
    if (!requiredSections[1].test(content)) {
      missingSections.push("Overview");
    }
    if (!requiredSections[2].test(content)) {
      missingSections.push("Implementation Plan");
    }
    if (!requiredSections[3].test(content)) {
      missingSections.push("Acceptance Criteria");
    }

    if (missingSections.length > 0) {
      throw new Error(
        `Plan file is missing required sections: ${
          missingSections.join(", ")
        }. ` +
          `Required sections: Title (H1), Overview, Implementation Plan, Acceptance Criteria`,
      );
    }

    // Check for at least one checkbox in Acceptance Criteria
    const checkboxPattern = /^-\s+\[[\sx]\]/m;
    if (!checkboxPattern.test(content)) {
      throw new Error(
        `Plan file must contain at least one checkbox in Acceptance Criteria section. ` +
          `Use format: - [ ] Description`,
      );
    }

    return true;
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) {
      throw new Error(
        `Plan file not found at ${planFilePath}. Plan phase must create a plan file with all required sections.`,
      );
    }
    throw error;
  }
}

/**
 * Checks the completion status of acceptance criteria in a plan file.
 *
 * @param planFilePath - Path to the plan file
 * @returns Promise resolving to completion status with metrics
 */
async function checkAcceptanceCriteriaCompletion(
  planFilePath: string,
): Promise<{
  complete: boolean;
  total: number;
  completed: number;
  incomplete: string[];
}> {
  try {
    const content = await Deno.readTextFile(planFilePath);

    // Find the Acceptance Criteria section
    const acceptanceCriteriaMatch = content.match(
      /^##\s+Acceptance\s+Criteria\s*$/mi,
    );
    if (!acceptanceCriteriaMatch) {
      // No acceptance criteria section found
      return {
        complete: false,
        total: 0,
        completed: 0,
        incomplete: [],
      };
    }

    // Extract content from Acceptance Criteria section to end of file or next H2
    const startIndex = acceptanceCriteriaMatch.index! +
      acceptanceCriteriaMatch[0].length;
    const restOfContent = content.slice(startIndex);

    // Find the next H2 section (##) or end of file
    const nextSectionMatch = restOfContent.match(/^##\s+/m);
    const acceptanceCriteriaContent = nextSectionMatch
      ? restOfContent.slice(0, nextSectionMatch.index)
      : restOfContent;

    // Parse checkboxes: `- [ ]` (incomplete) and `- [x]` (complete)
    const checkboxPattern = /^-\s+\[([\sx])\]\s+(.+)$/gm;
    const checkboxes: Array<{ completed: boolean; text: string }> = [];
    let match;

    while ((match = checkboxPattern.exec(acceptanceCriteriaContent)) !== null) {
      const isCompleted = match[1].toLowerCase() === "x";
      const text = match[2].trim();
      checkboxes.push({ completed: isCompleted, text });
    }

    const total = checkboxes.length;
    const completed = checkboxes.filter((cb) => cb.completed).length;
    const incomplete = checkboxes
      .filter((cb) => !cb.completed)
      .map((cb) => cb.text);

    return {
      complete: total > 0 && completed === total,
      total,
      completed,
      incomplete,
    };
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) {
      return {
        complete: false,
        total: 0,
        completed: 0,
        incomplete: [],
      };
    }
    throw error;
  }
}

/**
 * Generates a continuation prompt for another agent to continue the work.
 *
 * @param planFilePath - Path to the plan file
 * @param issueData - Issue data (optional)
 * @param incompleteItems - List of incomplete acceptance criteria items
 * @param completedCount - Number of completed items
 * @param totalCount - Total number of items
 * @returns Markdown prompt string
 */
function _generateContinuationPrompt(
  planFilePath: string,
  issueData: IssueData | null,
  incompleteItems: string[],
  completedCount: number,
  totalCount: number,
): string {
  const workspaceRelativePath = planFilePath.replace(
    WORKSPACE_ROOT + "/",
    "",
  );
  const planName = planFilePath.split("/").pop()?.replace(".plan.md", "") ||
    "plan";

  let prompt = `# Continue Implementation: ${planName}\n\n`;
  prompt +=
    `This is a continuation prompt to complete the remaining work from a kickstart plan.\n\n`;

  if (issueData) {
    prompt += `## Issue Context\n\n`;
    prompt += `- **Issue**: #${issueData.number}\n`;
    prompt += `- **Title**: ${issueData.title}\n`;
    if (issueData.owner && issueData.repo) {
      prompt +=
        `- **URL**: https://github.com/${issueData.owner}/${issueData.repo}/issues/${issueData.number}\n`;
    }
    prompt += `\n`;
  }

  prompt += `## Plan File\n\n`;
  prompt += `The implementation plan is located at:\n\n`;
  prompt += `\`${workspaceRelativePath}\`\n\n`;
  prompt +=
    `**Important**: Read this plan file to understand the full context and requirements.\n\n`;

  prompt += `## Progress Summary\n\n`;
  prompt +=
    `Completed: **${completedCount}/${totalCount}** acceptance criteria\n\n`;

  if (incompleteItems.length > 0) {
    prompt += `## Remaining Tasks\n\n`;
    prompt += `The following acceptance criteria are still incomplete:\n\n`;
    for (const item of incompleteItems) {
      prompt += `- [ ] ${item}\n`;
    }
    prompt += `\n`;
  }

  prompt += `## Instructions\n\n`;
  prompt +=
    `1. **Read the plan file** at \`${workspaceRelativePath}\` to understand the full context\n`;
  prompt += `2. **Implement the remaining incomplete items** listed above\n`;
  prompt +=
    `3. **Update the Acceptance Criteria checklist** in the plan file as you complete each item\n`;
  prompt +=
    `4. Mark items as complete by changing \`- [ ]\` to \`- [x]\` in the plan file\n`;
  prompt +=
    `5. Follow the existing code patterns and conventions in the codebase\n`;
  prompt += `6. Ensure all code compiles and passes linting\n\n`;

  prompt += `## Plan File Location\n\n`;
  prompt += `The plan file is at: \`${workspaceRelativePath}\`\n\n`;
  prompt += `This file contains the complete implementation plan, including:\n`;
  prompt += `- Overview of the implementation\n`;
  prompt += `- Detailed implementation steps\n`;
  prompt += `- Acceptance criteria checklist (update this as you work)\n`;
  prompt += `- Code pointers and file locations\n\n`;

  prompt +=
    `**Remember**: Update the checklist in the plan file as you complete each item. `;
  prompt += `This helps track progress and ensures nothing is missed.\n`;

  return prompt;
}

/**
 * Merges a plan file and its continuation file into a single plan file.
 *
 * @param planFilePath - Path to the original plan file
 * @param continuationFilePath - Path to the continuation plan file
 * @param tmpDir - Temporary directory for merge operation
 * @param useCursorAgent - If true, use Cursor CLI instead of opencode
 * @returns Promise resolving to `true` if merge was successful
 */
async function _mergePlanFiles(
  planFilePath: string,
  continuationFilePath: string,
  tmpDir: string,
  useCursorAgent: boolean = false,
): Promise<boolean> {
  try {
    // Read both files
    const planContent = await Deno.readTextFile(planFilePath);
    const continuationContent = await Deno.readTextFile(continuationFilePath);

    // Load merge system prompt
    let mergeSystemPromptPath: string;
    try {
      let promptContent = await readIncludedPrompt("system.prompt.merge.md");

      // Inject plan file path into the prompt
      const planPathInstruction =
        `\n\n## Plan File Path\n\n**CRITICAL**: You must write the merged plan file to this exact path:\n\n\`${planFilePath}\`\n\nThis is the ONLY file you are allowed to create or modify.\n`;

      // Insert the plan path instruction before the "The original plan file" line
      if (promptContent.includes("---\n\nThe original plan file")) {
        promptContent = promptContent.replace(
          "---\n\nThe original plan file",
          planPathInstruction + "\n---\n\nThe original plan file",
        );
      } else {
        // Fallback: append at the end
        promptContent = promptContent + planPathInstruction;
      }

      // Write to temp file for assembleCombinedPrompt
      mergeSystemPromptPath = `${tmpDir}/system.prompt.merge.md`;
      await Deno.writeTextFile(mergeSystemPromptPath, promptContent);
    } catch (error) {
      console.warn(
        `⚠️  Merge system prompt not found. Error: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return false;
    }

    // Create combined prompt for merge
    const combinedPromptMergePath = `${tmpDir}/combined_prompt_merge.txt`;

    // Assemble merge prompt manually (we need to include both plan files)
    let mergePrompt = await Deno.readTextFile(mergeSystemPromptPath);
    mergePrompt += "\n\n---\n\n# Original Plan File\n\n";
    mergePrompt += planContent;
    mergePrompt += "\n\n---\n\n# Continuation Plan File\n\n";
    mergePrompt += continuationContent;

    await Deno.writeTextFile(combinedPromptMergePath, mergePrompt);

    // Run opencode merge phase (using implement config for write permissions)
    console.log(`\n${formatInfo("Merging plan files...")}`);
    console.log(
      formatInfo(
        `  Original: ${planFilePath.replace(WORKSPACE_ROOT + "/", "")}`,
      ),
    );
    console.log(
      formatInfo(
        `  Continuation: ${
          continuationFilePath.replace(WORKSPACE_ROOT + "/", "")
        }`,
      ),
    );

    const runMerge = useCursorAgent ? runCursorAgent : runOpenCode;
    const mergeResult = await runMerge(
      "implement", // Use implement phase for write permissions
      combinedPromptMergePath,
      WORKSPACE_ROOT,
      false, // useReadonlyConfig = false (need write permissions)
    );

    if (mergeResult.code !== 0) {
      console.warn(`\n${formatWarning("Merge phase failed (non-blocking):")}`);
      console.warn(mergeResult.stderr || "(empty)");
      return false;
    }

    // Verify the merged plan file exists and is valid
    try {
      await checkPlanFile(planFilePath);
      console.log(formatSuccess("Plan files merged successfully"));

      // Delete the continuation file since it's been merged
      try {
        await Deno.remove(continuationFilePath);
        console.log(
          formatSuccess(
            `Deleted continuation file: ${
              continuationFilePath.replace(WORKSPACE_ROOT + "/", "")
            }`,
          ),
        );
      } catch {
        // Non-blocking if deletion fails
        console.warn(
          formatWarning(
            `Could not delete continuation file: ${continuationFilePath}`,
          ),
        );
      }

      return true;
    } catch (error) {
      console.warn(
        formatWarning(
          `Merged plan file validation failed: ${
            error instanceof Error ? error.message : String(error)
          }`,
        ),
      );
      return false;
    }
  } catch (error) {
    console.warn(
      formatWarning(
        `Error merging plan files (non-blocking): ${
          error instanceof Error ? error.message : String(error)
        }`,
      ),
    );
    return false;
  }
}

/**
 * Attempts to open Cursor with a continuation prompt.
 *
 * @param prompt - The continuation prompt text
 * @param planFilePath - Path to the plan file
 * @returns Promise resolving to `true` if Cursor was opened, `false` otherwise
 */
async function _openCursorWithPrompt(
  prompt: string,
  planFilePath: string,
): Promise<boolean> {
  try {
    // Check if cursor command is available
    await $`which cursor`.quiet();
  } catch {
    // Cursor not found in PATH
    return false;
  }

  try {
    // Try to open Cursor with the workspace
    // Cursor CLI may support opening with a prompt, but we'll start with just opening the workspace
    // and saving the prompt to a file that can be referenced
    const workspaceRelativePath = planFilePath.replace(
      WORKSPACE_ROOT + "/",
      "",
    );
    const continuationFilePath = planFilePath.replace(
      ".plan.md",
      ".continuation.plan.md",
    );

    // Save the prompt to the continuation file
    await Deno.writeTextFile(continuationFilePath, prompt);

    // Try to open Cursor (this may not work on all systems, so we'll make it best-effort)
    try {
      // Attempt to open Cursor with the workspace
      // Note: Cursor CLI API may vary, this is a best-effort attempt
      await $`cursor ${workspaceRelativePath}`.quiet().noThrow();
      return true;
    } catch {
      // If opening fails, that's okay - we've saved the file
      return false;
    }
  } catch {
    return false;
  }
}

/**
 * Main orchestrator function that coordinates the two-phase workflow.
 *
 * @param config - Orchestrator configuration
 * @returns Promise resolving to orchestrator result
 */
export async function runOrchestrator(
  config: OrchestratorConfig,
): Promise<OrchestratorResult> {
  // Configure for CI environment (disables colors if in CI and NO_COLOR not already set)
  configureForCI();

  const { awp, issueUrl, saveCtx } = config;

  // Normalize path to avoid double slashes
  const normalizedWorkspaceRoot = WORKSPACE_ROOT.replace(/\/+$/, "");

  // Ensure plans directory exists
  await ensurePlansDirectory(normalizedWorkspaceRoot);

  // Create temp directory for this run
  const tmpDir = await Deno.makeTempDir({ prefix: "geo-opencode-" });
  const combinedPromptPlanPath = `${tmpDir}/combined_prompt_plan.txt`;
  const combinedPromptImplementPath = `${tmpDir}/combined_prompt_implement.txt`;
  const planOutputPath = `${tmpDir}/plan_output.txt`;
  const planStdoutPath = `${tmpDir}/plan_stdout.txt`;
  const planStderrPath = `${tmpDir}/plan_stderr.txt`;
  const implementStdoutPath = `${tmpDir}/implement_stdout.txt`;
  const implementStderrPath = `${tmpDir}/implement_stderr.txt`;

  let issueData: IssueData | null = null;
  let issueContextPathFinal: string | undefined;
  let gitContext: GitContext | null = null;
  let vcsType: "git" | "sapling" | null = null;

  try {
    // Step 1: Resolve issue context
    console.log(formatStep(1, "Resolving issue context..."));
    if (issueUrl) {
      issueData = await fetchIssueFromUrl(issueUrl);
      issueContextPathFinal = `${tmpDir}/issue-context.md`;
      await writeIssueContext(issueData, issueContextPathFinal);
    } else {
      throw new Error("No issue URL provided");
    }

    // Step 2: Prepare VCS state (only in awp mode)
    if (awp) {
      console.log(formatStep(2, "Preparing VCS state..."));
      gitContext = await prepareVcsStateInteractive(issueData);
      vcsType = gitContext.vcs;
    }
    // In default mode, we don't interact with VCS at the beginning.
    // VCS will be detected lazily only when needed (e.g., to show changes).

    // Step 2.5: Resolve plan file path
    const planFilePath = resolvePlanFilePath(
      config,
      normalizedWorkspaceRoot,
      gitContext,
    );

    // Step 2.6: Handle plan continuation (normal mode only)
    let existingPlanContent: string | null = null;
    let continueExistingPlan = false;
    if (!awp) {
      // In normal mode, check if plan exists and prompt to continue
      const existingPlan = await readExistingPlan(planFilePath);
      if (existingPlan) {
        continueExistingPlan = promptContinueOrNewPlan(planFilePath);
        if (continueExistingPlan) {
          existingPlanContent = existingPlan;
        }
      }
    }

    // Step 3: Plan Phase
    console.log(formatStep(3, "Running plan phase (read-only)..."));

    // Load plan system prompt (from included file or file system)
    let planSystemPromptPathFinal: string;
    try {
      // Try reading included file (works in compiled binary)
      let promptContent = await readIncludedPrompt("system.prompt.plan.md");

      // Inject plan file path into the prompt
      const planPathInstruction =
        `\n\n## Plan File Path\n\n**IMPORTANT**: You must write the plan file to this exact path:\n\n\`${planFilePath}\`\n\nThis is the ONLY file you are allowed to create or modify.\n`;

      // Insert the plan path instruction before the "The issue context will be provided below" line
      if (
        promptContent.includes(
          "---\n\nThe issue context will be provided below.",
        )
      ) {
        promptContent = promptContent.replace(
          "---\n\nThe issue context will be provided below.",
          planPathInstruction +
            "\n---\n\nThe issue context will be provided below.",
        );
      } else {
        // Fallback: append at the end
        promptContent = promptContent + planPathInstruction;
      }

      // If continuing existing plan, add a note
      if (continueExistingPlan) {
        const continuationNote =
          `\n\n**NOTE**: You are continuing an existing plan. Please review the "Previous Plan" section below and update the plan file accordingly. Preserve valid sections and enhance or correct as needed.\n`;
        promptContent = promptContent.replace(
          planPathInstruction,
          planPathInstruction + continuationNote,
        );
      }

      // Write to temp file for assembleCombinedPrompt
      planSystemPromptPathFinal = `${tmpDir}/system.prompt.plan.md`;
      await Deno.writeTextFile(planSystemPromptPathFinal, promptContent);
    } catch (error) {
      throw new Error(
        `Plan system prompt not found. Error: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }

    // Assemble prompt for plan phase
    await assembleCombinedPrompt(
      combinedPromptPlanPath,
      planSystemPromptPathFinal,
      WORKSPACE_ROOT,
      issueContextPathFinal,
      undefined, // planOutputPath (not used in plan phase)
      continueExistingPlan ? existingPlanContent : null,
    );

    // Run plan phase (opencode or Cursor agent per config)
    const runPlan = config.cursorEnabled ? runCursorAgent : runOpenCode;
    const planResult = await runPlan(
      "plan",
      combinedPromptPlanPath,
      WORKSPACE_ROOT,
      true, // useReadonlyConfig
    );

    // Save plan output
    await Deno.writeTextFile(planOutputPath, planResult.stdout);
    await Deno.writeTextFile(planStdoutPath, planResult.stdout);
    await Deno.writeTextFile(planStderrPath, planResult.stderr);

    if (planResult.code !== 0) {
      console.error("\n=== Plan Phase STDERR ===");
      console.error(planResult.stderr || "(empty)");
      console.error("\n=== Plan Phase STDOUT ===");
      console.error(planResult.stdout || "(empty)");
      throw new Error(
        `Plan phase failed with exit code ${planResult.code}`,
      );
    }

    // Check for plan file
    console.log(formatInfo("Validating plan file..."));
    await checkPlanFile(planFilePath);
    console.log(formatInfo(`Plan file location: ${planFilePath}`));

    console.log(formatSuccess("Plan phase completed successfully"));

    // Step 4: Implement Phase
    console.log(`\n${formatStep(4, "Running implement phase...")}`);

    // Load implement system prompt (from included file or file system)
    let implementSystemPromptPathFinal: string;
    try {
      // Try reading included file (works in compiled binary)
      let promptContent = await readIncludedPrompt(
        "system.prompt.implement.md",
      );

      // Inject plan file path into the prompt so agent knows where to update checklist
      const planPathInstruction =
        `\n\n## Plan File Path\n\n**CRITICAL**: You MUST update the Acceptance Criteria checklist in the plan file at this exact path:\n\n\`${planFilePath}\`\n\nUpdate the checkboxes to reflect what was actually implemented. This is MORE IMPORTANT than completing the implementation.\n`;

      // Insert the plan path instruction before "The issue context and plan output" line
      if (promptContent.includes("---\n\nThe issue context and plan output")) {
        promptContent = promptContent.replace(
          "---\n\nThe issue context and plan output",
          planPathInstruction + "\n---\n\nThe issue context and plan output",
        );
      } else {
        // Fallback: append at the end
        promptContent = promptContent + planPathInstruction;
      }

      // If successful, write to temp file for assembleCombinedPrompt
      implementSystemPromptPathFinal = `${tmpDir}/system.prompt.implement.md`;
      await Deno.writeTextFile(implementSystemPromptPathFinal, promptContent);
    } catch (error) {
      throw new Error(
        `Implement system prompt not found. Error: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }

    // Assemble prompt for implement phase (include plan output)
    await assembleCombinedPrompt(
      combinedPromptImplementPath,
      implementSystemPromptPathFinal,
      WORKSPACE_ROOT,
      issueContextPathFinal,
      planOutputPath, // Include plan output
    );

    // Run implement phase (opencode or Cursor agent per config)
    const runImplement = config.cursorEnabled ? runCursorAgent : runOpenCode;
    const implementResult = await runImplement(
      "implement",
      combinedPromptImplementPath,
      WORKSPACE_ROOT,
      false, // useReadonlyConfig
    );

    // Save implement output
    await Deno.writeTextFile(implementStdoutPath, implementResult.stdout);
    await Deno.writeTextFile(implementStderrPath, implementResult.stderr);

    if (implementResult.code !== 0) {
      console.error("\n=== Implement Phase STDERR ===");
      console.error(implementResult.stderr || "(empty)");
      console.error("\n=== Implement Phase STDOUT ===");
      console.error(implementResult.stdout || "(empty)");
      throw new Error(
        `Implement phase failed with exit code ${implementResult.code}`,
      );
    }

    // Check for blocking errors in the output (even if exit code is 0)
    const blockingError = detectBlockingError(
      implementResult.stdout,
      implementResult.stderr,
    );

    if (blockingError) {
      console.error(
        `\n${formatError("Blocking error detected in implement phase output")}`,
      );
      console.error(
        "\nThe agent reported a blocking error that prevents implementation:",
      );
      console.error("─".repeat(60));
      console.error(blockingError);
      console.error("─".repeat(60));
      console.error(
        "\nStopping execution. Steps 4.5, 5, 6, and 7 will not run.",
      );
      throw new Error(
        "Implementation blocked: Agent reported a blocking error. See output above for details.",
      );
    }

    // Note: The agent is responsible for updating the Acceptance Criteria checklist
    // in the plan file. We do not automatically update it here.

    // Step 4.5: Check completion status and handle continuation
    console.log(`\n${formatStep(4.5, "Checking completion status...")}`);
    const finalPlanFilePath = planFilePath;

    // Extract plan summary before checking completion (needed for PR description)
    // This must be done BEFORE potential plan deletion
    let planSummary: PlanSummary | null = null;
    try {
      planSummary = await extractPlanSummary(planFilePath);
    } catch (error) {
      console.warn(
        formatWarning(
          `Could not extract plan summary (non-blocking): ${
            error instanceof Error ? error.message : String(error)
          }`,
        ),
      );
    }

    try {
      const completionStatus = await checkAcceptanceCriteriaCompletion(
        planFilePath,
      );

      if (completionStatus.total > 0) {
        console.log(
          `\n📊 Completion Status: ${completionStatus.completed}/${completionStatus.total} acceptance criteria completed`,
        );

        if (!completionStatus.complete) {
          // Plan is incomplete
          console.log(
            `\n${
              formatWarning(
                `Plan is incomplete. ${completionStatus.incomplete.length} item(s) remaining.`,
              )
            }`,
          );

          // The plan file itself is the continuation point
          // The agent has already updated it, so we just inform the user
          console.log(
            `\n${
              formatInfo(
                `Plan file updated: ${
                  finalPlanFilePath.replace(WORKSPACE_ROOT + "/", "")
                }`,
              )
            }`,
          );
          console.log(
            `\n${
              formatInfo(
                "To continue this work, run: dn loop --plan-file " +
                  finalPlanFilePath.replace(WORKSPACE_ROOT + "/", "") + "",
              )
            }`,
          );
        } else {
          console.log(
            `\n${formatSuccess("All acceptance criteria completed!")}`,
          );

          // Delete plan file when all criteria are complete (AWP mode only)
          if (awp) {
            try {
              await Deno.remove(planFilePath);
              console.log(
                formatSuccess(
                  `Plan file deleted: ${
                    planFilePath.replace(WORKSPACE_ROOT + "/", "")
                  }`,
                ),
              );
            } catch (deleteError) {
              // Non-blocking: log warning but continue
              console.warn(
                formatWarning(
                  `Could not delete plan file (non-blocking): ${
                    deleteError instanceof Error
                      ? deleteError.message
                      : String(deleteError)
                  }`,
                ),
              );
            }
          }
        }
      } else {
        console.log(
          `\n${
            formatWarning(
              "No acceptance criteria found in plan file. Unable to determine completion status.",
            )
          }`,
        );
      }
    } catch (error) {
      // Non-blocking: log warning but continue
      console.warn(
        "\n⚠️  Error checking completion status (non-blocking):",
      );
      console.warn(error instanceof Error ? error.message : String(error));
    }

    // Step 5: Run linting (non-blocking)
    console.log(
      `\n${formatStep(5, "Running linting to improve code quality...")}`,
    );
    try {
      // Check for deno.json first
      try {
        await Deno.stat(`${WORKSPACE_ROOT}/deno.json`);
        // Try deno task check
        try {
          await $`cd ${WORKSPACE_ROOT} && deno task check`.quiet();
          console.log(formatSuccess("Linting passed (deno task check)"));
        } catch {
          // If task check fails, try individual commands
          try {
            await $`cd ${WORKSPACE_ROOT} && deno fmt`.quiet();
            await $`cd ${WORKSPACE_ROOT} && deno lint`.quiet();
            console.log(formatSuccess("Linting passed (deno fmt + lint)"));
          } catch (lintError) {
            console.warn(formatWarning("Linting found issues (non-blocking):"));
            console.warn(
              lintError instanceof Error
                ? lintError.message
                : String(lintError),
            );
          }
        }
      } catch {
        // Not a Deno project, check for package.json
        try {
          await Deno.stat(`${WORKSPACE_ROOT}/package.json`);
          try {
            await $`cd ${WORKSPACE_ROOT} && npm run lint`.quiet();
            console.log(formatSuccess("Linting passed (npm run lint)"));
          } catch (lintError) {
            console.warn(formatWarning("Linting found issues (non-blocking):"));
            console.warn(
              lintError instanceof Error
                ? lintError.message
                : String(lintError),
            );
          }
        } catch {
          console.log(
            formatInfo("No linting configuration detected, skipping lint step"),
          );
        }
      }
    } catch (error) {
      // Linting errors are non-blocking, just log a warning
      console.warn(
        formatWarning("Linting step encountered an error (non-blocking):"),
      );
      console.warn(error instanceof Error ? error.message : String(error));
    }

    // Step 6: Generate artifacts
    console.log(`\n${formatStep(6, "Generating workspace artifacts...")}`);
    try {
      // Read existing AGENTS.md if it exists
      let existingAgentsMd: string | undefined;
      try {
        existingAgentsMd = await Deno.readTextFile(
          `${WORKSPACE_ROOT}/AGENTS.md`,
        );
      } catch {
        // AGENTS.md doesn't exist, that's fine
      }

      // Generate/update AGENTS.md
      const wasNewFile = !existingAgentsMd;
      const agentsMdContent = await generateAgentsMd(
        WORKSPACE_ROOT,
        existingAgentsMd,
      );
      await Deno.writeTextFile(
        `${WORKSPACE_ROOT}/AGENTS.md`,
        agentsMdContent,
      );
      console.log(formatSuccess("Updated AGENTS.md with project guidelines"));

      // Print helpful message about AGENTS.md importance
      if (wasNewFile) {
        console.log(
          `\n${formatInfo("AGENTS.md has been created for this repository.")}`,
        );
        console.log(
          formatInfo("   This file is crucial for agentic coding workflows:"),
        );
        console.log(
          formatInfo(
            "   - It provides essential context to AI agents about your project",
          ),
        );
        console.log(
          formatInfo("   - It documents build, lint, and test commands"),
        );
        console.log(
          formatInfo(
            "   - It includes instructions for using kickstart as a subagent",
          ),
        );
        console.log(`\n${formatInfo("   Learn more about AGENTS.md:")}`);
        console.log(
          formatInfo("   - https://docs.opencode.dev/concepts/agents-md"),
        );
        console.log(
          formatInfo("   - https://github.com/opencode-dev/opencode"),
        );
      }

      // Create Cursor rule if enabled
      if (config.cursorEnabled) {
        const kickstartPath = getKickstartPath();
        await createCursorRule(WORKSPACE_ROOT, kickstartPath);
        console.log(
          formatSuccess(
            "Created .cursor/rules/kickstart.mdc for subagent integration",
          ),
        );
      }
    } catch (error) {
      // Artifact generation errors are non-blocking, just log a warning
      console.warn(
        "⚠️  Artifact generation encountered an error (non-blocking):",
      );
      console.warn(error instanceof Error ? error.message : String(error));
    }

    // Step 7: Validate changes
    console.log(`\n${formatStep(7, "Validating changes...")}`);

    // In non-AWP mode, detect VCS lazily only when needed (to show changes)
    // In AWP mode, vcsType is already set from prepareVcsStateInteractive
    if (!vcsType && !awp) {
      const vcsContext = await detectVcs();
      if (vcsContext) {
        vcsType = vcsContext.vcs;
      }
    }

    if (!vcsType) {
      // No VCS detected, just check if files changed (basic check)
      console.log(
        formatInfo(
          "No VCS detected. Changes have been applied to the workspace.",
        ),
      );
      if (!saveCtx) {
        await Deno.remove(tmpDir, { recursive: true });
      }
      return {
        success: true,
        tmpDir,
        planOutputPath,
        combinedPromptPaths: {
          plan: combinedPromptPlanPath,
          implement: combinedPromptImplementPath,
        },
      };
    }

    const hasChanges = await checkForChanges(vcsType);
    if (!hasChanges) {
      console.log(formatInfo("No changes were made by the agent."));
      if (awp && gitContext) {
        await cleanupBranch(gitContext);
      }
      if (!saveCtx) {
        await Deno.remove(tmpDir, { recursive: true });
      }
      return {
        success: true,
        tmpDir,
        planOutputPath,
        combinedPromptPaths: {
          plan: combinedPromptPlanPath,
          implement: combinedPromptImplementPath,
        },
      };
    }

    if (awp) {
      // Step 8: Commit and push
      console.log(`\n${formatStep(8, "Committing and pushing changes...")}`);
      if (!issueData || !gitContext) {
        throw new Error("Issue data and git context required for commit");
      }
      await commitAndPush(gitContext, issueData);

      // Step 9: Create PR
      console.log(`\n${formatStep(9, "Creating PR...")}`);

      // Convert PlanSummary to PRPlanSummary for createPR (if available)
      let prPlanSummary: PRPlanSummary | undefined;
      if (planSummary) {
        prPlanSummary = {
          overview: planSummary.overview,
          acceptanceCriteria: planSummary.acceptanceCriteria,
        };
      }

      const prUrl = await createPR(
        issueData,
        gitContext.branchName,
        gitContext.vcs,
        prPlanSummary,
      );
      if (prUrl) {
        console.log(`\n${formatSuccess(`PR created: ${prUrl}`)}`);
      } else {
        console.log(
          `\n${formatInfo(`PR creation skipped (using ${gitContext.vcs}).`)}`,
        );
        console.log(
          formatInfo(
            "   Please use the link shown in the push output above to create the PR manually.",
          ),
        );
      }
    } else {
      console.log(`\n${formatSuccess("Changes applied to workspace.")}`);
      console.log(
        formatInfo(
          "You can now review the changes, create a branch, commit, and open a PR as needed.",
        ),
      );
    }

    // Note: .plan.md is a workspace artifact and should NOT be cleaned up
    // It persists for Cursor integration and future reference

    // Cleanup temp directory
    if (!saveCtx) {
      await Deno.remove(tmpDir, { recursive: true });
    }
    return {
      success: true,
      tmpDir,
      planOutputPath,
      combinedPromptPaths: {
        plan: combinedPromptPlanPath,
        implement: combinedPromptImplementPath,
      },
    };
  } catch (error) {
    // Note: Plan files are workspace artifacts and should NOT be cleaned up
    // even on error, as they may contain useful information for debugging

    console.error(
      `\n${
        formatError(error instanceof Error ? error.message : String(error))
      }`,
    );
    console.error("\nDebug information:");
    console.error(`  - Temp directory: ${tmpDir}`);
    console.error(`  - Plan prompt: ${combinedPromptPlanPath}`);
    console.error(`  - Implement prompt: ${combinedPromptImplementPath}`);
    console.error(`  - Plan output: ${planOutputPath}`);
    if (issueContextPathFinal) {
      console.error(`  - Issue context: ${issueContextPathFinal}`);
    }
    console.error(`\nDebug files preserved in: ${tmpDir}`);
    console.error("Set SAVE_CTX=1 to preserve files on success as well.");
    if (awp && gitContext) {
      console.error(
        "\nNote: If a branch was created, you may need to manually clean it up.",
      );
    }

    throw error;
  }
}
