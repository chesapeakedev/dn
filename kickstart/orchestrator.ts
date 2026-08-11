// Copyright 2026 Chesapeake Computing
// SPDX-License-Identifier: Apache-2.0

import type { IssueData } from "../sdk/github/issue.ts";
import {
  fetchIssueFromUrl,
  parseIssueFromFile,
  parseTitleFromContextFile,
  resolveIssueUrlInput,
  summarizeIssueForDisplay,
  writeIssueContext,
} from "../sdk/github/issue.ts";
import { resolvePlanName } from "./planName.ts";
import type { GitContext } from "../sdk/github/vcs.ts";
import {
  checkForChanges,
  cleanupBranch,
  detectVcs,
  prepareVcsForKickstart,
  publishChanges,
} from "../sdk/github/vcs.ts";
import type { PublishMode } from "../sdk/github/publish.ts";
import {
  assertPublishAllowedInCi,
  writeGithubActionVcsOutputs,
} from "../sdk/github/publish.ts";
import type { AgentHarness } from "../sdk/github/agentHarness.ts";
import { formatAgentHarnessName } from "../sdk/github/agentHarness.ts";
import { assembleCombinedPrompt } from "../sdk/github/prompt.ts";
import { createPR } from "../sdk/github/github.ts";
import type { PRPlanSummary } from "../sdk/github/github.ts";
import {
  createProgressReporter,
  type ProgressReporter,
} from "../sdk/github/progress.ts";
import { createCursorRule } from "./artifacts.ts";
import { reviewPlanInEditor } from "./editor.ts";
import { formatSummary } from "../sdk/archive/format.ts";
import {
  checkAcceptanceCriteriaCompletion,
  extractPlanSummary,
} from "./lib.ts";
import type { PlanSummary } from "./lib.ts";
import { decidePlanSkip, type PlanCompletionStatus } from "./issueAdequacy.ts";
import {
  formatError,
  formatInfo,
  formatStep,
  formatSuccess,
  formatWarning,
  isUnattended,
} from "./output.ts";
import {
  createRunTmpDir,
  isSandboxActive,
  runAgentPhaseInSandbox,
  translateSandboxCwd,
} from "../sdk/sandbox/mod.ts";
import {
  clearImplementResult,
  implementResultPromptInstruction,
  loadImplementResult,
  printImplementResult,
} from "./implementResult.ts";
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
  /** How changes are published to the remote repository */
  publish: PublishMode;
  /** Agent harness; Cursor also enables `.cursor/rules/kickstart.mdc` artifact */
  agentHarness: AgentHarness;
  /** Issue URL to fetch (mutually exclusive with contextMarkdownPath) */
  issueUrl: string | null;
  /** Path to markdown file to use as issue context (e.g. from CLI); skips fetch */
  contextMarkdownPath?: string;
  /** Whether to save context files on success */
  saveCtx: boolean;
  /** Specific plan name to use (if provided via --saved-plan) */
  savedPlanName: string | null;
  /** Optional final operator instruction appended to agent prompts. */
  steeringPrompt?: string;
  /** Prompt-level succinctness hint for the plan phase. */
  verbosity: "low" | "medium" | "high";
  /** Skip plan generation and proceed directly to implementation. */
  skipPlan: boolean;
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
 * Prompts the user whether to continue an existing plan or start a new one.
 *
 * Unattended runs default to starting a new plan (same as attended Enter).
 *
 * @param planPath - Path to the existing plan file
 * @returns `true` if user wants to continue, `false` to start new
 */
