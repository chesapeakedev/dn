// Copyright 2026 Chesapeake Computing
// SPDX-License-Identifier: Apache-2.0

/**
 * Structured implement-phase result written by the agent for `dn loop` /
 * kickstart to parse and print after a run.
 */

import { formatInfo, formatWarning } from "./output.ts";
import { ensureWorkspaceStateDir } from "../sdk/workspaceState.ts";

/** Relative path (from the workspace root) for the implement result file. */
export const IMPLEMENT_RESULT_RELATIVE_PATH = ".dn/implement-result.json";

/** Supported schema version for implement-result JSON. */
export const IMPLEMENT_RESULT_SCHEMA_VERSION = "1.0";

/** Overall status of one implement pass. */
export type ImplementStatus =
  | "complete"
  | "incomplete"
  | "needs_human"
  | "blocked";

/**
 * Operator-facing recommendation for what to do after this implement pass.
 *
 * - `rerun_loop`: remaining work looks agent-completable; run `dn loop` again
 * - `edit_plan`: acceptance criteria or steps need human editing first
 * - `human_action`: operator must run commands or make decisions the agent cannot
 * - `land`: remaining unchecked items are acceptable to leave; land the work
 * - `blocked`: implementation cannot continue until a hard blocker is fixed
 */
export type ImplementRecommendation =
  | "rerun_loop"
  | "edit_plan"
  | "human_action"
  | "land"
  | "blocked";

/**
 * Classification of leftover work for operator UX (e.g. tests-only re-loop).
 *
 * - `feature`: product/behavior/CLI changes still open
 * - `tests`: coverage, assertions, or test harness leftovers only
 * - `docs`: documentation or comment-only leftovers
 * - `other`: anything that is not cleanly feature/tests/docs
 */
export type UnfinishedWorkKind = "feature" | "tests" | "docs" | "other";

/** One unfinished acceptance criterion or plan task. */
export interface UnfinishedTask {
  /** Short description of remaining work. */
  description: string;
  /** Matching acceptance-criterion text when applicable. */
  criterion?: string;
  /** Why the item remains unfinished. */
  reason?: string;
  /** Suggested next step for this item. */
  suggested_action?: ImplementRecommendation;
  /**
   * Kind of remaining work. Required by the implement prompt for unfinished
   * tasks; optional in the parser so older results still load (detection fails
   * closed when kinds are missing).
   */
  work_kind?: UnfinishedWorkKind;
}

/** An action only a human can take (or must authorize). */
export interface HumanAction {
  /** Concrete instruction for the operator. */
  description: string;
  /** Why the agent could not complete this alone. */
  reason?: string;
  /** Optional command, path, or URL hint. */
  command?: string;
}

/** Validated implement-phase result document. */
export interface ImplementPhaseResult {
  schema_version: typeof IMPLEMENT_RESULT_SCHEMA_VERSION;
  status: ImplementStatus;
  /** Short summary of what this implement pass accomplished. */
  summary: string;
  unfinished_tasks: UnfinishedTask[];
  human_actions: HumanAction[];
  recommendation: ImplementRecommendation;
}

const STATUS_VALUES = new Set<ImplementStatus>([
  "complete",
  "incomplete",
  "needs_human",
  "blocked",
]);

const RECOMMENDATION_VALUES = new Set<ImplementRecommendation>([
  "rerun_loop",
  "edit_plan",
  "human_action",
  "land",
  "blocked",
]);

const WORK_KIND_VALUES = new Set<UnfinishedWorkKind>([
  "feature",
  "tests",
  "docs",
  "other",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function optionalString(
  value: unknown,
  field: string,
): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string") {
    throw new TypeError(`Implement result field "${field}" must be a string.`);
  }
  return value;
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new TypeError(
      `Implement result field "${field}" must be a non-empty string.`,
    );
  }
  return value;
}

