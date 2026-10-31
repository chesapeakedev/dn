// Copyright 2026 Chesapeake Computing
// SPDX-License-Identifier: Apache-2.0

import { isAbsolute, join } from "@std/path";
import type { AgentHarness } from "../sdk/github/agentHarness.ts";
import { toAgentRunOptions } from "../sdk/github/agentHarness.ts";
import { assembleCombinedPrompt } from "../sdk/github/prompt.ts";
import type { ProgressReporter } from "../sdk/github/progress.ts";
import { resolveDnConfig } from "../sdk/config/resolve.ts";
import type { DnKickstartReviewConfig } from "../sdk/config/types.ts";
import { runAgentPhaseInSandbox } from "../sdk/sandbox/mod.ts";
import { readIncludedSystemPrompt } from "./includedPrompt.ts";
import {
  clearImplementResult,
  implementResultPromptInstruction,
} from "./implementResult.ts";
import { formatStep, formatWarning } from "./output.ts";
import { detectVcs, showChanges } from "../sdk/github/vcs.ts";

/** Default diff line threshold when `kickstart.review` is configured. */
export const DEFAULT_REVIEW_AUTO_SKIP_MAX_LINES = 100;

export type ReviewSkipReason =
  | "no_config"
  | "explicit_skip"
  | "env_skip"
  | "single_land"
  | "small_diff";

export interface ReviewSkipDecision {
  skip: boolean;
  reason: ReviewSkipReason | null;
  diffLineCount: number;
  autoSkipMaxLines: number | null;
}

export interface DecideReviewSkipInput {
  reviewConfig: DnKickstartReviewConfig | null | undefined;
  diff: string;
  skipReviewFlag?: boolean;
  skipForSingleLand?: boolean;
  env?: Record<string, string | undefined>;
}

export interface ResolveReviewPromptResult {
  content: string;
  source: "file" | "inline";
  /** True when a file-backed prompt is nearly empty. */
  warnShortPrompt: boolean;
}

export interface RunReviewImplementPassOptions {
  workspaceRoot: string;
  planFilePath: string;
  planOutputPath: string;
  issueContextPath: string | undefined;
  tmpDir: string;
  agentHarness: AgentHarness;
  agentModel?: string;
  agentThinking?: string;
  steeringPrompt?: string;
  contextFiles?: readonly string[];
  reviewPrompt: string;
  reporter?: ProgressReporter;
}

export interface ExecuteReviewPhaseOptions
  extends Omit<RunReviewImplementPassOptions, "reviewPrompt"> {
  skipReview?: boolean;
  skipForSingleLand?: boolean;
  reviewConfig?: DnKickstartReviewConfig | null;
  /** When true, load review config from `dn.json` if `reviewConfig` omitted. */
  loadConfig?: boolean;
}

export interface ExecuteReviewPhaseResult {
  ran: boolean;
  skipDecision: ReviewSkipDecision;
}

/**
 * Loads config (optional), evaluates skip rules, and runs the review pass when needed.
 */
export async function executeReviewPhaseIfNeeded(
  options: ExecuteReviewPhaseOptions,
): Promise<ExecuteReviewPhaseResult> {
  const reviewConfig = options.reviewConfig ??
    (options.loadConfig !== false
      ? await loadKickstartReviewConfig(options.workspaceRoot)
      : null);

  const vcs = await detectVcs();
  const diff = vcs ? (await showChanges(vcs.vcs)).diff : "";
  const skipDecision = decideReviewSkip({
    reviewConfig,
    diff,
    skipReviewFlag: options.skipReview,
    skipForSingleLand: options.skipForSingleLand,
  });

  if (skipDecision.skip) {
    await options.reporter?.report({
      type: "phase.completed",
      message: "Review phase skipped",
      phase: "review",
      data: {
        skipped: true,
        reason: skipDecision.reason,
        diff_line_count: skipDecision.diffLineCount,
        auto_skip_max_lines: skipDecision.autoSkipMaxLines,
      },
    });
    return { ran: false, skipDecision };
  }

  const resolved = await resolveReviewPrompt(
    options.workspaceRoot,
    reviewConfig!.prompt,
  );
  logShortReviewPromptWarning(resolved, reviewConfig!.prompt);

  const result = await runReviewImplementPass({
    ...options,
    reviewPrompt: resolved.content,
  });

  if (result.code !== 0) {
    throw new Error(
      `Review phase failed with exit code ${result.code}. ${
        result.stderr.trim().slice(0, 500)
      }`,
    );
  }

  return { ran: true, skipDecision };
}

