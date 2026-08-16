// Copyright 2026 Chesapeake Computing
// SPDX-License-Identifier: Apache-2.0

/**
 * Generate a compact ## Test Plan and upsert it onto a GitHub issue.
 */

import { assembleCombinedPrompt } from "../github/prompt.ts";
import {
  fetchIssueFromUrl,
  resolveIssueUrlInput,
  writeIssueContext,
} from "../github/issue.ts";
import { getCurrentRepoFromRemote, updateIssue } from "../github/github-gql.ts";
import type { AgentHarness } from "../github/agentHarness.ts";
import { formatAgentHarnessName, getRunAgent } from "../github/agentHarness.ts";
import { readIncludedSystemPrompt } from "../../kickstart/includedPrompt.ts";
import { normalizeTestPlanSection, upsertTestPlanSection } from "./section.ts";
import { resolveIssueRefFromPlan } from "./resolveIssue.ts";

/**
 * Options for generating and upserting a test plan onto a GitHub issue.
 */
export interface RunIssueTestPlanOptions {
  /** Full GitHub issue URL, or a number / `#N` for the current repo */
  issueRef: string;
  /** Workspace root for agent execution and prompt discovery */
  workspaceRoot: string;
  /** Agent harness used to generate the checklist */
  agentHarness: AgentHarness;
  /** When true, return the section without mutating the issue */
  dryRun: boolean;
  /** Allow issue URLs from a repository other than the current workspace remote */
  allowCrossRepo?: boolean;
  /** Extra files from `--context-file` appended to the generation prompt */
  contextFiles?: readonly string[];
}

/**
 * Result of an issue test-plan generation (and optional upsert).
 */
export interface RunIssueTestPlanResult {
  /** Normalized `## Test Plan` section */
  section: string;
  /** Canonical GitHub issue URL */
  issueUrl: string;
  /** Whether the issue body was updated */
  updated: boolean;
}

/**
 * Options for resolving an issue from a plan, then generating/upserting a test plan.
 */
export interface RunIssueTestPlanFromPlanOptions {
  /** Full plan markdown */
  planContent: string;
  /** Plan path used for issue heuristics */
  planFilePath: string;
  /** Workspace root for agent execution and prompt discovery */
  workspaceRoot: string;
  /** Agent harness used to generate the checklist */
  agentHarness: AgentHarness;
  /** When true, return the section without mutating the issue */
  dryRun: boolean;
  /** Allow issue URLs from a repository other than the current workspace remote */
  allowCrossRepo?: boolean;
  /** Extra files from `--context-file` appended to the generation prompt */
  contextFiles?: readonly string[];
}

async function readIncludedTestPlanPrompt(
  workspaceRoot: string,
): Promise<string> {
  const filename = "system.prompt.testplan.md";
  try {
    return await readIncludedSystemPrompt(filename, workspaceRoot);
  } catch {
    throw new Error(
      `Testplan system prompt not found: ${filename}. Run from dn repo or recompile with --include.`,
    );
  }
}

