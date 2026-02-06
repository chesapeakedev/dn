// Copyright 2026 Chesapeake Computing
// SPDX-License-Identifier: Apache-2.0

/**
 * Kickstart Library Interface
 *
 * This module provides a reusable library interface for the kickstart workflow.
 * It extracts core functionality from orchestrator.ts into separate, composable functions.
 */

import type { IssueData } from "../sdk/github/issue.ts";
import {
  fetchIssueFromUrl,
  resolveIssueUrlInput,
  writeIssueContext,
} from "../sdk/github/issue.ts";
import {
  getCurrentRepoFromRemote,
  updateIssue,
} from "../sdk/github/github-gql.ts";
import type { GitContext } from "../sdk/github/vcs.ts";
import {
  checkForChanges,
  detectVcs,
  prepareVcsStateInteractive,
} from "../sdk/github/vcs.ts";
import { runCursorAgent } from "../sdk/github/cursorAgent.ts";
import { assembleCombinedPrompt } from "../sdk/github/prompt.ts";
import { runOpenCode } from "../sdk/github/opencode.ts";
import { createCursorRule, generateAgentsMd } from "./artifacts.ts";
import {
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

// Re-export types for convenience
export type { OrchestratorConfig, OrchestratorResult } from "./orchestrator.ts";

// ============================================================================
// Issue Template Parsing Utilities
// ============================================================================

/**
 * Represents a parsed section from an issue body
 */
export interface IssueSection {
  /** The section header (e.g., "## Current State") */
  header: string;
  /** The content of the section (excluding the header line) */
  content: string;
  /** Whether the section is considered empty */
  isEmpty: boolean;
  /** The start line number of the section (0-indexed) */
  startLine: number;
  /** The end line number of the section (0-indexed, exclusive) */
  endLine: number;
}

/**
 * Represents a parsed issue body with frontmatter and sections
 */
export interface ParsedIssueBody {
  /** Content above the first ## section (frontmatter) */
  frontmatter: string;
  /** Array of parsed sections */
  sections: IssueSection[];
}

/**
 * Checks if a section content is "empty" (contains only whitespace and/or HTML comments)
 *
 * @param content - The section content to check (excluding header)
 * @returns true if the section is considered empty
 */
export function isEmptySection(content: string): boolean {
  // Remove HTML comments (single and multiline)
  const withoutComments = content.replace(/<!--[\s\S]*?-->/g, "");
  // Check if only whitespace remains
  return withoutComments.trim() === "";
}

/**
 * Parses an issue body into frontmatter and sections
 *
 * @param body - The issue body markdown content
 * @returns Parsed issue body with frontmatter and sections
 */
export function parseIssueBody(body: string): ParsedIssueBody {
  const lines = body.split("\n");
  const sections: IssueSection[] = [];
  let frontmatterEndLine = 0;

  // Find the first ## section header
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].match(/^##\s+/)) {
      frontmatterEndLine = i;
      break;
    }
    // If we reach the end without finding a section, everything is frontmatter
    if (i === lines.length - 1) {
      frontmatterEndLine = lines.length;
    }
  }

  // Extract frontmatter (content above first ## section)
  const frontmatter = lines.slice(0, frontmatterEndLine).join("\n");

  // Parse sections
  let currentSectionStart = frontmatterEndLine;
  let currentHeader = "";

  for (let i = frontmatterEndLine; i < lines.length; i++) {
    const line = lines[i];
    const sectionMatch = line.match(/^##\s+(.+)$/);

    if (sectionMatch) {
      // If we have a previous section, save it
      if (currentHeader) {
        const sectionContent = lines.slice(currentSectionStart + 1, i).join(
          "\n",
        );
        sections.push({
          header: currentHeader,
          content: sectionContent,
          isEmpty: isEmptySection(sectionContent),
          startLine: currentSectionStart,
          endLine: i,
        });
      }
      // Start new section
      currentSectionStart = i;
      currentHeader = line;
    }
  }

  // Don't forget the last section
  if (currentHeader) {
    const sectionContent = lines.slice(currentSectionStart + 1).join("\n");
    sections.push({
      header: currentHeader,
      content: sectionContent,
      isEmpty: isEmptySection(sectionContent),
      startLine: currentSectionStart,
      endLine: lines.length,
    });
  }

  return {
    frontmatter,
    sections,
  };
}

/**
 * Result of verifying an issue update
 */
