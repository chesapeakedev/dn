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
  parseIssueFromFile,
  resolveIssueUrlInput,
  summarizeIssueForDisplay,
  writeIssueContext,
} from "../sdk/github/issue.ts";
import {
  addIssueComment,
  getCurrentRepoFromRemote,
  updateIssue,
} from "../sdk/github/github-gql.ts";
import type { GitContext } from "../sdk/github/vcs.ts";
import {
  checkForChanges,
  detectVcs,
  prepareVcsForKickstart,
} from "../sdk/github/vcs.ts";
import type { AgentHarness } from "../sdk/github/agentHarness.ts";
import { formatAgentHarnessName } from "../sdk/github/agentHarness.ts";
import type { PublishMode } from "../sdk/github/publish.ts";
import { isUnattended } from "../sdk/github/output.ts";
import { augmentOpenCodePlanEditPermission } from "../sdk/github/opencode.ts";
import {
  confirmCreateFile,
  confirmDestructiveOverwrite,
  confirmMergeIntoExisting,
  dnAutoApproved,
} from "../sdk/github/filePrompt.ts";
import { assembleCombinedPrompt } from "../sdk/github/prompt.ts";
import { getMilestoneFromInput } from "../sdk/github/milestone.ts";
import type { Milestone } from "../sdk/github/milestone.ts";
import { getMilestoneDescriptionArtifactPath } from "../sdk/github/stack.ts";
import { stringifyFrontmatter } from "../sdk/todo/frontmatter.ts";
import { meldTargetSystemPromptFile } from "../sdk/meld/prompts.ts";
import { parseMeldTarget } from "../sdk/meld/target.ts";
import {
  assertNonEmptyGithubBody,
  checkMeldMarkdownOutput,
  type MeldNonPlanMarkdownKind,
} from "../sdk/meld/validate.ts";
import { createCursorRule } from "./artifacts.ts";
import { completionStatusFromPlanContent } from "./planCompletion.ts";
import {
  formatError,
  formatInfo,
  formatStep,
  formatSuccess,
  formatWarning,
} from "./output.ts";
import type { SandboxFlagValue } from "../sdk/sandbox/resolve.ts";
import {
  createRunTmpDir,
  isSandboxActive,
  runAgentPhaseInSandbox,
  translateSandboxCwd,
} from "../sdk/sandbox/mod.ts";
import { $ } from "$dax";

const MILESTONE_PREP_FIXTURE_ENV = "DN_PREP_MILESTONE_FIXTURE";
const MILESTONE_PREP_FAKE_OUTPUT_ENV = "DN_PREP_MILESTONE_FAKE_OUTPUT";

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
  /** How changes are published to the remote repository */
  publish: PublishMode;
  /** Which agent harness runs plan/implement phases (OpenCode, Cursor, or Claude Code) */
  agentHarness: AgentHarness;
  /** Whether to allow cross-repository operations */
  allowCrossRepo: boolean;
  /** Issue URL to fetch (mutually exclusive with contextMarkdownPath) */
  issueUrl: string | null;
  /** Path to markdown file to use as issue context (e.g. from meld); skips fetch */
  contextMarkdownPath?: string;
  /** Whether to save context files on success */
  saveCtx: boolean;
  /** Specific plan name to use */
  savedPlanName: string | null;
  /** Workspace root directory (defaults to cwd) */
  workspaceRoot?: string;
  /** Sandbox provider override from CLI or env (phase 1: lifecycle only). */
  sandboxFlag?: SandboxFlagValue | null;
  /** Milestone number or URL to use milestone-linked plan file */
  milestone?: string;
  /** Optional flags when invoked from {@link dn meld} only */
  meldPhase?: MeldPhaseCliOptions;
}

/**
 * Parsed `--target`/`--overwrite`/`--dry-run` flags exposed from {@link dn meld}.
 */
export interface MeldPhaseCliOptions {
  /** Literal `--target` string or `null` for legacy default plan naming */
  targetRaw: string | null;
  /** Replace destinations instead of merge-style edits */
  overwrite: boolean;
  /** Resolve paths/context but skip invoking agents/GitHub mutations */
  dryRun: boolean;
  /** Non-interactive approval (`--yes` / DN_YES parity) */
  autoYes: boolean;
}

function defaultMeldCliOptions(): MeldPhaseCliOptions {
  return {
    targetRaw: null,
    overwrite: false,
    dryRun: false,
    autoYes: false,
  };
}

