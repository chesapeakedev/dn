// Copyright 2026 Chesapeake Computing
// SPDX-License-Identifier: Apache-2.0

/**
 * Plan-name resolution for kickstart / meld default `plans/*.plan.md` targets.
 */

import { suggestPlanNameFromTitle } from "../sdk/github/issue.ts";
import { formatDetail, formatInfo, isUnattended } from "./output.ts";

/** Inputs used to choose a plan basename when `--saved-plan` is absent. */
export interface PlanNameResolveInput {
  /** Explicit plan name from `--saved-plan` / `--plan-name`. */
  savedPlanName: string | null;
  /** VCS branch/bookmark name, when publish prep already created one. */
  branchName?: string;
  /** Issue or denoise-task title used to derive a short slug. */
  issueTitle?: string;
}

/**
 * Sanitizes a candidate plan basename for use under `plans/`.
 *
 * Branch names may contain `/` (e.g. `kickstart/issue_12_…`); those become
 * hyphens so the plan path stays a single file under `plans/`.
 */
export function sanitizePlanName(name: string): string {
  return name
    .replace(/[/\\]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

/**
 * Builds a non-interactive plan-name suggestion from title and/or branch.
 *
 * Prefers a short slug from the issue/task title (first two words). Falls back
 * to a sanitized branch name when no usable title slug exists.
 */
export function suggestPlanName(input: {
  branchName?: string;
  issueTitle?: string;
}): string | undefined {
  const fromTitle = input.issueTitle
    ? suggestPlanNameFromTitle(input.issueTitle)
    : null;
  if (fromTitle) {
    return fromTitle;
  }
  const branch = input.branchName?.trim();
  if (branch) {
    const sanitized = sanitizePlanName(branch);
    return sanitized.length > 0 ? sanitized : undefined;
  }
  return undefined;
}

/**
 * Prompts for a plan name when attended; auto-accepts a suggestion when
 * unattended.
 *
 * @throws Error when unattended and no suggestion can be derived
 */
export function resolvePlanName(input: PlanNameResolveInput): string {
  if (input.savedPlanName) {
    return input.savedPlanName;
  }

  const titleFirst = suggestPlanName({
    issueTitle: input.issueTitle,
    branchName: input.branchName,
  });
  // Attended UX historically preferred the branch suggestion when present.
  const attendedSuggestion = input.branchName
    ? sanitizePlanName(input.branchName) || titleFirst
    : titleFirst;

  if (isUnattended()) {
    if (titleFirst) {
      console.log(formatInfo(`Using plan name: ${titleFirst}`));
      return titleFirst;
    }
    throw new Error(
      "Plan name is required in unattended mode. Pass --saved-plan <name>, or provide an issue/context with a title.",
    );
  }

  return promptForPlanName(attendedSuggestion);
}

/**
 * Prompts the user for a plan name with an optional suggestion.
 */
function promptForPlanName(suggestion?: string): string {
  if (suggestion) {
    console.log(formatDetail(`Suggested plan name: ${suggestion}`));
    const input = prompt(
      `Enter plan name (or press Enter to use suggested): `,
    );
    if (!input || input.trim() === "") {
      return suggestion;
    }
    return input.trim();
  }
  const input = prompt(`Enter plan name: `);
  if (!input || input.trim() === "") {
    throw new Error("Plan name is required");
  }
  return input.trim();
}