/** Emits a user-visible line when review was skipped. */
export function logReviewSkipDecision(
  decision: ReviewSkipDecision,
  step = 4.3,
): void {
  if (!decision.skip || decision.reason == null) return;
  const messages: Record<ReviewSkipReason, string> = {
    no_config: "Skipping review phase (no kickstart.review in dn.json)",
    explicit_skip: "Skipping review phase (--skip-review)",
    env_skip: "Skipping review phase (DN_SKIP_REVIEW)",
    single_land: "Skipping review phase (--single land close-out)",
    small_diff:
      `Skipping review phase (diff ${decision.diffLineCount} lines ≤ ${decision.autoSkipMaxLines} auto_skip_max_lines)`,
  };
  console.log(formatStep(step, messages[decision.reason]));
}

function reviewSkippedByEnv(env: Record<string, string | undefined>): boolean {
  const raw = env.DN_SKIP_REVIEW?.trim().toLowerCase();
  return raw === "1" || raw === "true" || raw === "yes";
}

/**
 * Counts added and removed diff lines, excluding `---` / `+++` / `diff` headers.
 */
export function countDiffLines(diff: string): number {
  let count = 0;
  for (const line of diff.split("\n")) {
    if (
      line.startsWith("+++ ") || line.startsWith("--- ") ||
      line.startsWith("diff ")
    ) {
      continue;
    }
    if (line.startsWith("+") || line.startsWith("-")) {
      count += 1;
    }
  }
  return count;
}

/**
 * Loads `kickstart.review` from repository `dn.json`, if present.
 */
export async function loadKickstartReviewConfig(
  repoRoot: string,
): Promise<DnKickstartReviewConfig | null> {
  const resolved = await resolveDnConfig({
    repoRoot,
    includeUser: false,
  });
  return resolved.kickstart?.review ?? null;
}

/**
 * Resolves review prompt text from a config value (file path or inline string).
 */
export async function resolveReviewPrompt(
  repoRoot: string,
  promptField: string,
): Promise<ResolveReviewPromptResult> {
  const trimmed = promptField.trim();
  if (trimmed.length === 0) {
    return { content: "", source: "inline", warnShortPrompt: true };
  }

  const candidatePath = isAbsolute(trimmed) ? trimmed : join(repoRoot, trimmed);
  try {
    const stat = await Deno.stat(candidatePath);
    if (stat.isFile) {
      const content = await Deno.readTextFile(candidatePath);
      const warnShortPrompt = content.trim().length < 3;
      return { content, source: "file", warnShortPrompt };
    }
  } catch (error) {
    if (!(error instanceof Deno.errors.NotFound)) {
      throw error;
    }
  }

  return {
    content: promptField,
    source: "inline",
    warnShortPrompt: trimmed.length < 3,
  };
}

/**
 * Determines whether the review implement pass should run.
 */
export function decideReviewSkip(
  input: DecideReviewSkipInput,
): ReviewSkipDecision {
  const env = input.env ?? Deno.env.toObject();
  const diffLineCount = countDiffLines(input.diff);

  if (input.reviewConfig == null) {
    return {
      skip: true,
      reason: "no_config",
      diffLineCount,
      autoSkipMaxLines: null,
    };
  }

  if (input.skipForSingleLand === true) {
    return {
      skip: true,
      reason: "single_land",
      diffLineCount,
      autoSkipMaxLines: input.reviewConfig.auto_skip_max_lines ??
        DEFAULT_REVIEW_AUTO_SKIP_MAX_LINES,
    };
  }

  if (input.skipReviewFlag === true) {
    return {
      skip: true,
      reason: "explicit_skip",
      diffLineCount,
      autoSkipMaxLines: input.reviewConfig.auto_skip_max_lines ??
        DEFAULT_REVIEW_AUTO_SKIP_MAX_LINES,
    };
  }

  if (reviewSkippedByEnv(env)) {
    return {
      skip: true,
      reason: "env_skip",
      diffLineCount,
      autoSkipMaxLines: input.reviewConfig.auto_skip_max_lines ??
        DEFAULT_REVIEW_AUTO_SKIP_MAX_LINES,
    };
  }

  const maxLines = input.reviewConfig.auto_skip_max_lines ??
    DEFAULT_REVIEW_AUTO_SKIP_MAX_LINES;
  if (diffLineCount <= maxLines) {
    return {
      skip: true,
      reason: "small_diff",
      diffLineCount,
      autoSkipMaxLines: maxLines,
    };
  }

  return {
    skip: false,
    reason: null,
    diffLineCount,
    autoSkipMaxLines: maxLines,
  };
}