export interface VerificationResult {
  /** Whether the update is valid */
  valid: boolean;
  /** Array of error messages if invalid */
  errors: string[];
}

/**
 * Verifies that an issue update preserves frontmatter and non-empty sections
 *
 * @param original - The original parsed issue body
 * @param updatedBody - The updated issue body as a string
 * @returns Verification result with valid flag and any errors
 */
export function verifyIssueUpdate(
  original: ParsedIssueBody,
  updatedBody: string,
): VerificationResult {
  const errors: string[] = [];
  const updated = parseIssueBody(updatedBody);

  // Check 1: Frontmatter preservation
  const originalFrontmatterTrimmed = original.frontmatter.trim();
  const updatedFrontmatterTrimmed = updated.frontmatter.trim();
  if (originalFrontmatterTrimmed !== updatedFrontmatterTrimmed) {
    errors.push(
      "Frontmatter was modified. Content above the first ## section must be preserved.",
    );
  }

  // Check 2: All original sections must still be present
  const originalHeaders = original.sections.map((s) => s.header);
  const updatedHeaders = updated.sections.map((s) => s.header);

  for (const header of originalHeaders) {
    if (!updatedHeaders.includes(header)) {
      errors.push(`Missing section: ${header}`);
    }
  }

  // Check 3: Non-empty sections must have their content preserved
  for (const originalSection of original.sections) {
    if (!originalSection.isEmpty) {
      const updatedSection = updated.sections.find(
        (s) => s.header === originalSection.header,
      );
      if (updatedSection) {
        // Compare content (trim both for comparison)
        const originalContentTrimmed = originalSection.content.trim();
        const updatedContentTrimmed = updatedSection.content.trim();
        if (originalContentTrimmed !== updatedContentTrimmed) {
          errors.push(
            `Non-empty section "${originalSection.header}" was modified. Only empty sections should be filled.`,
          );
        }
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Result of filling empty issue sections
 */
export interface FillEmptyIssueSectionsResult {
  /** Whether the issue was updated */
  updated: boolean;
  /** The new issue body (if updated or dry run) */
  body: string;
  /** Array of sections that were filled */
  filledSections: string[];
  /** Array of sections that were already filled */
  skippedSections: string[];
  /** Error message if the operation failed */
  error?: string;
}

/**
 * Extended configuration that includes workspace root
 */
export interface KickstartConfig {
  /** Whether to run in awp mode (branches, commits, PRs) */
  awp: boolean;
  /** Whether to enable Cursor IDE integration */
  cursorEnabled: boolean;
  /** Issue URL to fetch */
  issueUrl: string | null;
  /** Whether to save context files on success */
  saveCtx: boolean;
  /** Whether to force a named plan to be saved */
  savePlan: boolean;
  /** Specific plan name to use */
  savedPlanName: string | null;
  /** Workspace root directory (defaults to cwd) */
  workspaceRoot?: string;
}

/**
 * Result of plan phase execution
 */
export interface PlanPhaseResult {
  /** Whether execution succeeded */
  success: boolean;
  /** Path to the created plan file */
  planFilePath: string;
  /** Issue data that was resolved */
  issueData: IssueData | null;
  /** Git context (if VCS prep was done) */
  gitContext: GitContext | null;
  /** Path to temp directory */
  tmpDir: string;
  /** Path to plan output file */
  planOutputPath: string;
  /** Path to combined plan prompt */
  combinedPromptPlanPath: string;
}

/**
 * Result of loop phase execution
 */
export interface LoopPhaseResult {
  /** Whether execution succeeded */
  success: boolean;
  /** Completion status from acceptance criteria */
  completionStatus: {
    complete: boolean;
    total: number;
    completed: number;
    incomplete: string[];
  };
  /** Path to continuation prompt file (if incomplete) */
  continuationPromptPath?: string;
  /** Path to temp directory */
  tmpDir: string;
  /** Path to combined implement prompt */
  combinedPromptImplementPath: string;
}

/**
 * Get workspace root (where opencode runs)
 */
function getWorkspaceRoot(config: KickstartConfig): string {
  return config.workspaceRoot || Deno.env.get("WORKSPACE_ROOT") || Deno.cwd();
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

const BINARY_DIR = getBinaryDir();

/**
 * Read included system prompt (works in compiled binary and development mode)
 */
async function readIncludedPrompt(
  filename: string,
  workspaceRoot: string,
): Promise<string> {
  try {
    // Try included file first (works in compiled binary with --include flag)
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
    return await Deno.readTextFile(`${workspaceRoot}/${filename}`);
  }
}

/**
 * Ensures the plans directory exists in the workspace root.
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
 * Resolves the plan file path based on configuration and mode.
 */
function resolvePlanFilePath(
  config: KickstartConfig,
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
  if (suggestion) {
    console.log(`\n${formatInfo(`Suggested plan name: ${suggestion}`)}`);
    const input = prompt(
      `Enter plan name (or press Enter to use suggested): `,
    );
    if (!input || input.trim() === "") {
      return `${plansDir}/${suggestion}.plan.md`;
    }
    return `${plansDir}/${input.trim()}.plan.md`;
  } else {
    const input = prompt(`Enter plan name: `);
    if (!input || input.trim() === "") {
      throw new Error("Plan name is required");
    }
    return `${plansDir}/${input.trim()}.plan.md`;
  }
}

/**
 * Reads an existing plan file if it exists.
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
 * Prompts the user for a plan name.
 */
function _promptForPlanName(): string {
  const input = prompt(`Enter plan name: `);
  if (!input || input.trim() === "") {
    throw new Error("Plan name is required");
  }
  return input.trim();
}

/**
 * Prompts the user whether to continue an existing plan or start a new one.
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
 * Validates the plan file structure and required sections.
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
 * Plan summary extracted from a plan file for use in PR descriptions.
 */
export interface PlanSummary {
  /** The H1 title of the plan */
  title: string;
  /** The overview/description of the plan (first ~300 characters) */
  overview: string;
  /** All acceptance criteria items */
  acceptanceCriteria: string[];
  /** Completion status metrics */
  completionStatus: { completed: number; total: number };
}

/**
 * Extracts a summary from a plan file for use in PR descriptions.
 *
 * @param planFilePath - Path to the plan file
 * @returns Promise resolving to plan summary, or null if file doesn't exist or is malformed
 */
export async function extractPlanSummary(
  planFilePath: string,
): Promise<PlanSummary | null> {
  try {
    const content = await Deno.readTextFile(planFilePath);

    // Extract H1 title
    const titleMatch = content.match(/^#\s+(.+)$/m);
    const title = titleMatch ? titleMatch[1].trim() : "";

    // Extract overview section (first ~300 characters from Overview section)
    const noFrontmatter = content.replace(/^---[\s\S]*?---\s*/i, "").trim();
    const afterH1 = noFrontmatter.replace(/^#\s+.+$/m, "").trim();
    const overviewMatch = afterH1.match(
      /^##\s+Overview\s*([\s\S]*?)(?=^##\s+|\z)/im,
    );
    const overviewText = overviewMatch
      ? overviewMatch[1].trim()
      : afterH1.slice(0, 300).trim();
    const overview = overviewText.slice(0, 300).replace(/\n+/g, " ");

    // Extract acceptance criteria items
    const acceptanceCriteriaMatch = content.match(
      /^##\s+Acceptance\s+Criteria\s*$/mi,
    );
    if (
      !acceptanceCriteriaMatch || acceptanceCriteriaMatch.index === undefined
    ) {
      return {
        title,
        overview,
        acceptanceCriteria: [],
        completionStatus: { completed: 0, total: 0 },
      };
    }

    const startIndex = acceptanceCriteriaMatch.index +
      acceptanceCriteriaMatch[0].length;
    const restOfContent = content.slice(startIndex);
    const nextSectionMatch = restOfContent.match(/^##\s+/m);
    const acceptanceCriteriaContent = nextSectionMatch
      ? restOfContent.slice(0, nextSectionMatch.index)
      : restOfContent;

    // Parse checkboxes: `- [ ]` (incomplete) and `- [x]` (complete)
    const checkboxPattern = /^-\s+\[([\sx])\]\s+(.+)$/gm;
    const acceptanceCriteria: string[] = [];
    let completed = 0;
    let match;

    while ((match = checkboxPattern.exec(acceptanceCriteriaContent)) !== null) {
      const isCompleted = match[1].toLowerCase() === "x";
      const text = match[2].trim();
      acceptanceCriteria.push(text);
      if (isCompleted) {
        completed++;
      }
    }

    return {
      title,
      overview,
      acceptanceCriteria,
      completionStatus: { completed, total: acceptanceCriteria.length },
    };
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) {
      return null;
    }
    throw error;
  }
}

/**
 * Generates a PR body from the plan summary.
 *
 * @param planSummary - The extracted plan summary
 * @param issueData - Issue data (for the "Closes" link)
 * @returns Formatted PR body markdown
 */
export function generatePRBodyFromPlan(
  planSummary: PlanSummary,
  issueData: IssueData,
): string {
  let body = "";

  // Summary section
  body += "## Summary\n\n";
  if (planSummary.overview) {
    body += planSummary.overview + "\n\n";
  } else if (planSummary.title) {
    body += planSummary.title + "\n\n";
  }

  // Changes section (list of acceptance criteria that were implemented)
  if (planSummary.acceptanceCriteria.length > 0) {
    body += "## Changes\n\n";
    for (const criterion of planSummary.acceptanceCriteria) {
      body += `- ${criterion}\n`;
    }
    body += "\n";
  }

  // Closes link
  body += `Closes #${issueData.number}\n`;

  return body;
}

/**
 * Checks the completion status of acceptance criteria in a plan file.
 */
export async function checkAcceptanceCriteriaCompletion(
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
 * Runs the plan phase (Steps 1-3): resolve issue, VCS prep (if AWP), plan phase
 */
export async function runPlanPhase(
  config: KickstartConfig,
): Promise<PlanPhaseResult> {
  const workspaceRoot = getWorkspaceRoot(config);
  const normalizedWorkspaceRoot = workspaceRoot.replace(/\/+$/, "");

  // Ensure plans directory exists
  await ensurePlansDirectory(normalizedWorkspaceRoot);

  // Create temp directory for this run
  const tmpDir = await Deno.makeTempDir({ prefix: "geo-opencode-" });
  const combinedPromptPlanPath = `${tmpDir}/combined_prompt_plan.txt`;
  const planOutputPath = `${tmpDir}/plan_output.txt`;

  let issueData: IssueData | null = null;
  let issueContextPathFinal: string | undefined;
  let gitContext: GitContext | null = null;

  try {
    // Step 1: Resolve issue context
    console.log(formatStep(1, "Resolving issue context..."));
    if (config.issueUrl) {
      const issueUrl = await resolveIssueUrlInput(config.issueUrl);
      issueData = await fetchIssueFromUrl(issueUrl);
      const currentRepo = await getCurrentRepoFromRemote();
      if (
        currentRepo.owner.toLowerCase() !== issueData.owner.toLowerCase() ||
        currentRepo.repo.toLowerCase() !== issueData.repo.toLowerCase()
      ) {
        throw new Error(
          `Issue URL points to a different repository (${issueData.owner}/${issueData.repo}) than the current workspace (${currentRepo.owner}/${currentRepo.repo}). Kickstart only supports implementing issues from the current repository.`,
        );
      }
      issueContextPathFinal = `${tmpDir}/issue-context.md`;
      await writeIssueContext(issueData, issueContextPathFinal);
    } else {
      throw new Error("No issue URL provided");
    }

    // Step 2: Prepare VCS state (only in awp mode)
    if (config.awp) {
      console.log(formatStep(2, "Preparing VCS state..."));
      gitContext = await prepareVcsStateInteractive(issueData);
    }

    // Step 2.5: Resolve plan file path
    const planFilePath = resolvePlanFilePath(
      config,
      normalizedWorkspaceRoot,
      gitContext,
    );

    // Step 2.6: Handle plan continuation (normal mode only)
    let existingPlanContent: string | null = null;
    let continueExistingPlan = false;
    if (!config.awp) {
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

    // Load plan system prompt
    let planSystemPromptPathFinal: string;
    try {
      let promptContent = await readIncludedPrompt(
        "system.prompt.plan.md",
        workspaceRoot,
      );

      const planPathInstruction =
        `\n\n## Plan File Path\n\n**IMPORTANT**: You must write the plan file to this exact path:\n\n\`${planFilePath}\`\n\nThis is the ONLY file you are allowed to create or modify.\n`;

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
        promptContent = promptContent + planPathInstruction;
      }

      if (continueExistingPlan) {
        const continuationNote =
          `\n\n**NOTE**: You are continuing an existing plan. Please review the "Previous Plan" section below and update the plan file accordingly. Preserve valid sections and enhance or correct as needed.\n`;
        promptContent = promptContent.replace(
          planPathInstruction,
          planPathInstruction + continuationNote,
        );
      }

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
      workspaceRoot,
      issueContextPathFinal,
      undefined, // planOutputPath (not used in plan phase)
      continueExistingPlan ? existingPlanContent : null,
    );

    // Run plan phase (opencode or Cursor agent per config)
    const runPlan = config.cursorEnabled ? runCursorAgent : runOpenCode;
    const planResult = await runPlan(
      "plan",
      combinedPromptPlanPath,
      workspaceRoot,
      true, // useReadonlyConfig
    );

    // Save plan output
    await Deno.writeTextFile(planOutputPath, planResult.stdout);

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

    return {
      success: true,
      planFilePath,
      issueData,
      gitContext,
      tmpDir,
      planOutputPath,
      combinedPromptPlanPath,
    };
  } catch (error) {
    console.error(
      `\n${
        formatError(error instanceof Error ? error.message : String(error))
      }`,
    );
    throw error;
  }
}

/**
 * Runs the loop phase (Steps 4-7): implement, completion check, lint, artifacts, validate
 */
export async function runLoopPhase(
  config: KickstartConfig,
  planFilePath: string,
  planOutputPath: string,
  _issueData: IssueData | null,
  tmpDir: string,
): Promise<LoopPhaseResult> {
  const workspaceRoot = getWorkspaceRoot(config);

  const combinedPromptImplementPath = `${tmpDir}/combined_prompt_implement.txt`;

  try {
    // Step 4: Implement Phase
    console.log(`\n${formatStep(4, "Running implement phase...")}`);

    // Load implement system prompt
    let implementSystemPromptPathFinal: string;
    try {
      let promptContent = await readIncludedPrompt(
        "system.prompt.implement.md",
        workspaceRoot,
      );

      const planPathInstruction =
        `\n\n## Plan File Path\n\n**CRITICAL**: You MUST update the Acceptance Criteria checklist in the plan file at this exact path:\n\n\`${planFilePath}\`\n\nUpdate the checkboxes to reflect what was actually implemented. This is MORE IMPORTANT than completing the implementation.\n`;

      if (promptContent.includes("---\n\nThe issue context and plan output")) {
        promptContent = promptContent.replace(
          "---\n\nThe issue context and plan output",
          planPathInstruction + "\n---\n\nThe issue context and plan output",
        );
      } else {
        promptContent = promptContent + planPathInstruction;
      }

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
      workspaceRoot,
      undefined, // issueContextPath - not needed in loop phase, plan file contains context
      planOutputPath, // Include plan output
    );

    // Run implement phase (opencode or Cursor agent per config)
    const runImplement = config.cursorEnabled ? runCursorAgent : runOpenCode;
    const implementResult = await runImplement(
      "implement",
      combinedPromptImplementPath,
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

    // Step 4.5: Check completion status
    console.log(`\n${formatStep(4.5, "Checking completion status...")}`);
    const completionStatus = await checkAcceptanceCriteriaCompletion(
      planFilePath,
    );

    let continuationPromptPath: string | undefined;

    if (completionStatus.total > 0) {
      console.log(
        `\n📊 Completion Status: ${completionStatus.completed}/${completionStatus.total} acceptance criteria completed`,
      );

      if (!completionStatus.complete) {
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
                planFilePath.replace(workspaceRoot + "/", "")
              }`,
            )
          }`,
        );
        console.log(
          `\n${
            formatInfo(
              "To continue this work, run: dn loop --plan-file " +
                planFilePath.replace(workspaceRoot + "/", "") + "",
            )
          }`,
        );
      } else {
        console.log(`\n${formatSuccess("All acceptance criteria completed!")}`);

        // Delete plan file when all criteria are complete (AWP mode only)
        if (config.awp) {
          try {
            await Deno.remove(planFilePath);
            console.log(
              formatSuccess(
                `Plan file deleted: ${
                  planFilePath.replace(workspaceRoot + "/", "")
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

    // Step 5: Run linting (non-blocking)
    console.log(
      `\n${formatStep(5, "Running linting to improve code quality...")}`,
    );
    try {
      try {
        await Deno.stat(`${workspaceRoot}/deno.json`);
        try {
          await $`cd ${workspaceRoot} && deno task check`.quiet();
          console.log(formatSuccess("Linting passed (deno task check)"));
        } catch {
          try {
            await $`cd ${workspaceRoot} && deno fmt`.quiet();
            await $`cd ${workspaceRoot} && deno lint`.quiet();
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
        try {
          await Deno.stat(`${workspaceRoot}/package.json`);
          try {
            await $`cd ${workspaceRoot} && npm run lint`.quiet();
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
      console.warn(
        formatWarning("Linting step encountered an error (non-blocking):"),
      );
      console.warn(error instanceof Error ? error.message : String(error));
    }

    // Step 6: Generate artifacts
    console.log(`\n${formatStep(6, "Generating workspace artifacts...")}`);
    try {
      let existingAgentsMd: string | undefined;
      try {
        existingAgentsMd = await Deno.readTextFile(
          `${workspaceRoot}/AGENTS.md`,
        );
      } catch {
        // AGENTS.md doesn't exist, that's fine
      }

      const wasNewFile = !existingAgentsMd;
      const agentsMdContent = await generateAgentsMd(
        workspaceRoot,
        existingAgentsMd,
      );
      await Deno.writeTextFile(
        `${workspaceRoot}/AGENTS.md`,
        agentsMdContent,
      );
      console.log(formatSuccess("Updated AGENTS.md with project guidelines"));

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
      }

      if (config.cursorEnabled) {
        // Get kickstart path - simplified for library
        const kickstartPath = "dn"; // Will be updated when CLI is created
        await createCursorRule(workspaceRoot, kickstartPath);
        console.log(
          formatSuccess(
            "Created .cursor/rules/kickstart.mdc for subagent integration",
          ),
        );
      }
    } catch (error) {
      console.warn(
        "⚠️  Artifact generation encountered an error (non-blocking):",
      );
      console.warn(error instanceof Error ? error.message : String(error));
    }

    // Step 7: Validate changes
    console.log(`\n${formatStep(7, "Validating changes...")}`);

    const vcsContext = await detectVcs();
    const vcsType = vcsContext?.vcs || null;

    if (!vcsType) {
      console.log(
        formatInfo(
          "No VCS detected. Changes have been applied to the workspace.",
        ),
      );
      return {
        success: true,
        completionStatus,
        continuationPromptPath,
        tmpDir,
        combinedPromptImplementPath,
      };
    }

    const hasChanges = await checkForChanges(vcsType);
    if (!hasChanges) {
      console.log(formatInfo("No changes were made by the agent."));
      return {
        success: true,
        completionStatus,
        continuationPromptPath,
        tmpDir,
        combinedPromptImplementPath,
      };
    }

    return {
      success: true,
      completionStatus,
      continuationPromptPath,
      tmpDir,
      combinedPromptImplementPath,
    };
  } catch (error) {
    console.error(
      `\n${
        formatError(error instanceof Error ? error.message : String(error))
      }`,
    );
    throw error;
  }
}

/**
 * Generates a continuation prompt for another agent to continue the work.
 */
function _generateContinuationPrompt(
  planFilePath: string,
  issueData: IssueData | null,
  incompleteItems: string[],
  completedCount: number,
  totalCount: number,
  workspaceRoot: string,
): string {
  const workspaceRelativePath = planFilePath.replace(
    workspaceRoot + "/",
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

  return prompt;
}

/**
 * Runs the full kickstart workflow (all steps)
 * This is a convenience function that delegates to the orchestrator
 */
export async function runFullKickstart(
  config: KickstartConfig,
): Promise<import("./orchestrator.ts").OrchestratorResult> {
  // Import here to avoid circular dependency
  const { runOrchestrator } = await import("./orchestrator.ts");
  // Import type separately - OrchestratorConfig is already re-exported at top of file
  type OrchestratorConfig = import("./orchestrator.ts").OrchestratorConfig;

  // Convert KickstartConfig to OrchestratorConfig (they're compatible, just drop workspaceRoot)
  const orchestratorConfig: OrchestratorConfig = {
    awp: config.awp,
    cursorEnabled: config.cursorEnabled,
    issueUrl: config.issueUrl,
    saveCtx: config.saveCtx,
    savePlan: config.savePlan,
    savedPlanName: config.savedPlanName,
  };

  // Set workspace root via environment if provided
  if (config.workspaceRoot) {
    Deno.env.set("WORKSPACE_ROOT", config.workspaceRoot);
  }

  return await runOrchestrator(orchestratorConfig);
}

// ============================================================================
// Issue Description Update Workflow
// ============================================================================

/**
 * Get binary directory (works in both compiled binary and development mode)
 */
function getPrepPromptDir(): string {
  const url = new URL(import.meta.url);
  if (url.protocol === "file:") {
    return new URL(".", url).pathname;
  }
  return new URL(".", import.meta.url).pathname;
}

const PREP_PROMPT_DIR = getPrepPromptDir();

/**
 * Read the prep system prompt (works in compiled binary and development mode)
 */
async function readPrepSystemPrompt(workspaceRoot: string): Promise<string> {
  const filename = "system.prompt.prep.md";

  try {
    // Try included file first (works in compiled binary with --include flag)
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
    return await Deno.readTextFile(`${PREP_PROMPT_DIR}/${filename}`);
  } catch {
    // Try workspace root dn/kickstart directory
    try {
      return await Deno.readTextFile(
        `${workspaceRoot}/dn/kickstart/${filename}`,
      );
    } catch {
      throw new Error(
        `Prep system prompt not found. Looked in: ${PREP_PROMPT_DIR}/${filename} and ${workspaceRoot}/dn/kickstart/${filename}`,
      );
    }
  }
}

/**
 * Fills empty sections in a GitHub issue using an LLM
 *
 * @param issueUrl - GitHub issue URL or issue number
 * @param workspaceRoot - Root directory of the workspace
 * @param dryRun - If true, preview changes without updating GitHub
 * @param cursorEnabled - If true, use Cursor agent instead of opencode
 * @returns Result of the operation
 */
export async function fillEmptyIssueSections(
  issueUrl: string,
  workspaceRoot: string,
  dryRun: boolean = false,
  cursorEnabled: boolean = false,
): Promise<FillEmptyIssueSectionsResult> {
  try {
    // Step 1: Resolve and fetch issue
    console.log(formatStep(1, "Fetching issue from GitHub..."));
    const resolvedUrl = await resolveIssueUrlInput(issueUrl);
    const issueData = await fetchIssueFromUrl(resolvedUrl);

    console.log(
      formatInfo(
        `Found issue #${issueData.number}: ${issueData.title}`,
      ),
    );

    // Step 2: Parse issue body and detect empty sections
    console.log(formatStep(2, "Analyzing issue template sections..."));
    const parsed = parseIssueBody(issueData.body);

    const emptySections = parsed.sections.filter((s) => s.isEmpty);
    const nonEmptySections = parsed.sections.filter((s) => !s.isEmpty);

    if (emptySections.length === 0) {
      console.log(formatSuccess("All sections are already filled."));
      return {
        updated: false,
        body: issueData.body,
        filledSections: [],
        skippedSections: nonEmptySections.map((s) => s.header),
      };
    }

    console.log(
      formatInfo(
        `Found ${emptySections.length} empty section(s): ${
          emptySections.map((s) => s.header.replace("## ", "")).join(", ")
        }`,
      ),
    );
    if (nonEmptySections.length > 0) {
      console.log(
        formatInfo(
          `Preserving ${nonEmptySections.length} non-empty section(s): ${
            nonEmptySections.map((s) => s.header.replace("## ", "")).join(", ")
          }`,
        ),
      );
    }

    // Step 3: Load system prompt and run LLM
    console.log(formatStep(3, "Running LLM to fill empty sections..."));

    // Create temp directory for this run
    const tmpDir = await Deno.makeTempDir({ prefix: "geo-prep-" });
    const combinedPromptPath = `${tmpDir}/combined_prompt_prep.txt`;
    const issueContextPath = `${tmpDir}/issue-context.md`;

    try {
      // Write issue context
      // Extract only the sections part (without frontmatter) to send to LLM
      const originalSectionsOnly = parsed.sections
        .map((s) => `${s.header}\n${s.content}`)
        .join("\n\n");

      let issueContext = `# Issue #${issueData.number}: ${issueData.title}\n\n`;
      issueContext += `## Empty Sections to Fill\n\n`;
      for (const section of emptySections) {
        issueContext += `-${
          section.header.replace("## ", "")
        } (currently empty)\n`;
      }
      issueContext += `\n## Current Issue Sections\n\n`;
      issueContext +=
        "Only fill the empty sections. Preserve section headers exactly.\n\n";
      issueContext += "```markdown\n";
      issueContext += originalSectionsOnly;
      issueContext += "\n```\n";

      await Deno.writeTextFile(issueContextPath, issueContext);

      // Load and prepare system prompt
      const systemPrompt = await readPrepSystemPrompt(workspaceRoot);
      const systemPromptPath = `${tmpDir}/system.prompt.prep.md`;
      await Deno.writeTextFile(systemPromptPath, systemPrompt);

      // Assemble combined prompt
      await assembleCombinedPrompt(
        combinedPromptPath,
        systemPromptPath,
        workspaceRoot,
        issueContextPath,
      );

      // Run LLM (opencode or Cursor agent per config)
      const runLlm = cursorEnabled ? runCursorAgent : runOpenCode;
      const result = await runLlm(
        "plan", // Use plan phase (read-only except for output)
        combinedPromptPath,
        workspaceRoot,
        true, // Use readonly config
      );

      if (result.code !== 0) {
        return {
          updated: false,
          body: issueData.body,
          filledSections: [],
          skippedSections: nonEmptySections.map((s) => s.header),
          error: `LLM failed with exit code ${result.code}: ${result.stderr}`,
        };
      }

      // Extract the updated sections from stdout
      // The LLM should output just the sections, but we need to clean it
      let llmOutput = result.stdout.trim();

      // Remove any markdown code fences if the LLM wrapped the output
      if (
        llmOutput.startsWith("```markdown") || llmOutput.startsWith("```md")
      ) {
        llmOutput = llmOutput.replace(/^```(?:markdown|md)?\n/, "").replace(
          /\n```$/,
          "",
        );
      } else if (llmOutput.startsWith("```")) {
        llmOutput = llmOutput.replace(/^```\n/, "").replace(/\n```$/, "");
      }

      // Step 4: Reassemble and verify
      console.log(formatStep(4, "Reassembling issue body..."));

      // Strip any frontmatter from LLM output (in case it included text before ##)
      const llmLines = llmOutput.split("\n");
      let firstSectionIndex = 0;
      for (let i = 0; i < llmLines.length; i++) {
        if (llmLines[i].match(/^##\s+/)) {
          firstSectionIndex = i;
          break;
        }
      }
      const sectionsOnly = llmLines.slice(firstSectionIndex).join("\n");

      // Reassemble: original frontmatter + sections from LLM
      const updatedBody = parsed.frontmatter
        ? parsed.frontmatter + "\n\n" + sectionsOnly
        : sectionsOnly;

      // Parse the updated body to see which sections were filled
      const updatedParsed = parseIssueBody(updatedBody);
      const filledSections = updatedParsed.sections
        .filter((s) => {
          const original = parsed.sections.find((o) => o.header === s.header);
          return original?.isEmpty && !s.isEmpty;
        })
        .map((s) => s.header);

      // Simple verification: check all original sections are present
      const missingSections = parsed.sections
        .filter((s) =>
          !updatedParsed.sections.find((u) => u.header === s.header)
        );

      if (missingSections.length > 0) {
        console.error(formatError("Verification failed:"));
        console.error(
          `  - Missing sections: ${
            missingSections.map((s) => s.header).join(", ")
          }`,
        );
        return {
          updated: false,
          body: issueData.body,
          filledSections: [],
          skippedSections: nonEmptySections.map((s) => s.header),
          error: `Verification failed: Missing sections - ${
            missingSections.map((s) => s.header).join(", ")
          }`,
        };
      }

      console.log(formatSuccess("Reassembly complete"));

      // Step 5: Update the issue (if not dry run)
      if (dryRun) {
        console.log(
          formatInfo("Dry run mode - issue will not be updated on GitHub"),
        );
        console.log("\n--- Updated Issue Body Preview ---\n");
        console.log(updatedBody);
        console.log("\n--- End Preview ---\n");
        return {
          updated: false,
          body: updatedBody,
          filledSections,
          skippedSections: nonEmptySections.map((s) => s.header),
        };
      }

      console.log(formatStep(5, "Updating issue on GitHub..."));
      await updateIssue(issueData.owner, issueData.repo, issueData.number, {
        body: updatedBody,
      });

      console.log(
        formatSuccess(
          `Issue #${issueData.number} updated successfully`,
        ),
      );

      return {
        updated: true,
        body: updatedBody,
        filledSections,
        skippedSections: nonEmptySections.map((s) => s.header),
      };
    } finally {
      // Clean up temp directory
      try {
        await Deno.remove(tmpDir, { recursive: true });
      } catch {
        // Ignore cleanup errors
      }
    }
  } catch (error) {
    return {
      updated: false,
      body: "",
      filledSections: [],
      skippedSections: [],
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
