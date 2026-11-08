// Copyright 2026 Chesapeake Computing
// SPDX-License-Identifier: Apache-2.0

/**
 * `dn research` phase: read-only codebase investigation for outer harnesses.
 */

import type { IssueData } from "../sdk/github/issue.ts";
import {
  fetchIssueFromUrl,
  resolveIssueUrlInput,
  writeIssueContext,
} from "../sdk/github/issue.ts";
import { getCurrentRepoFromRemote } from "../sdk/github/github-gql.ts";
import type { AgentHarness } from "../sdk/github/agentHarness.ts";
import {
  formatAgentHarnessName,
  toAgentRunOptions,
} from "../sdk/github/agentHarness.ts";
import { assembleCombinedPrompt } from "../sdk/github/prompt.ts";
import {
  createProgressReporter,
  type ProgressReporter,
} from "../sdk/github/progress.ts";
import { augmentOpenCodePlanEditPermission } from "../sdk/github/opencode.ts";
import { reviewTextInEditor } from "../sdk/github/editor.ts";
import { readIncludedSystemPrompt } from "./includedPrompt.ts";
import { checkResearchReport } from "./researchReport.ts";
import {
  formatError,
  formatInfo,
  formatStep,
  formatSuccess,
  formatWarning,
} from "./output.ts";
import type { SandboxFlagValue } from "../sdk/sandbox/resolve.ts";
import { createRunTmpDir, runAgentPhaseInSandbox } from "../sdk/sandbox/mod.ts";
import { dirname, resolve } from "@std/path";

/** Configuration for {@link runResearchPhase}. */
export interface ResearchRunConfig {
  /** Which agent harness runs the research phase. */
  agentHarness: AgentHarness;
  /** Optional model override. */
  agentModel?: string;
  /** Optional thinking override. */
  agentThinking?: string;
  /** Allow fetching issues from a different repository than the checkout. */
  allowCrossRepo: boolean;
  /** Full GitHub issue URL when the source is an issue. */
  issueUrl: string | null;
  /** Local markdown context path (issue export, Denoise task materialization). */
  contextMarkdownPath?: string;
  /** Workspace root (defaults to cwd / WORKSPACE_ROOT). */
  workspaceRoot?: string;
  /** Optional steering appended to the combined prompt. */
  steeringPrompt?: string;
  /** Extra files from `--context-file`. */
  contextFiles?: readonly string[];
  /** Prompt-level detail hint. */
  verbosity: "low" | "medium" | "high";
  /** Repo-relative path to write after validation, if set. */
  outputPath?: string | null;
  /** Sandbox override from CLI. */
  sandboxFlag?: SandboxFlagValue | null;
}

/** Result of a successful research phase. */
export interface ResearchPhaseResult {
  success: boolean;
  markdown: string;
  outputPath?: string;
  tmpDir: string;
}

function workspaceRoot(config: ResearchRunConfig): string {
  return config.workspaceRoot ?? Deno.env.get("WORKSPACE_ROOT") ?? Deno.cwd();
}

function stagingPathRelative(
  workspace: string,
  stagingAbsolute: string,
): string {
  const absWorkspace = resolve(workspace);
  const absStaging = resolve(stagingAbsolute);
  if (absStaging.startsWith(absWorkspace + "/")) {
    return absStaging.slice(absWorkspace.length + 1).replace(/\\/g, "/");
  }
  return stagingAbsolute.replace(/\\/g, "/");
}

/**
 * Runs the research agent phase and returns validated markdown.
 */