function promptContinueOrNewPlan(planPath: string): boolean {
  console.log(formatInfo(`Found existing plan at: ${planPath}`));
  if (isUnattended()) {
    console.log(formatInfo("Starting a new plan (unattended default)."));
    return false;
  }
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
 * Unattended runs derive a name from the issue/context title (or branch) and
 * never prompt. Attended runs still prompt, with branch/title suggestions.
 *
 * @param config - Orchestrator configuration
 * @param workspaceRoot - Root directory of the workspace
 * @param gitContext - Git context (for branch name suggestion)
 * @param issueHint - Fetched issue or parsed markdown context (shown before the plan name prompt)
 * @param contextTitle - Title from context markdown when issue data is absent
 * @returns The plan file path
 */
function resolvePlanFilePath(
  config: OrchestratorConfig,
  workspaceRoot: string,
  gitContext: GitContext | null,
  issueHint: IssueData | null,
  contextTitle: string | null = null,
): string {
  const plansDir = `${workspaceRoot}/plans`;

  if (issueHint) {
    console.log(
      formatInfo(`Issue: ${summarizeIssueForDisplay(issueHint)}`),
    );
  }

  const planName = resolvePlanName({
    savedPlanName: config.savedPlanName,
    branchName: gitContext?.branchName,
    issueTitle: issueHint?.title ?? contextTitle ?? undefined,
  });
  return `${plansDir}/${planName}.plan.md`;
}

/**
 * Validates the plan file structure and required sections.
 *
 * @param planFilePath - Path to the plan file
 * @returns Promise resolving to `true` if plan file is valid
 * @throws Error if file doesn't exist, is malformed, or missing required sections
 */
function missingPlanSections(content: string): string[] {
  const requiredSections: { name: string; pattern: RegExp }[] = [
    { name: "Title (H1)", pattern: /^#\s+.+$/m },
    { name: "Overview", pattern: /^##\s+Overview/mi },
    { name: "Implementation Plan", pattern: /^##\s+Implementation\s+Plan/mi },
    { name: "Acceptance Criteria", pattern: /^##\s+Acceptance\s+Criteria/mi },
  ];
  return requiredSections
    .filter((section) => !section.pattern.test(content))
    .map((section) => section.name);
}

async function checkPlanFile(planFilePath: string): Promise<boolean> {
  try {
    const content = await Deno.readTextFile(planFilePath);

    if (!content || content.trim().length === 0) {
      throw new Error(
        `Plan file exists but is empty at ${planFilePath}`,
      );
    }

    const missingSections = missingPlanSections(content);
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
 * @param agentHarness - Which CLI runs the merge phase
 * @returns Promise resolving to `true` if merge was successful
 */
async function _mergePlanFiles(
  planFilePath: string,
  continuationFilePath: string,
  tmpDir: string,
  agentHarness: AgentHarness = "opencode",
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
    console.log(formatInfo("Merging plan files..."));
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

    const mergeResult = await runAgentPhaseInSandbox(
      "implement", // Use implement phase for write permissions
      combinedPromptMergePath,
      WORKSPACE_ROOT,
      false, // useReadonlyConfig = false (need write permissions)
      agentHarness,
    );

    if (mergeResult.code !== 0) {
      console.warn(formatWarning("Merge phase failed (non-blocking):"));
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
  // CI and color policy are bootstrapped at CLI entry (cli/main.ts)

  const { publish, issueUrl, saveCtx } = config;
  assertPublishAllowedInCi(publish);
  const publishesChanges = publish !== "none";
  const reporter = createProgressReporter();

  const report = async (
    type:
      | "invocation.queued"
      | "invocation.running"
      | "step.started"
      | "step.completed"
      | "phase.started"
      | "phase.completed"
      | "lint.completed"
      | "publish.completed"
      | "invocation.succeeded"
      | "invocation.failed",
    message: string,
    options: Omit<
      Parameters<ProgressReporter["report"]>[0],
      "type" | "message"
    > = {},
  ): Promise<void> => await reporter.report({ type, message, ...options });

  // Normalize path to avoid double slashes
  const normalizedWorkspaceRoot = WORKSPACE_ROOT.replace(/\/+$/, "");

  // Ensure plans directory exists
  await ensurePlansDirectory(normalizedWorkspaceRoot);

  // Create temp directory (workspace-relative when sandbox is active for visibility inside containers/VMs)
  const tmpDir = await createRunTmpDir(
    normalizedWorkspaceRoot,
    "geo-opencode-",
  );
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
    await report("invocation.queued", "Kickstart invocation queued");
    await report("invocation.running", "Kickstart invocation running");
    // Step 1: Resolve issue context
    await report("step.started", "Resolving issue context", { step: 1 });
    console.log(formatStep(1, "Resolving issue context..."));
    if (config.contextMarkdownPath) {
      issueContextPathFinal = config.contextMarkdownPath;
      issueData = null;
    } else if (issueUrl) {
      const resolvedIssueUrl = await resolveIssueUrlInput(issueUrl);
      issueData = await fetchIssueFromUrl(resolvedIssueUrl);
      issueContextPathFinal = `${tmpDir}/issue-context.md`;
      await writeIssueContext(issueData, issueContextPathFinal);
    } else {
      throw new Error(
        "No issue URL or context path provided. Set issueUrl or contextMarkdownPath.",
      );
    }
    await report("step.completed", "Resolved issue context", { step: 1 });

    // Step 2: Prepare VCS state (only when publishing, requires issue data)
    if (publishesChanges && issueData !== null) {
      await report("step.started", "Preparing VCS state", { step: 2 });
      console.log(formatStep(2, "Preparing VCS state..."));
      gitContext = await prepareVcsForKickstart(publish, issueData);
      vcsType = gitContext?.vcs ?? null;
      await report("step.completed", "Prepared VCS state", { step: 2 });
    }
    // In default mode, we don't interact with VCS at the beginning.
    // VCS will be detected lazily only when needed (e.g., to show changes).

    // Step 2.5: Resolve plan file path
    let issueHintForPlanName: IssueData | null = issueData;
    let contextTitleForPlanName: string | null = null;
    if (!issueHintForPlanName && issueContextPathFinal) {
      issueHintForPlanName = await parseIssueFromFile(issueContextPathFinal);
      if (!issueHintForPlanName) {
        contextTitleForPlanName = await parseTitleFromContextFile(
          issueContextPathFinal,
        );
      }
    }
    const planFilePath = resolvePlanFilePath(
      config,
      normalizedWorkspaceRoot,
      gitContext,
      issueHintForPlanName,
      contextTitleForPlanName,
    );

    // Step 2.6: Decide whether to skip the plan agent
    let existingPlanContent: string | null = null;
    let continueExistingPlan = false;
    let skipPlanReason:
      | "existing_plan"
      | "issue_adequate"
      | "explicit_skip"
      | null = null;
    let existingPlanCompletion: PlanCompletionStatus | null = null;

    const existingPlan = await readExistingPlan(planFilePath);
    const titleForAdequacy = issueHintForPlanName?.title ??
      contextTitleForPlanName ?? "";
    const bodyForAdequacy = issueHintForPlanName?.body ??
      (issueContextPathFinal
        ? await Deno.readTextFile(issueContextPathFinal).catch(() => "")
        : "");
    if (existingPlan && !isUnattended() && !publishesChanges) {
      continueExistingPlan = promptContinueOrNewPlan(planFilePath);
    }
    const planDecision = decidePlanSkip({
      issue: { title: titleForAdequacy, body: bodyForAdequacy },
      existingPlanContent: existingPlan,
      reuseExistingPlan: continueExistingPlan || isUnattended() ||
        publishesChanges,
    });
    existingPlanCompletion = planDecision.existingPlanCompletion;
    if (config.skipPlan) {
      skipPlanReason = "explicit_skip";
      existingPlanContent = existingPlan ??
        (issueContextPathFinal
          ? await Deno.readTextFile(issueContextPathFinal).catch(() => "")
          : "");
    } else if (planDecision.reason !== "plan_required") {
      skipPlanReason = planDecision.reason;
      existingPlanContent = planDecision.planContent;
      if (planDecision.reason === "issue_adequate") {
        await Deno.writeTextFile(planFilePath, planDecision.planContent ?? "");
        console.log(
          formatInfo(
            `Issue looks implement-ready (score ${planDecision.adequacy.score}; ${
              planDecision.adequacy.signals.join(", ") || "signals"
            }).`,
          ),
        );
      }
    }

    // Step 3: Plan Phase
    await report("step.started", "Starting plan step", { step: 3 });
    await report("phase.started", "Plan phase started", {
      phase: "plan",
      step: 3,
    });

    if (skipPlanReason != null) {
      console.log(
        formatStep(
          3,
          skipPlanReason === "existing_plan"
            ? "Skipping plan phase (reusing existing plan file)..."
            : skipPlanReason === "issue_adequate"
            ? "Skipping plan phase (issue adequate)..."
            : "Skipping plan phase (--skip-plan)...",
        ),
      );
      console.log(
        formatInfo(
          skipPlanReason === "existing_plan"
            ? `[dn] Skipping plan phase (existing plan at ${planFilePath})`
            : skipPlanReason === "issue_adequate"
            ? "[dn] Skipping plan phase (issue adequate)"
            : "[dn] Skipping plan phase (--skip-plan)",
        ),
      );
      await Deno.writeTextFile(
        planOutputPath,
        existingPlanContent ??
          (await Deno.readTextFile(planFilePath).catch(() => "")),
      );
      if (skipPlanReason !== "explicit_skip") {
        await checkPlanFile(planFilePath);
      }
      await report("phase.completed", "Plan phase skipped", {
        phase: "plan",
        step: 3,
        data: {
          skipped: true,
          reason: skipPlanReason,
          existingPlanCompletion,
        },
      });
      console.log(formatSuccess("Plan phase skipped successfully"));
      await report("step.completed", "Plan step completed", { step: 3 });
    } else {
      console.log(
        formatStep(
          3,
          `Running ${
            formatAgentHarnessName(config.agentHarness)
          } for plan phase (read-only)...`,
        ),
      );

      // Load plan system prompt (from included file or file system)
      let planSystemPromptPathFinal: string;
      try {
        // Try reading included file (works in compiled binary)
        let promptContent = await readIncludedPrompt("system.prompt.plan.md");

        // Inject plan file path into the prompt
        const planPathInstruction =
          `\n\n## Plan File Path\n\n**IMPORTANT**: You must write the plan file to this exact path:\n\n\`${planFilePath}\`\n\nThis is the ONLY file you are allowed to create or modify.\n`;

        promptContent +=
          `\n\n## Plan Verbosity\n\nUse **${config.verbosity}** verbosity: keep the required plan structure and acceptance-criteria semantics, while adjusting explanation detail. This is a prompt hint only; do not remove required sections.\n`;

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
        undefined,
        undefined,
        config.steeringPrompt,
      );

      // Run plan phase (opencode, Cursor, or Claude Code per config)
      const planResult = await runAgentPhaseInSandbox(
        "plan",
        combinedPromptPlanPath,
        WORKSPACE_ROOT,
        true, // useReadonlyConfig
        config.agentHarness,
        reporter,
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
        const hint = (planResult.stderr || "").includes("resource_exhausted")
          ? " (often rate limit or quota from the AI backend—retry later or check API limits)"
          : "";
        throw new Error(
          `Plan phase failed with exit code ${planResult.code}${hint}`,
        );
      }
      await report("phase.completed", "Plan phase completed", {
        phase: "plan",
        step: 3,
      });

      // Check for plan file
      console.log(formatInfo("Validating plan file..."));
      await checkPlanFile(planFilePath);
      console.log(formatInfo(`Plan file location: ${planFilePath}`));

      if (await reviewPlanInEditor(planFilePath)) {
        console.log(formatInfo("Revalidating plan after editor review..."));
        await checkPlanFile(planFilePath);
      }

      console.log(formatSuccess("Plan phase completed successfully"));
      await report("step.completed", "Plan step completed", { step: 3 });
    }

    // Step 4: Implement Phase
    await report("step.started", "Starting implement step", { step: 4 });
    await report("phase.started", "Implement phase started", {
      phase: "implement",
      step: 4,
    });
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

    // Load implement system prompt (from included file or file system)
    let implementSystemPromptPathFinal: string;
    try {
      // Try reading included file (works in compiled binary)
      let promptContent = await readIncludedPrompt(
        "system.prompt.implement.md",
      );

      // Inject plan file path and implement-result instructions into the prompt
      const planPathInstruction =
        `\n\n## Plan File Path\n\n**CRITICAL**: You MUST update the Acceptance Criteria checklist in the plan file at this exact path:\n\n\`${planFilePath}\`\n\nUpdate the checkboxes to reflect what was actually implemented. This is MORE IMPORTANT than completing the implementation.\n` +
        implementResultPromptInstruction(WORKSPACE_ROOT);

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
      undefined,
      undefined,
      undefined,
      config.steeringPrompt,
    );

    await clearImplementResult(WORKSPACE_ROOT);

    // Run implement phase (opencode, Cursor, or Claude Code per config)
    const implementResult = await runAgentPhaseInSandbox(
      "implement",
      combinedPromptImplementPath,
      WORKSPACE_ROOT,
      false, // useReadonlyConfig
      config.agentHarness,
      reporter,
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
    await report("phase.completed", "Implement phase completed", {
      phase: "implement",
      step: 4,
    });

    const structuredImplementResult = await loadImplementResult(
      WORKSPACE_ROOT,
      implementResult.stdout,
    );

    // Check for blocking errors in the output (even if exit code is 0)
    const blockingError = structuredImplementResult?.status === "blocked" ||
        structuredImplementResult?.recommendation === "blocked"
      ? structuredImplementResult.summary
      : detectBlockingError(
        implementResult.stdout,
        implementResult.stderr,
      );

    if (blockingError) {
      console.error(
        formatError("Blocking error detected in implement phase output"),
      );
      console.error(
        "\nThe agent reported a blocking error that prevents implementation:",
      );
      console.error("─".repeat(60));
      console.error(blockingError);
      console.error("─".repeat(60));
      if (structuredImplementResult) {
        printImplementResult(structuredImplementResult, {
          planRelativePath: planFilePath.replace(WORKSPACE_ROOT + "/", ""),
        });
      }
      console.error(
        "\nStopping execution. Steps 4.5, 5, 6, and 7 will not run.",
      );
      throw new Error(
        "Implementation blocked: Agent reported a blocking error. See output above for details.",
      );
    }
    await report("step.completed", "Implement step completed", { step: 4 });

    // Note: The agent is responsible for updating the Acceptance Criteria checklist
    // in the plan file. We do not automatically update it here.

    // Step 4.5: Check completion status and handle continuation
    await report("step.started", "Checking completion status", { step: 4.5 });
    console.log(formatStep(4.5, "Checking completion status..."));
    const finalPlanFilePath = planFilePath;
    const planRelativePath = planFilePath.replace(WORKSPACE_ROOT + "/", "");

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

      if (structuredImplementResult) {
        printImplementResult(structuredImplementResult, { planRelativePath });
      }

      if (completionStatus.total > 0) {
        console.log(
          `📊 Completion Status: ${completionStatus.completed}/${completionStatus.total} acceptance criteria completed`,
        );

        if (!completionStatus.complete) {
          // Plan is incomplete
          console.log(
            formatWarning(
              `Plan is incomplete. ${completionStatus.incomplete.length} item(s) remaining.`,
            ),
          );
          if (!structuredImplementResult) {
            for (const item of completionStatus.incomplete) {
              console.log(`  - ${item}`);
            }
          }

          // The plan file itself is the continuation point
          // The agent has already updated it, so we just inform the user
          console.log(
            formatInfo(
              `Plan file updated: ${
                finalPlanFilePath.replace(WORKSPACE_ROOT + "/", "")
              }`,
            ),
          );
          const recommendation = structuredImplementResult?.recommendation;
          if (
            recommendation === undefined ||
            recommendation === "rerun_loop"
          ) {
            console.log(
              formatInfo(
                "To continue this work, run: dn loop " +
                  finalPlanFilePath.replace(WORKSPACE_ROOT + "/", "") + "",
              ),
            );
          } else if (recommendation === "edit_plan") {
            console.log(
              formatInfo(
                `Edit ${planRelativePath} before another dn loop, or land if the delivered scope is enough.`,
              ),
            );
          } else if (recommendation === "human_action") {
            console.log(
              formatInfo(
                "Complete the human actions above, then re-run dn loop or edit the plan if those tasks should not block landing.",
              ),
            );
          } else if (recommendation === "land") {
            console.log(
              formatInfo(
                "Agent recommends landing without another loop if the unfinished items are acceptable to leave open.",
              ),
            );
          }
        } else {
          console.log(formatSuccess("All acceptance criteria completed!"));

          // Delete plan file when all criteria are complete (publish mode only)
          if (publishesChanges) {
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
          formatWarning(
            "No acceptance criteria found in plan file. Unable to determine completion status.",
          ),
        );
      }
    } catch (error) {
      // Non-blocking: log warning but continue
      console.warn(
        "⚠️  Error checking completion status (non-blocking):",
      );
      console.warn(error instanceof Error ? error.message : String(error));
    }
    await report("step.completed", "Checked completion status", { step: 4.5 });

    // Step 5: Run linting (non-blocking). Unattended/device runs often already
    // lint inside implement; skip the duplicate host pass to save wall clock.
    await report("step.started", "Starting lint step", { step: 5 });
    await report("phase.started", "Lint phase started", {
      phase: "lint",
      step: 5,
    });
    if (isUnattended()) {
      console.log(
        formatStep(
          5,
          "Skipping lint step (unattended; implement phase already runs checks)...",
        ),
      );
      await report("lint.completed", "Lint phase skipped", {
        phase: "lint",
        step: 5,
        data: { skipped: true, reason: "unattended_dedupe" },
      });
      await report("phase.completed", "Lint phase skipped", {
        phase: "lint",
        step: 5,
        data: { skipped: true, reason: "unattended_dedupe" },
      });
      await report("step.completed", "Lint step completed", { step: 5 });
    } else {
      console.log(
        formatStep(5, "Running linting to improve code quality..."),
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
                { cwd: translateSandboxCwd(WORKSPACE_ROOT) },
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
          // Run lint on host
          try {
            await Deno.stat(`${WORKSPACE_ROOT}/deno.json`);
            try {
              await $`cd ${WORKSPACE_ROOT} && deno task check`.quiet();
              console.log(formatSuccess("Linting passed (deno task check)"));
            } catch {
              try {
                await $`cd ${WORKSPACE_ROOT} && deno fmt`.quiet();
                await $`cd ${WORKSPACE_ROOT} && deno lint`.quiet();
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
              await Deno.stat(`${WORKSPACE_ROOT}/package.json`);
              try {
                await $`cd ${WORKSPACE_ROOT} && npm run lint`.quiet();
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
      await report("lint.completed", "Lint phase completed", {
        phase: "lint",
        step: 5,
      });
      await report("phase.completed", "Lint phase completed", {
        phase: "lint",
        step: 5,
      });
      await report("step.completed", "Lint step completed", { step: 5 });
    }

    // Step 6: Generate artifacts
    await report("step.started", "Generating workspace artifacts", { step: 6 });
    console.log(formatStep(6, "Generating workspace artifacts..."));
    try {
      // Create Cursor rule if enabled
      if (config.agentHarness === "cursor") {
        await createCursorRule(WORKSPACE_ROOT);
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
    await report("step.completed", "Generated workspace artifacts", {
      step: 6,
    });

    // Step 7: Validate changes
    await report("step.started", "Validating changes", { step: 7 });
    console.log(formatStep(7, "Validating changes..."));

    // In non-AWP mode, detect VCS lazily only when needed (to show changes)
    // In AWP mode, vcsType is already set from prepareVcsStateInteractive
    if (!vcsType && !publishesChanges) {
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
      await report("step.completed", "Validated changes", { step: 7 });
      await report("invocation.succeeded", "Kickstart invocation succeeded");
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
      if (publishesChanges && gitContext) {
        await cleanupBranch(gitContext);
      }
      if (!saveCtx) {
        await Deno.remove(tmpDir, { recursive: true });
      }
      await report("step.completed", "Validated changes", { step: 7 });
      await report("invocation.succeeded", "Kickstart invocation succeeded");
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

    if (publishesChanges) {
      // Step 8: Commit and push
      await report("step.completed", "Validated changes", { step: 7 });
      await report("step.started", "Publishing changes", { step: 8 });
      await report("phase.started", "Publish phase started", {
        phase: "publish",
        step: 8,
      });
      console.log(formatStep(8, "Committing and pushing changes..."));
      if (!issueData || !gitContext) {
        throw new Error("Issue data and git context required for commit");
      }
      const commitMessage = formatSummary(
        `#${issueData.number} ${issueData.title}`,
      );
      const publishResult = await publishChanges(gitContext, {
        message: commitMessage,
        mode: publish,
      });

      let prUrl: string | undefined;
      if (publish === "pr") {
        // Step 9: Create PR
        await report("step.started", "Creating pull request", { step: 9 });
        console.log(formatStep(9, "Creating PR..."));

        // Convert PlanSummary to PRPlanSummary for createPR (if available)
        let prPlanSummary: PRPlanSummary | undefined;
        if (planSummary) {
          prPlanSummary = {
            overview: planSummary.overview,
            acceptanceCriteria: planSummary.acceptanceCriteria,
          };
        }

        prUrl = await createPR(
          issueData,
          gitContext.branchName,
          gitContext.vcs,
          prPlanSummary,
        ) ?? undefined;
        if (prUrl) {
          console.log(formatSuccess(`PR created: ${prUrl}`));
        } else {
          console.log(
            formatInfo(`PR creation skipped (using ${gitContext.vcs}).`),
          );
          console.log(
            formatInfo(
              "   Please use the link shown in the push output above to create the PR manually.",
            ),
          );
        }
        await report("step.completed", "Created pull request", { step: 9 });
      } else {
        console.log(
          formatSuccess(`Changes pushed to ${gitContext.branchName}.`),
        );
      }

      await writeGithubActionVcsOutputs({
        ...publishResult,
        prUrl,
        publishMode: publish,
      });
      await report("publish.completed", "Published changes", {
        phase: "publish",
        step: 8,
        data: {
          branch_name: publishResult.branchName,
          ...(prUrl === undefined ? {} : { pr_url: prUrl }),
        },
      });
      await report("phase.completed", "Publish phase completed", {
        phase: "publish",
        step: 8,
      });
      await report("step.completed", "Published changes", { step: 8 });
    } else {
      console.log(formatSuccess("Changes applied to workspace."));
      console.log(
        formatInfo(
          "Review the changes, then run `dn land` to create commits.",
        ),
      );
      await report("step.completed", "Validated changes", { step: 7 });
    }

    // Note: .plan.md is a workspace artifact and should NOT be cleaned up
    // It persists for Cursor integration and future reference

    // Cleanup temp directory
    if (!saveCtx) {
      await Deno.remove(tmpDir, { recursive: true });
    }
    await report("invocation.succeeded", "Kickstart invocation succeeded");
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
    if (publishesChanges && gitContext) {
      console.error(
        "\nNote: If a branch was created, you may need to manually clean it up.",
      );
    }

    await report("invocation.failed", "Kickstart invocation failed");
    throw error;
  }
}