function optionalWorkKind(
  value: unknown,
  field: string,
): UnfinishedWorkKind | undefined {
  if (value === undefined) return undefined;
  if (
    typeof value !== "string" ||
    !WORK_KIND_VALUES.has(value as UnfinishedWorkKind)
  ) {
    throw new TypeError(`Implement result field "${field}" is invalid.`);
  }
  return value as UnfinishedWorkKind;
}

function parseUnfinishedTask(value: unknown, index: number): UnfinishedTask {
  if (!isRecord(value)) {
    throw new TypeError(
      `Implement result unfinished_tasks[${index}] must be an object.`,
    );
  }
  const suggested = value.suggested_action;
  if (
    suggested !== undefined &&
    (typeof suggested !== "string" ||
      !RECOMMENDATION_VALUES.has(suggested as ImplementRecommendation))
  ) {
    throw new TypeError(
      `Implement result unfinished_tasks[${index}].suggested_action is invalid.`,
    );
  }
  const workKind = optionalWorkKind(
    value.work_kind,
    `unfinished_tasks[${index}].work_kind`,
  );
  return {
    description: requiredString(
      value.description,
      `unfinished_tasks[${index}].description`,
    ),
    ...(optionalString(value.criterion, `unfinished_tasks[${index}].criterion`)
      ? {
        criterion: optionalString(
          value.criterion,
          `unfinished_tasks[${index}].criterion`,
        ),
      }
      : {}),
    ...(optionalString(value.reason, `unfinished_tasks[${index}].reason`)
      ? {
        reason: optionalString(
          value.reason,
          `unfinished_tasks[${index}].reason`,
        ),
      }
      : {}),
    ...(suggested
      ? { suggested_action: suggested as ImplementRecommendation }
      : {}),
    ...(workKind ? { work_kind: workKind } : {}),
  };
}

/**
 * True when every unfinished task is classified as tests-only leftover work
 * that another agent pass can finish (`rerun_loop`).
 *
 * Fails closed when any task omits `work_kind` or mixes non-test kinds.
 */
export function onlyTestsRemaining(result: ImplementPhaseResult): boolean {
  if (result.status !== "incomplete") return false;
  if (result.recommendation !== "rerun_loop") return false;
  if (result.unfinished_tasks.length === 0) return false;
  return result.unfinished_tasks.every((task) => task.work_kind === "tests");
}

function parseHumanAction(value: unknown, index: number): HumanAction {
  if (!isRecord(value)) {
    throw new TypeError(
      `Implement result human_actions[${index}] must be an object.`,
    );
  }
  return {
    description: requiredString(
      value.description,
      `human_actions[${index}].description`,
    ),
    ...(optionalString(value.reason, `human_actions[${index}].reason`)
      ? {
        reason: optionalString(value.reason, `human_actions[${index}].reason`),
      }
      : {}),
    ...(optionalString(value.command, `human_actions[${index}].command`)
      ? {
        command: optionalString(
          value.command,
          `human_actions[${index}].command`,
        ),
      }
      : {}),
  };
}

/**
 * Validates and normalizes an unknown JSON value as an implement-phase result.
 *
 * @throws TypeError when the document is incomplete or malformed
 */
export function parseImplementPhaseResult(
  value: unknown,
): ImplementPhaseResult {
  if (!isRecord(value)) {
    throw new TypeError("Implement result must be a JSON object.");
  }
  if (value.schema_version !== IMPLEMENT_RESULT_SCHEMA_VERSION) {
    throw new TypeError(
      `Implement result schema_version must be "${IMPLEMENT_RESULT_SCHEMA_VERSION}".`,
    );
  }
  if (
    typeof value.status !== "string" ||
    !STATUS_VALUES.has(value.status as ImplementStatus)
  ) {
    throw new TypeError("Implement result status is missing or invalid.");
  }
  if (
    typeof value.recommendation !== "string" ||
    !RECOMMENDATION_VALUES.has(value.recommendation as ImplementRecommendation)
  ) {
    throw new TypeError(
      "Implement result recommendation is missing or invalid.",
    );
  }
  if (!Array.isArray(value.unfinished_tasks)) {
    throw new TypeError("Implement result unfinished_tasks must be an array.");
  }
  if (!Array.isArray(value.human_actions)) {
    throw new TypeError("Implement result human_actions must be an array.");
  }

  return {
    schema_version: IMPLEMENT_RESULT_SCHEMA_VERSION,
    status: value.status as ImplementStatus,
    summary: requiredString(value.summary, "summary"),
    unfinished_tasks: value.unfinished_tasks.map(parseUnfinishedTask),
    human_actions: value.human_actions.map(parseHumanAction),
    recommendation: value.recommendation as ImplementRecommendation,
  };
}