/**
 * Result of plan phase execution
 */
export interface PlanPhaseResult {
  /** Whether execution succeeded */
  success: boolean;
  /** Path to the created plan file */
  planFilePath: string;
  /** Issue URL for GitHub meld workflows (optional convenience) */
  publishedUrl?: string;
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
 *
 * @param issueHint - Fetched issue or parsed markdown context (shown before the plan name prompt)
 */
function resolvePlanFilePath(
  config: KickstartConfig,
  workspaceRoot: string,
  gitContext: GitContext | null,
  issueHint: IssueData | null,
): string {
  const plansDir = `${workspaceRoot}/plans`;

  // If savedPlanName is provided, use it
  if (config.savedPlanName) {
    return `${plansDir}/${config.savedPlanName}.plan.md`;
  }

  if (issueHint) {
    console.log(
      `\n${formatInfo(`Issue: ${summarizeIssueForDisplay(issueHint)}`)}`,
    );
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
    return completionStatusFromPlanContent(content);
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
 * Runs contextual planning for `dn meld` or bespoke Markdown/GitHub outputs.
 */
export async function runMeldPhase(
  config: KickstartConfig,
): Promise<PlanPhaseResult> {
  const workspaceRoot = getWorkspaceRoot(config);
  const normalizedWorkspaceRoot = workspaceRoot.replace(/\/+$/, "");
  const melOpts = config.meldPhase ?? defaultMeldCliOptions();

  await ensurePlansDirectory(normalizedWorkspaceRoot);

  const tmpDir = await createRunTmpDir(
    normalizedWorkspaceRoot,
    "geo-opencode-",
  );
  const combinedPromptPlanPath = `${tmpDir}/combined_prompt_plan.txt`;
  const planOutputPath = `${tmpDir}/plan_output.txt`;

  let issueData: IssueData | null = null;
  let issueContextPathFinal: string | undefined;
  let gitContext: GitContext | null = null;
  let publishedUrl: string | undefined;

  try {
    console.log(formatStep(1, "Resolving issue context..."));
    if (config.contextMarkdownPath) {
      issueContextPathFinal = config.contextMarkdownPath;
      issueData = null;
    } else if (config.issueUrl) {
      const issueUrl = await resolveIssueUrlInput(config.issueUrl);
      issueData = await fetchIssueFromUrl(issueUrl);
      const currentRepo = await getCurrentRepoFromRemote();
      if (
        currentRepo.owner.toLowerCase() !== issueData.owner.toLowerCase() ||
        currentRepo.repo.toLowerCase() !== issueData.repo.toLowerCase()
      ) {
        if (!config.allowCrossRepo) {
          throw new Error(
            `Issue URL points to a different repository (${issueData.owner}/${issueData.repo}) than the current workspace (${currentRepo.owner}/${currentRepo.repo}). Use --allow-cross-repo to enable cross-repository operations.`,
          );
        }
        if (config.publish !== "none") {
          throw new Error(
            `Cross-repository operations are not supported with AWP mode. AWP involves VCS operations that require the issue and current workspace to be in the same repository.`,
          );
        }
        console.log(
          formatWarning(
            `Cross-repository operation: Implementing issue from ${issueData.owner}/${issueData.repo} in workspace ${currentRepo.owner}/${currentRepo.repo}`,
          ),
        );
      }
      issueContextPathFinal = `${tmpDir}/issue-context.md`;
      await writeIssueContext(issueData, issueContextPathFinal);
    } else {
      throw new Error(
        "No issue URL or context path provided. Set issueUrl or contextMarkdownPath.",
      );
    }

    if (config.publish !== "none" && issueData !== null) {
      console.log(formatStep(2, "Preparing VCS state..."));
      gitContext = await prepareVcsForKickstart(config.publish, issueData);
    }

    const parsedTarget = await parseMeldTarget(
      melOpts.targetRaw,
      normalizedWorkspaceRoot,
    );

    let ghIssuePayload: IssueData | null = null;
    if (
      parsedTarget.kind === "github-issue" ||
      parsedTarget.kind === "github-comment"
    ) {
      const ghSpec = parsedTarget.github;
      if (!ghSpec) {
        throw new Error("GitHub meld target parsing failed unexpectedly.");
      }
      const ghResolvedUrl = await resolveIssueUrlInput(ghSpec.issueSpecifier);
      ghIssuePayload = await fetchIssueFromUrl(ghResolvedUrl);
      const ghRepoHint = await getCurrentRepoFromRemote();
      if (
        ghRepoHint.owner.toLowerCase() !== ghIssuePayload.owner.toLowerCase() ||
        ghRepoHint.repo.toLowerCase() !== ghIssuePayload.repo.toLowerCase()
      ) {
        throw new Error(
          `GitHub meld targets must reference issues in ${ghRepoHint.owner}/${ghRepoHint.repo}. Issue belongs to ${ghIssuePayload.owner}/${ghIssuePayload.repo}.`,
        );
      }
    }

    let issueHintForPlanName: IssueData | null = ghIssuePayload ?? issueData ??
      null;

    if (!issueHintForPlanName && issueContextPathFinal) {
      issueHintForPlanName = await parseIssueFromFile(issueContextPathFinal);
    }

    const isGithubOutput = parsedTarget.kind === "github-issue" ||
      parsedTarget.kind === "github-comment";

    let stagingRelGithub: string | null = null;
    let outputAbsolute: string;

    if (isGithubOutput) {
      stagingRelGithub = `plans/.meld-staging-${crypto.randomUUID()}.md`;
      outputAbsolute = `${normalizedWorkspaceRoot}/${stagingRelGithub}`;
    } else if (parsedTarget.isDefaultPlan) {
      outputAbsolute = resolvePlanFilePath(
        config,
        normalizedWorkspaceRoot,
        gitContext,
        issueHintForPlanName,
      );
    } else if (parsedTarget.workspaceRelativePath) {
      outputAbsolute =
        `${normalizedWorkspaceRoot}/${parsedTarget.workspaceRelativePath}`;
    } else {
      throw new Error("Unable to derive meld output path");
    }

    const normalizedRootPosix = normalizedWorkspaceRoot.replace(/\\/g, "/")
      .replace(/\/+$/, "");

    let displayRelative = outputAbsolute.replace(/\\/g, "/").replace(
      normalizedRootPosix.endsWith("/")
        ? normalizedRootPosix
        : normalizedRootPosix + "/",
      "",
    );
    displayRelative = displayRelative.replace(/^\/+/, "");

    const isMarkdownDocTarget = !isGithubOutput && parsedTarget.kind !== "plan";

    let existingDocContent: string | null = null;
    if (isMarkdownDocTarget) {
      existingDocContent = await readExistingPlan(outputAbsolute);
      const docExistsOnDisk = existingDocContent !== null;
      if (!melOpts.dryRun) {
        if (!docExistsOnDisk) {
          if (!confirmCreateFile(displayRelative, melOpts.autoYes)) {
            throw new Error("Aborted meld confirmation (create declined).");
          }
        } else if (melOpts.overwrite) {
          if (!confirmDestructiveOverwrite(displayRelative, melOpts.autoYes)) {
            throw new Error(
              "Aborted meld confirmation (overwrite declined).",
            );
          }
        } else if (
          !confirmMergeIntoExisting(displayRelative, melOpts.autoYes)
        ) {
          throw new Error("Aborted meld confirmation (merge declined).");
        }
      }
    }

    if (
      isGithubOutput && !melOpts.dryRun && isUnattended() &&
      !dnAutoApproved(melOpts.autoYes)
    ) {
      throw new Error(
        "GitHub meld outputs require `--yes` or `DN_YES=1` while unattended.",
      );
    }

    if (melOpts.dryRun) {
      console.log(
        formatInfo(
          `Dry-run: skipping agent + validation. Output path → ${displayRelative}`,
        ),
      );
      if (stagingRelGithub) {
        console.log(
          formatInfo(
            `GitHub staging would use ./${stagingRelGithub} (${parsedTarget.kind}).`,
          ),
        );
      }
      return {
        success: true,
        planFilePath: outputAbsolute,
        publishedUrl,
        issueData: ghIssuePayload ?? issueData,
        gitContext,
        tmpDir,
        planOutputPath,
        combinedPromptPlanPath,
      };
    }

    if (isGithubOutput) {
      await Deno.writeTextFile(outputAbsolute, "");
    }

    const shouldAugmentTarget = stagingRelGithub !== null ||
      !(parsedTarget.isDefaultPlan && parsedTarget.kind === "plan");
    if (shouldAugmentTarget) {
      await augmentOpenCodePlanEditPermission(
        normalizedWorkspaceRoot,
        stagingRelGithub ?? displayRelative,
      );
    }

    let existingPlanContent: string | null = null;
    let continueExistingPlan = false;
    if (parsedTarget.kind === "plan" && config.publish === "none") {
      const existingPlan = await readExistingPlan(outputAbsolute);
      if (existingPlan) {
        continueExistingPlan = promptContinueOrNewPlan(outputAbsolute);
        if (continueExistingPlan) {
          existingPlanContent = existingPlan;
        }
      }
    }

    console.log(
      formatStep(
        3,
        `Running ${
          formatAgentHarnessName(config.agentHarness)
        } for plan phase (read-only)...`,
      ),
    );

    const promptFilename = meldTargetSystemPromptFile(parsedTarget.kind);

    let systemPromptTmp: string;
    try {
      let promptContent = await readIncludedPrompt(
        promptFilename,
        workspaceRoot,
      );

      const pathInjection = parsedTarget.kind === "plan"
        ? `\n\n## Plan File Path\n\n**IMPORTANT**: You must write the plan file to this exact path:\n\n\`${outputAbsolute}\`\n\nThis is the ONLY file you are allowed to create or modify.\n`
        : `\n\n## Target Output Path\n\nYou may edit **only**:\n\n\`${outputAbsolute}\`\n\nEvery other writable action is forbidden—operate strictly in READ-ONLY mode away from this path.\n`;

      const sentinel = "---\n\nThe issue context will be provided below.";
      if (promptContent.includes(sentinel)) {
        promptContent = promptContent.replace(
          sentinel,
          pathInjection + "\n" + sentinel,
        );
      } else {
        promptContent = promptContent + pathInjection;
      }

      if (continueExistingPlan) {
        const continuationNote =
          `\n\n**NOTE**: Continuing an existing plan. Review \"Previous Plan\" below; preserve unchanged sections whenever they remain accurate.\n`;
        promptContent = promptContent.replace(
          pathInjection,
          pathInjection + continuationNote,
        );
      }

      const sanitizedName = promptFilename.replace(/[^\w.-]+/g, "_");
      systemPromptTmp = `${tmpDir}/runtime.${sanitizedName}`;
      await Deno.writeTextFile(systemPromptTmp, promptContent);
    } catch (error) {
      throw new Error(
        `System prompt (${promptFilename}) missing. ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }

    const mergedDocForPrompt = isMarkdownDocTarget && !melOpts.overwrite &&
        typeof existingDocContent === "string"
      ? existingDocContent
      : undefined;

    const githubBodyForPrompt = parsedTarget.kind === "github-issue"
      ? (ghIssuePayload?.body ?? "")
      : undefined;

    await assembleCombinedPrompt(
      combinedPromptPlanPath,
      systemPromptTmp,
      workspaceRoot,
      issueContextPathFinal,
      undefined,
      continueExistingPlan ? existingPlanContent : null,
      mergedDocForPrompt,
      githubBodyForPrompt,
    );

    const planResult = await runAgentPhaseInSandbox(
      "plan",
      combinedPromptPlanPath,
      workspaceRoot,
      true,
      config.agentHarness,
    );

    await Deno.writeTextFile(planOutputPath, planResult.stdout);

    if (planResult.code !== 0) {
      console.error("\n=== Plan Phase STDERR ===");
      console.error(planResult.stderr || "(empty)");
      console.error("\n=== Plan Phase STDOUT ===");
      console.error(planResult.stdout || "(empty)");
      const hint = (planResult.stderr || "").includes("resource_exhausted")
        ? " (often rate limit or quota from the AI backend—retry later or check API limits)"
        : "";
      throw new Error(
        `Plan phase failed with exit code ${planResult.code}${hint}`,
      );
    }

    if (
      stagingRelGithub && parsedTarget.kind === "github-issue"
    ) {
      const draftedBody = (await Deno.readTextFile(outputAbsolute)).trim();
      assertNonEmptyGithubBody(parsedTarget.kind, draftedBody);
      if (!ghIssuePayload) {
        throw new Error(
          "Internal error: GitHub issue target missing fetched issue data.",
        );
      }
      const updateRes = await updateIssue(
        ghIssuePayload.owner,
        ghIssuePayload.repo,
        ghIssuePayload.number,
        { body: draftedBody },
      );
      publishedUrl = updateRes.url;
      try {
        await Deno.remove(outputAbsolute);
      } catch {
        // best-effort cleanup
      }
    } else if (
      stagingRelGithub && parsedTarget.kind === "github-comment"
    ) {
      const commentBody = (await Deno.readTextFile(outputAbsolute)).trim();
      assertNonEmptyGithubBody(parsedTarget.kind, commentBody);
      if (!ghIssuePayload) {
        throw new Error(
          "Internal error: GitHub comment target missing fetched issue data.",
        );
      }
      const commentResult = await addIssueComment(
        ghIssuePayload.owner,
        ghIssuePayload.repo,
        ghIssuePayload.number,
        commentBody,
      );
      publishedUrl = commentResult.url;
      try {
        await Deno.remove(outputAbsolute);
      } catch {
        // non-fatal
      }
    } else if (parsedTarget.kind === "plan") {
      console.log(formatInfo("Validating plan file..."));
      await checkPlanFile(outputAbsolute);
      console.log(formatInfo(`Plan file location: ${outputAbsolute}`));
    } else if (isMarkdownDocTarget) {
      await checkMeldMarkdownOutput(
        parsedTarget.kind as MeldNonPlanMarkdownKind,
        outputAbsolute,
      );
      console.log(
        formatInfo(`Meld markdown output refreshed (${displayRelative}).`),
      );
    }

    console.log(formatSuccess("Plan phase completed successfully"));

    return {
      success: true,
      planFilePath: outputAbsolute,
      publishedUrl,
      issueData: ghIssuePayload ?? issueData,
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

export async function runPlanPhase(
  config: KickstartConfig,
): Promise<PlanPhaseResult> {
  return await runMeldPhase(config);
}

/**
 * Runs the loop phase (Steps 4-7): implement, completion check, lint, artifacts, validate
 */
export async function runLoopPhase(
  config: KickstartConfig,
  planFilePath: string,
  planOutputPath: string,
  issueData: IssueData | null,
  tmpDir: string,
): Promise<LoopPhaseResult> {
  const workspaceRoot = getWorkspaceRoot(config);

  const combinedPromptImplementPath = `${tmpDir}/combined_prompt_implement.txt`;

  try {
    // Step 4: Implement Phase
    console.log(
      `\n${
        formatStep(
          4,
          `Running ${
            formatAgentHarnessName(config.agentHarness)
          } for implement phase...`,
        )
      }`,
    );

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

    let issueContextPathForPrompt: string | undefined;
    if (issueData) {
      const issueMarkdownPath = `${tmpDir}/issue-context.md`;
      await writeIssueContext(issueData, issueMarkdownPath);
      issueContextPathForPrompt = issueMarkdownPath;
    }

    // Assemble prompt for implement phase (include plan output and optional issue markdown)
    await assembleCombinedPrompt(
      combinedPromptImplementPath,
      implementSystemPromptPathFinal,
      workspaceRoot,
      issueContextPathForPrompt,
      planOutputPath, // Include plan output
    );

    // Run implement phase (opencode, Cursor, or Claude Code per config)
    const implementResult = await runAgentPhaseInSandbox(
      "implement",
      combinedPromptImplementPath,
      workspaceRoot,
      false, // useReadonlyConfig
      config.agentHarness,
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
              "To continue this work, run: dn loop " +
                planFilePath.replace(workspaceRoot + "/", "") + "",
            )
          }`,
        );
      } else {
        console.log(`\n${formatSuccess("All acceptance criteria completed!")}`);

        // Delete plan file when all criteria are complete (AWP mode only)
        if (config.publish !== "none") {
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
      if (isSandboxActive()) {
        const ctx = (await import("../sdk/sandbox/context.ts"))
          .getCurrentSandboxContext();
        if (ctx) {
          try {
            const lintResult = await ctx.runner.exec(
              ctx.handle,
              ["deno", "task", "check"],
              { cwd: translateSandboxCwd(workspaceRoot) },
            );
            if (lintResult.code === 0) {
              console.log(
                formatSuccess("Linting passed (deno task check in sandbox)"),
              );
            } else {
              console.warn(
                formatWarning(
                  "Linting found issues in sandbox (non-blocking):",
                ),
              );
              console.warn(lintResult.stderr || lintResult.stdout);
            }
          } catch {
            console.warn(
              formatWarning("Linting in sandbox failed (non-blocking)"),
            );
          }
        }
      } else {
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
              console.warn(
                formatWarning("Linting found issues (non-blocking):"),
              );
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
              console.warn(
                formatWarning("Linting found issues (non-blocking):"),
              );
              console.warn(
                lintError instanceof Error
                  ? lintError.message
                  : String(lintError),
              );
            }
          } catch {
            console.log(
              formatInfo(
                "No linting configuration detected, skipping lint step",
              ),
            );
          }
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
      if (config.agentHarness === "cursor") {
        await createCursorRule(workspaceRoot);
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
    publish: config.publish,
    agentHarness: config.agentHarness,
    issueUrl: config.issueUrl,
    contextMarkdownPath: config.contextMarkdownPath,
    saveCtx: config.saveCtx,
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
        `Prep system prompt not found. Looked in: ${PREP_PROMPT_DIR}/${filename} and ${workspaceRoot}/kickstart/${filename}`,
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
 * @param agentHarness - Which agent runs the prep LLM (default opencode)
 * @returns Result of the operation
 */
export async function fillEmptyIssueSections(
  issueUrl: string,
  workspaceRoot: string,
  dryRun: boolean = false,
  agentHarness: AgentHarness = "opencode",
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

    // Detect if sections are completely missing (no ## headers at all)
    const noSectionsExist = parsed.sections.length === 0;

    // If no sections exist, treat the entire description as "Current State" context
    // and create the standard three-section template
    if (noSectionsExist) {
      console.log(
        formatInfo(
          "No issue template sections detected - will create template",
        ),
      );
    } else if (emptySections.length === 0) {
      console.log(formatSuccess("All sections are already filled."));
      return {
        updated: false,
        body: issueData.body,
        filledSections: [],
        skippedSections: nonEmptySections.map((s) => s.header),
      };
    }

    if (!noSectionsExist && emptySections.length > 0) {
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
              nonEmptySections.map((s) => s.header.replace("## ", "")).join(
                ", ",
              )
            }`,
          ),
        );
      }
    }

    // Step 3: Load system prompt and run LLM
    console.log(
      formatStep(
        3,
        `Running ${
          formatAgentHarnessName(agentHarness)
        } to fill empty sections...`,
      ),
    );

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

      // Handle case where no sections exist at all vs some empty sections
      if (noSectionsExist) {
        // No ## headers exist - need to create the template from scratch
        // Use the issue description (frontmatter) as the basis
        issueContext += `## Sections to Create and Fill\n\n`;
        issueContext +=
          `- Current State (create section and describe current situation)\n`;
        issueContext +=
          `- Expected State (create section and describe desired outcome)\n`;
        issueContext +=
          `- Additional Context (create section with relevant details)\n`;
        issueContext += `\n## Issue Description\n\n`;
        issueContext +=
          "The issue has no template sections. Create the standard three-section template and fill in content based on the issue title and description above.\n\n";
        // Use frontmatter as the "content" since there are no sections
        issueContext += "```markdown\n";
        issueContext += parsed.frontmatter || "(No description provided)";
        issueContext += "\n```\n";
      } else {
        // Standard case: fill existing empty sections
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
      }

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

      // Run LLM (opencode, Cursor, or Claude Code per harness)
      const result = await runAgentPhaseInSandbox(
        "plan", // Use plan phase (read-only except for output)
        combinedPromptPath,
        workspaceRoot,
        true, // Use readonly config
        agentHarness,
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

      let filledSections: string[];
      let skippedSections: string[];

      if (noSectionsExist) {
        // Verify that new sections were created when none existed before
        const expectedHeaders = [
          "## Current State",
          "## Expected State",
          "## Additional Context",
        ];
        const createdSections = updatedParsed.sections.filter((s) =>
          expectedHeaders.includes(s.header)
        );

        if (createdSections.length === 0) {
          console.error(formatError("Verification failed:"));
          console.error(
            "  - No template sections were created from the issue description",
          );
          return {
            updated: false,
            body: issueData.body,
            filledSections: [],
            skippedSections: [],
            error:
              "Verification failed: No template sections were created. Expected Current State, Expected State, and Additional Context sections.",
          };
        }

        filledSections = createdSections.map((s) => s.header);
        skippedSections = [];
      } else {
        // Standard case: verify that empty sections were filled
        filledSections = updatedParsed.sections
          .filter((s) => {
            const original = parsed.sections.find(
              (o) => o.header === s.header,
            );
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

        skippedSections = nonEmptySections.map((s) => s.header);
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
          skippedSections,
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

/**
 * Result of generating a milestone description artifact.
 */
export interface MilestonePrepResult {
  /** Whether the description artifact was written successfully */
  success: boolean;
  /** Path to the generated milestone description file */
  descriptionFilePath: string;
  /** Milestone metadata from GitHub */
  milestone: Milestone | null;
  /** Error message when generation failed */
  error?: string;
}

/**
 * Reads the milestone prep system prompt (works in compiled binary and development mode).
 */
async function readMilestonePrepSystemPrompt(
  workspaceRoot: string,
): Promise<string> {
  const filename = "system.prompt.prep.milestone.md";
  return await readIncludedPrompt(filename, workspaceRoot);
}

/**
 * Formats milestone issue context for the milestone prep LLM prompt.
 */
function formatMilestoneIssueContext(
  milestone: Milestone,
  owner: string,
  repo: string,
): string {
  const lines: string[] = [];
  lines.push(`# Milestone #${milestone.number}: ${milestone.title}`);
  lines.push("");
  lines.push(`Repository: ${owner}/${repo}`);
  if (milestone.description?.trim()) {
    lines.push("");
    lines.push("## Current Milestone Description");
    lines.push("");
    lines.push(milestone.description.trim());
  }
  lines.push("");
  lines.push(`## Issues (${milestone.issues.length})`);
  lines.push("");

  if (milestone.issues.length === 0) {
    lines.push("No open issues are assigned to this milestone.");
    return lines.join("\n");
  }

  for (const issue of milestone.issues) {
    lines.push(`### #${issue.number}: ${issue.title}`);
    lines.push("");
    lines.push(`URL: ${issue.url}`);
    if (issue.labels.length > 0) {
      lines.push(`Labels: ${issue.labels.join(", ")}`);
    }
    lines.push("");
    lines.push(issue.body.trim() || "(No description provided)");
    lines.push("");
    lines.push("---");
    lines.push("");
  }

  return lines.join("\n").replace(/\n---\n$/, "");
}

/**
 * Strips markdown code fences from agent stdout when present.
 */
function stripMarkdownCodeFences(output: string): string {
  let cleaned = output.trim();
  if (cleaned.startsWith("```markdown") || cleaned.startsWith("```md")) {
    cleaned = cleaned.replace(/^```(?:markdown|md)?\n/, "").replace(
      /\n```$/,
      "",
    );
  } else if (cleaned.startsWith("```")) {
    cleaned = cleaned.replace(/^```\n/, "").replace(/\n```$/, "");
  }
  return cleaned.trim();
}

function isFixtureRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isMilestonePrepFixture(
  value: unknown,
): value is { owner: string; repo: string; milestone: Milestone } {
  if (!isFixtureRecord(value)) return false;
  const { owner, repo, milestone } = value;
  if (
    typeof owner !== "string" || typeof repo !== "string" ||
    !isFixtureRecord(milestone) || !Array.isArray(milestone.issues)
  ) {
    return false;
  }

  return typeof milestone.id === "string" &&
    typeof milestone.number === "number" &&
    typeof milestone.title === "string" &&
    (typeof milestone.description === "string" ||
      milestone.description === null) &&
    typeof milestone.state === "string" &&
    (typeof milestone.dueOn === "string" || milestone.dueOn === null) &&
    typeof milestone.creator === "string" &&
    typeof milestone.createdAt === "string" &&
    typeof milestone.updatedAt === "string" &&
    milestone.issues.every((issue) =>
      isFixtureRecord(issue) && typeof issue.number === "number" &&
      typeof issue.title === "string" && typeof issue.body === "string" &&
      typeof issue.state === "string" && typeof issue.author === "string" &&
      Array.isArray(issue.labels) &&
      issue.labels.every((label) => typeof label === "string") &&
      typeof issue.url === "string"
    );
}

async function getMilestoneForPrep(
  milestoneInput: string,
): Promise<{ milestone: Milestone; owner: string; repo: string }> {
  const fixture = Deno.env.get(MILESTONE_PREP_FIXTURE_ENV);
  if (fixture === undefined) {
    return await getMilestoneFromInput(milestoneInput);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(fixture);
  } catch {
    throw new Error(`${MILESTONE_PREP_FIXTURE_ENV} must contain valid JSON.`);
  }
  if (!isMilestonePrepFixture(parsed)) {
    throw new Error(
      `${MILESTONE_PREP_FIXTURE_ENV} must contain milestone fixture data.`,
    );
  }
  return parsed;
}

/**
 * Fetches milestone issues and generates a user-value-focused description artifact.
 *
 * @param milestoneInput - Milestone number, title, or URL
 * @param workspaceRoot - Root directory of the workspace
 * @param agentHarness - Which agent runs the prep LLM (default opencode)
 * @returns Result including the written artifact path
 */
export async function generateMilestoneDescription(
  milestoneInput: string,
  workspaceRoot: string,
  agentHarness: AgentHarness = "opencode",
): Promise<MilestonePrepResult> {
  const normalizedWorkspaceRoot = workspaceRoot.replace(/\/+$/, "");

  try {
    console.log(formatStep(1, "Fetching milestone from GitHub..."));
    const { milestone, owner, repo } = await getMilestoneForPrep(
      milestoneInput,
    );

    console.log(
      formatInfo(
        `Found milestone #${milestone.number}: ${milestone.title} (${milestone.issues.length} open issue(s))`,
      ),
    );

    await ensurePlansDirectory(normalizedWorkspaceRoot);
    const descriptionFilePath = getMilestoneDescriptionArtifactPath(
      normalizedWorkspaceRoot,
      owner,
      repo,
      milestone.number,
    );

    console.log(
      formatStep(
        2,
        `Running ${
          formatAgentHarnessName(agentHarness)
        } to synthesize milestone description...`,
      ),
    );

    const tmpDir = await Deno.makeTempDir({ prefix: "geo-prep-milestone-" });
    const combinedPromptPath = `${tmpDir}/combined_prompt_prep_milestone.txt`;
    const milestoneContextPath = `${tmpDir}/milestone-context.md`;

    try {
      await Deno.writeTextFile(
        milestoneContextPath,
        formatMilestoneIssueContext(milestone, owner, repo),
      );

      const systemPrompt = await readMilestonePrepSystemPrompt(
        normalizedWorkspaceRoot,
      );
      const systemPromptPath = `${tmpDir}/system.prompt.prep.milestone.md`;
      await Deno.writeTextFile(systemPromptPath, systemPrompt);

      await assembleCombinedPrompt(
        combinedPromptPath,
        systemPromptPath,
        normalizedWorkspaceRoot,
        milestoneContextPath,
      );

      const fakeOutput = Deno.env.get(MILESTONE_PREP_FAKE_OUTPUT_ENV);
      const result = fakeOutput === undefined
        ? await runAgentPhaseInSandbox(
          "plan",
          combinedPromptPath,
          normalizedWorkspaceRoot,
          true,
          agentHarness,
        )
        : { code: 0, stdout: fakeOutput, stderr: "" };

      if (result.code !== 0) {
        return {
          success: false,
          descriptionFilePath,
          milestone,
          error: `LLM failed with exit code ${result.code}: ${result.stderr}`,
        };
      }

      const descriptionBody = stripMarkdownCodeFences(result.stdout);
      if (!descriptionBody) {
        return {
          success: false,
          descriptionFilePath,
          milestone,
          error: "LLM returned an empty milestone description.",
        };
      }

      console.log(formatStep(3, "Writing milestone description artifact..."));

      const today = new Date().toISOString().slice(0, 10);
      const generatedAt = new Date().toISOString();
      const frontmatter: Record<string, string> = {
        milestone: String(milestone.number),
        milestone_title: milestone.title,
        repo: `${owner}/${repo}`,
        updated: today,
        generated_at: generatedAt,
        issue_count: String(milestone.issues.length),
      };

      const artifact = stringifyFrontmatter(
        frontmatter,
        [
          "<!--",
          "  SYSTEM: This file is a milestone description generated by `dn meld --milestone`.",
          "  Paste or adapt the body below into the GitHub milestone description field.",
          "-->",
          "",
          `# Milestone: ${milestone.title}`,
          "",
          descriptionBody,
        ].join("\n"),
      );

      await Deno.writeTextFile(descriptionFilePath, artifact);
      console.log(
        formatSuccess(`Milestone description written: ${descriptionFilePath}`),
      );

      return {
        success: true,
        descriptionFilePath,
        milestone,
      };
    } finally {
      try {
        await Deno.remove(tmpDir, { recursive: true });
      } catch {
        // Ignore cleanup errors
      }
    }
  } catch (error) {
    return {
      success: false,
      descriptionFilePath: "",
      milestone: null,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