export async function runResearchPhase(
  config: ResearchRunConfig,
): Promise<ResearchPhaseResult> {
  const root = workspaceRoot(config);
  const normalizedRoot = root.replace(/\/+$/, "");
  const tmpDir = await createRunTmpDir(normalizedRoot, "dn-research-");
  const stagingAbsolute = `${tmpDir}/research.md`;
  const combinedPromptPath = `${tmpDir}/combined_prompt_research.txt`;
  const reporter: ProgressReporter = createProgressReporter();

  try {
    await reporter.report({
      type: "invocation.running",
      message: "Research invocation running",
    });

    let issueData: IssueData | null = null;
    let issueContextPathFinal: string | undefined;

    console.error(formatStep(1, "Resolving request context..."));
    if (config.contextMarkdownPath) {
      issueContextPathFinal = config.contextMarkdownPath;
    } else if (config.issueUrl) {
      const issueUrl = await resolveIssueUrlInput(config.issueUrl, {
        allowBareNumber: false,
      });
      issueData = await fetchIssueFromUrl(issueUrl);
      const currentRepo = await getCurrentRepoFromRemote();
      if (
        currentRepo.owner.toLowerCase() !== issueData.owner.toLowerCase() ||
        currentRepo.repo.toLowerCase() !== issueData.repo.toLowerCase()
      ) {
        if (!config.allowCrossRepo) {
          throw new Error(
            `Issue URL points to ${issueData.owner}/${issueData.repo} but workspace is ${currentRepo.owner}/${currentRepo.repo}. Use --allow-cross-repo.`,
          );
        }
        console.error(
          formatWarning(
            `Cross-repository research: ${issueData.owner}/${issueData.repo} in ${currentRepo.owner}/${currentRepo.repo}`,
          ),
        );
      }
      issueContextPathFinal = `${tmpDir}/issue-context.md`;
      await writeIssueContext(issueData, issueContextPathFinal);
    } else {
      throw new Error(
        "No issue URL or context path provided.",
      );
    }

    const stagingRel = stagingPathRelative(normalizedRoot, stagingAbsolute);
    await augmentOpenCodePlanEditPermission(normalizedRoot, stagingRel);

    let promptContent = await readIncludedSystemPrompt(
      "system.prompt.research.md",
      normalizedRoot,
    );

    const pathInjection =
      `\n\n## Research Report Path\n\n**IMPORTANT**: Write the research report to this exact path:\n\n\`${stagingAbsolute}\`\n\nThis is the ONLY file you may create or modify.\n`;

    const verbosityBlock =
      `\n\n## Report Verbosity\n\nUse **${config.verbosity}** verbosity: adjust explanation depth while keeping all required sections.\n`;

    const sentinel = "The request context will be provided below.";
    if (promptContent.includes(sentinel)) {
      promptContent = promptContent.replace(
        sentinel,
        pathInjection + verbosityBlock + "\n" + sentinel,
      );
    } else {
      promptContent += pathInjection + verbosityBlock;
    }

    const systemPromptPath = `${tmpDir}/system.prompt.research.md`;
    await Deno.writeTextFile(systemPromptPath, promptContent);
    await Deno.writeTextFile(stagingAbsolute, "");

    await assembleCombinedPrompt(
      combinedPromptPath,
      systemPromptPath,
      normalizedRoot,
      issueContextPathFinal,
      undefined,
      null,
      undefined,
      undefined,
      config.steeringPrompt,
      config.contextFiles,
    );

    await reporter.report({
      type: "phase.started",
      message: "Research phase started",
      phase: "research",
      step: 2,
    });

    console.error(
      formatStep(
        2,
        `Running ${
          formatAgentHarnessName(config.agentHarness)
        } for research (read-only)...`,
      ),
    );

    const agentResult = await runAgentPhaseInSandbox(
      "plan",
      combinedPromptPath,
      normalizedRoot,
      true,
      config.agentHarness,
      reporter,
      toAgentRunOptions({
        model: config.agentModel,
        thinking: config.agentThinking,
      }),
    );

    if (agentResult.code !== 0) {
      throw new Error(
        `Research phase failed with exit code ${agentResult.code}`,
      );
    }

    await checkResearchReport(stagingAbsolute);

    let markdown = await Deno.readTextFile(stagingAbsolute);
    const reviewed = await reviewTextInEditor({
      content: markdown,
      path: stagingAbsolute,
    });
    markdown = reviewed.trim();
    if (markdown.length > 0) {
      await Deno.writeTextFile(stagingAbsolute, markdown);
      await checkResearchReport(stagingAbsolute);
    }

    let writtenPath: string | undefined;
    const outputRel = config.outputPath?.trim().replace(/^\/+/, "");
    if (outputRel) {
      const outputAbsolute = resolve(normalizedRoot, outputRel);
      await Deno.mkdir(dirname(outputAbsolute), { recursive: true });
      await Deno.writeTextFile(outputAbsolute, markdown);
      writtenPath = outputRel;
      console.error(formatInfo(`Wrote research report to ${outputRel}`));
    }

    const bytes = new TextEncoder().encode(markdown).byteLength;
    await reporter.report({
      type: "phase.completed",
      message: "Research phase completed",
      phase: "research",
      step: 2,
      data: {
        bytes,
        ...(writtenPath ? { output_path: writtenPath } : {}),
      },
    });
    await reporter.report({
      type: "invocation.succeeded",
      message: "Research completed successfully",
    });

    console.error(formatSuccess("Research phase completed successfully"));

    return {
      success: true,
      markdown,
      ...(writtenPath ? { outputPath: writtenPath } : {}),
      tmpDir,
    };
  } catch (error) {
    await reporter.report({
      type: "invocation.failed",
      message: error instanceof Error ? error.message : String(error),
    });
    console.error(
      formatError(error instanceof Error ? error.message : String(error)),
    );
    throw error;
  }
}