/**
 * Extracts a fenced `dn-implement-result` JSON block from agent stdout.
 */
export function extractImplementResultFromStdout(
  stdout: string,
): ImplementPhaseResult | null {
  const fence = /```(?:json)?\s*dn-implement-result\s*\n([\s\S]*?)\n```/i.exec(
    stdout,
  );
  if (!fence) return null;
  try {
    return parseImplementPhaseResult(JSON.parse(fence[1]!));
  } catch {
    return null;
  }
}

/**
 * Absolute path for the workspace implement-result file.
 */
export function implementResultPath(workspaceRoot: string): string {
  return `${
    workspaceRoot.replace(/\/+$/, "")
  }/${IMPLEMENT_RESULT_RELATIVE_PATH}`;
}

/**
 * Removes any stale implement-result file before a new implement pass.
 */
export async function clearImplementResult(
  workspaceRoot: string,
): Promise<void> {
  await ensureWorkspaceStateDir(workspaceRoot);
  try {
    await Deno.remove(implementResultPath(workspaceRoot));
  } catch (error) {
    if (!(error instanceof Deno.errors.NotFound)) throw error;
  }
}

/**
 * Loads the implement result from `.dn/implement-result.json`, falling back to
 * a fenced stdout block when the file is absent or invalid.
 */
export async function loadImplementResult(
  workspaceRoot: string,
  stdout = "",
): Promise<ImplementPhaseResult | null> {
  const path = implementResultPath(workspaceRoot);
  try {
    const text = await Deno.readTextFile(path);
    return parseImplementPhaseResult(JSON.parse(text));
  } catch (error) {
    if (!(error instanceof Deno.errors.NotFound)) {
      console.warn(
        formatWarning(
          `Could not parse ${IMPLEMENT_RESULT_RELATIVE_PATH}: ${
            error instanceof Error ? error.message : String(error)
          }`,
        ),
      );
    }
  }
  return extractImplementResultFromStdout(stdout);
}

/**
 * Prints unfinished tasks, human actions, and a next-step recommendation.
 */
export function printImplementResult(
  result: ImplementPhaseResult,
  options: { planRelativePath: string },
): void {
  console.log(`📋 Implement result: ${result.status}`);
  console.log(`   ${result.summary}`);

  if (result.unfinished_tasks.length > 0) {
    console.log("Unfinished tasks:");
    for (const task of result.unfinished_tasks) {
      const criterion = task.criterion ? ` (${task.criterion})` : "";
      console.log(`  - ${task.description}${criterion}`);
      if (task.work_kind) console.log(`      work_kind: ${task.work_kind}`);
      if (task.reason) console.log(`      reason: ${task.reason}`);
      if (task.suggested_action) {
        console.log(`      suggested: ${task.suggested_action}`);
      }
    }
  }

  if (result.human_actions.length > 0) {
    console.log("Human actions required:");
    for (const action of result.human_actions) {
      console.log(`  - ${action.description}`);
      if (action.reason) console.log(`      reason: ${action.reason}`);
      if (action.command) console.log(`      command: ${action.command}`);
    }
  }

  switch (result.recommendation) {
    case "rerun_loop":
      console.log(
        formatInfo(
          `Recommendation: re-run dn loop ${options.planRelativePath} after reviewing the unfinished tasks.`,
        ),
      );
      break;
    case "edit_plan":
      console.log(
        formatInfo(
          `Recommendation: edit ${options.planRelativePath} (narrow or drop criteria), then decide whether to re-run dn loop or land.`,
        ),
      );
      break;
    case "human_action":
      console.log(
        formatInfo(
          "Recommendation: complete the human actions above before re-running dn loop, or edit the plan if those tasks should not block landing.",
        ),
      );
      break;
    case "land":
      console.log(
        formatInfo(
          "Recommendation: remaining unfinished items can be left open; land the work if the delivered scope is acceptable.",
        ),
      );
      break;
    case "blocked":
      console.log(
        formatWarning(
          "Recommendation: resolve the blocking issue before another implement pass.",
        ),
      );
      break;
  }
}