async function generateTestPlanSection(options: {
  sourceLabel: string;
  sourceContent: string;
  issueContextPath: string | undefined;
  workspaceRoot: string;
  agentHarness: AgentHarness;
  tmpDir: string;
  contextFiles?: readonly string[];
}): Promise<string> {
  const {
    sourceLabel,
    sourceContent,
    issueContextPath,
    workspaceRoot,
    agentHarness,
    tmpDir,
    contextFiles,
  } = options;

  const outputPath = `${tmpDir}/testplan-section.md`;
  const fakeOutput = Deno.env.get("DN_TESTPLAN_FAKE_OUTPUT");
  if (fakeOutput !== undefined) {
    await Deno.writeTextFile(outputPath, fakeOutput);
    return normalizeTestPlanSection(fakeOutput);
  }

  const promptContent = await readIncludedTestPlanPrompt(workspaceRoot);
  const runtimePromptPath = `${tmpDir}/system.prompt.testplan.md`;
  await Deno.writeTextFile(
    runtimePromptPath,
    `${promptContent.trimEnd()}\n\n## Output File\n\nWrite only the generated \`## Test Plan\` section to:\n\n\`${outputPath}\`\n\n## Source\n\n${sourceLabel}\n`,
  );

  const combinedPromptPath = `${tmpDir}/combined_prompt_testplan.txt`;
  await assembleCombinedPrompt(
    combinedPromptPath,
    runtimePromptPath,
    workspaceRoot,
    issueContextPath,
    undefined,
    sourceContent,
    undefined,
    undefined,
    undefined,
    contextFiles,
  );

  console.log(
    `Running ${formatAgentHarnessName(agentHarness)} to generate test plan...`,
  );

  const runAgent = getRunAgent(agentHarness);
  const result = await runAgent(
    "plan",
    combinedPromptPath,
    workspaceRoot,
    true,
  );
  if (result.code !== 0) {
    console.error("\n=== Test Plan STDERR ===");
    console.error(result.stderr || "(empty)");
    console.error("\n=== Test Plan STDOUT ===");
    console.error(result.stdout || "(empty)");
    throw new Error(
      `Test plan generation failed with exit code ${result.code}`,
    );
  }

  try {
    return normalizeTestPlanSection(await Deno.readTextFile(outputPath));
  } catch (error) {
    if (result.stdout.trim() !== "") {
      return normalizeTestPlanSection(result.stdout);
    }
    throw new Error(
      `Test plan generation did not write ${outputPath}. ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
}

/**
 * Generates a compact test checklist and upserts it onto a GitHub issue body.
 *
 * @param options - Issue ref, workspace, harness, and dry-run settings
 * @returns Generated section and whether the issue was updated
 */
export async function runIssueTestPlan(
  options: RunIssueTestPlanOptions,
): Promise<RunIssueTestPlanResult> {
  const issueUrl = await resolveIssueUrlInput(options.issueRef);
  const issue = await fetchIssueFromUrl(issueUrl);
  const currentRepo = await getCurrentRepoFromRemote();
  if (
    currentRepo.owner.toLowerCase() !== issue.owner.toLowerCase() ||
    currentRepo.repo.toLowerCase() !== issue.repo.toLowerCase()
  ) {
    if (!options.allowCrossRepo) {
      throw new Error(
        `Issue URL points to a different repository (${issue.owner}/${issue.repo}) than the current workspace (${currentRepo.owner}/${currentRepo.repo}). Pass allowCrossRepo to enable cross-repository operations.`,
      );
    }
  }

  const tmpDir = await Deno.makeTempDir({ prefix: "dn-testplan-" });
  try {
    const issueContextPath = `${tmpDir}/issue-context.md`;
    await writeIssueContext(issue, issueContextPath);
    const sourceContent = issue.body ?? "";
    const section = await generateTestPlanSection({
      sourceLabel: issueUrl,
      sourceContent,
      issueContextPath,
      workspaceRoot: options.workspaceRoot,
      agentHarness: options.agentHarness,
      tmpDir,
      contextFiles: options.contextFiles,
    });

    if (options.dryRun) {
      return { section, issueUrl, updated: false };
    }

    const updatedBody = upsertTestPlanSection(sourceContent, section);
    await updateIssue(issue.owner, issue.repo, issue.number, {
      body: updatedBody,
    });
    return { section, issueUrl, updated: true };
  } finally {
    try {
      await Deno.remove(tmpDir, { recursive: true });
    } catch {
      // Best-effort cleanup.
    }
  }
}

/**
 * Resolves a linked issue from plan content, then generates/upserts a test plan.
 *
 * @param options - Plan content/path plus workspace and harness settings
 * @returns Generated section and whether the issue was updated
 */
export async function runIssueTestPlanFromPlan(
  options: RunIssueTestPlanFromPlanOptions,
): Promise<RunIssueTestPlanResult> {
  const issueRef = resolveIssueRefFromPlan(
    options.planContent,
    options.planFilePath,
  );
  return await runIssueTestPlan({
    issueRef,
    workspaceRoot: options.workspaceRoot,
    agentHarness: options.agentHarness,
    dryRun: options.dryRun,
    allowCrossRepo: options.allowCrossRepo,
    contextFiles: options.contextFiles,
  });
}