function buildImplementSystemPromptWithReview(
  basePrompt: string,
  planFilePath: string,
  workspaceRoot: string,
  reviewPrompt: string,
): string {
  const planPathInstruction =
    `\n\n## Plan File Path\n\n**CRITICAL**: You MUST update the Acceptance Criteria checklist in the plan file at this exact path:\n\n\`${planFilePath}\`\n\nUpdate the checkboxes to reflect what was actually implemented. This is MORE IMPORTANT than completing the implementation.\n` +
    implementResultPromptInstruction(workspaceRoot);

  const reviewBlock =
    `\n\n## Review instructions\n\nThis pass is a **review refinement** of the implementation. Apply the following project review spec:\n\n${reviewPrompt.trim()}\n`;

  let promptContent = basePrompt;
  if (promptContent.includes("---\n\nThe issue context and plan output")) {
    promptContent = promptContent.replace(
      "---\n\nThe issue context and plan output",
      planPathInstruction + reviewBlock +
        "\n---\n\nThe issue context and plan output",
    );
  } else {
    promptContent = promptContent + planPathInstruction + reviewBlock;
  }
  return promptContent;
}

/**
 * Runs a second implement harness pass with review instructions injected.
 */
export async function runReviewImplementPass(
  options: RunReviewImplementPassOptions,
): Promise<{ code: number; stdout: string; stderr: string }> {
  const {
    workspaceRoot,
    planFilePath,
    planOutputPath,
    issueContextPath,
    tmpDir,
    agentHarness,
    reviewPrompt,
    reporter,
  } = options;

  const basePrompt = await readIncludedSystemPrompt(
    "system.prompt.implement.md",
    workspaceRoot,
  );
  const promptContent = buildImplementSystemPromptWithReview(
    basePrompt,
    planFilePath,
    workspaceRoot,
    reviewPrompt,
  );

  const implementSystemPromptPathFinal =
    `${tmpDir}/system.prompt.implement.review.md`;
  await Deno.writeTextFile(implementSystemPromptPathFinal, promptContent);

  const combinedPromptReviewPath = `${tmpDir}/combined_prompt_review.txt`;
  await assembleCombinedPrompt(
    combinedPromptReviewPath,
    implementSystemPromptPathFinal,
    workspaceRoot,
    issueContextPath,
    planOutputPath,
    undefined,
    undefined,
    undefined,
    options.steeringPrompt,
    options.contextFiles,
  );

  await clearImplementResult(workspaceRoot);

  await reporter?.report({
    type: "phase.started",
    message: "Review phase started",
    phase: "review",
  });

  const result = await runAgentPhaseInSandbox(
    "implement",
    combinedPromptReviewPath,
    workspaceRoot,
    false,
    agentHarness,
    reporter,
    toAgentRunOptions({
      model: options.agentModel,
      thinking: options.agentThinking,
    }),
  );

  await reporter?.report({
    type: "phase.completed",
    message: result.code === 0
      ? "Review phase completed"
      : "Review phase failed",
    phase: "review",
    data: { exit_code: result.code ?? null },
  });

  return {
    code: result.code ?? 1,
    stdout: result.stdout,
    stderr: result.stderr,
  };
}

/**
 * Logs a warning when the configured review prompt file is too short to steer.
 */
export function logShortReviewPromptWarning(
  result: ResolveReviewPromptResult,
  promptField: string,
): void {
  if (!result.warnShortPrompt) return;
  console.warn(
    formatWarning(
      `Review prompt (${
        result.source === "file" ? promptField : "inline"
      }) has fewer than 3 non-whitespace characters. Expand it to steer review passes.`,
    ),
  );
}