/**
 * Instruction block injected into the implement system prompt.
 */
export function implementResultPromptInstruction(
  workspaceRoot: string,
): string {
  const path = implementResultPath(workspaceRoot);
  return `
## Implement Result JSON

**CRITICAL**: Before finishing the implement phase, write a JSON result file at:

\`${path}\`

(also reachable as \`${IMPLEMENT_RESULT_RELATIVE_PATH}\` from the workspace root)

Use this exact shape:

\`\`\`json
{
  "schema_version": "1.0",
  "status": "incomplete",
  "summary": "Short summary of this implement pass.",
  "unfinished_tasks": [
    {
      "description": "What remains",
      "criterion": "Matching acceptance criterion text when applicable",
      "reason": "Why it was not finished",
      "suggested_action": "human_action",
      "work_kind": "tests"
    }
  ],
  "human_actions": [
    {
      "description": "What the human should do",
      "reason": "Why the agent cannot complete this alone",
      "command": "optional command or path hint"
    }
  ],
  "recommendation": "human_action"
}
\`\`\`

### Field rules

- \`status\`: \`complete\` | \`incomplete\` | \`needs_human\` | \`blocked\`
- \`recommendation\`: \`rerun_loop\` | \`edit_plan\` | \`human_action\` | \`land\` | \`blocked\`
- \`unfinished_tasks\`: every still-open acceptance criterion or material leftover task (may be \`[]\` when complete)
- \`unfinished_tasks[].work_kind\` (**required** on every unfinished task): \`feature\` | \`tests\` | \`docs\` | \`other\`
  - \`tests\`: coverage, assertions, test harness, or skip-plan/loop test leftovers
  - \`feature\`: product behavior, CLI, APIs, or other non-test implementation
  - \`docs\`: documentation-only leftovers
  - \`other\`: anything that is not cleanly feature/tests/docs
  - Never mark unfinished feature behavior as \`tests\`
- \`human_actions\`: use when the operator must run commands, approve access, or make a product decision the headless agent cannot. Prefer this over spinning on \`dn loop\` when there is no single project test/build command, credentials are missing, or the plan needs human judgment.
- Prefer \`recommendation: "land"\` when remaining unchecked items are intentionally deferrable and the delivered scope is already shippable.
- Prefer \`recommendation: "edit_plan"\` when the checklist itself is wrong or overscoped.
- Prefer \`recommendation: "rerun_loop"\` only when another agent pass can finish the remaining work without new human input.
- Prefer \`recommendation: "blocked"\` for hard blockers (missing codebase, impossible environment).
- When every unfinished task is \`work_kind: "tests"\` and another agent pass can finish them, use \`status: "incomplete"\` and \`recommendation: "rerun_loop"\` so attended \`dn\` can offer a tests-only continuation.

As a fallback, you may also print the same JSON in a fenced block labeled
\`dn-implement-result\` in your final response. The file is preferred.

Always update the plan Acceptance Criteria checkboxes to match reality, then
write this JSON so \`dn\` can print unfinished work and the recommended next
step for the operator.
`;
}
