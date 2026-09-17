// Copyright 2026 Chesapeake Computing
// SPDX-License-Identifier: Apache-2.0

/**
 * Heuristics for skipping the kickstart plan agent when an issue (or task
 * markdown) already contains enough detail to implement.
 *
 * Defaults to planning when unsure — false positives waste less than a bad skip.
 */

import { completionStatusFromPlanContent } from "./planCompletion.ts";

export interface IssueAdequacyInput {
  title: string;
  body: string;
}

export type IssueAdequacyReason =
  | "existing_plan"
  | "issue_adequate"
  | "plan_required"
  | "thin_issue";

export interface IssueAdequacyResult {
  adequate: boolean;
  score: number;
  signals: string[];
  reason: IssueAdequacyReason;
}

export type PlanCompletionStatus = ReturnType<
  typeof completionStatusFromPlanContent
>;

export interface PlanSkipDecisionInput {
  issue: IssueAdequacyInput;
  existingPlanContent: string | null;
  reuseExistingPlan: boolean;
}

export interface PlanSkipDecision {
  reason: "existing_plan" | "issue_adequate" | "plan_required";
  planContent: string | null;
  adequacy: IssueAdequacyResult;
  existingPlanCompletion: PlanCompletionStatus | null;
}

const CANONICAL_SECTION_PATTERNS: readonly {
  name: string;
  pattern: RegExp;
}[] = [
  { name: "overview_section", pattern: /^#{1,6}\s+Overview\s*$/im },
  {
    name: "implementation_section",
    pattern: /^#{1,6}\s+Implementation\s+Plan\s*$/im,
  },
  {
    name: "acceptance_section",
    pattern: /^#{1,6}\s+Acceptance\s+Criteria\s*$/im,
  },
];

const CHECKLIST_PATTERN = /^\s*[-*+]\s+\[[ xX]\]\s*(.*?)\s*$/gm;

function actionableChecklistItems(body: string): string[] {
  return [...body.matchAll(CHECKLIST_PATTERN)]
    .map((match) => match[1].trim())
    .filter((item) => /[\p{L}\p{N}]/u.test(item));
}

function hasMeaningfulDescription(body: string): boolean {
  const description = body
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/^#{1,6}\s+.*$/gm, " ")
    .replace(CHECKLIST_PATTERN, " ")
    .replace(/[`*_>#]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return description.length >= 20 && description.split(" ").length >= 3;
}

/**
 * Determine whether an issue contains enough explicit structure to skip
 * kickstart's planning agent. The check is intentionally conservative because
 * a false positive skips an important review of the implementation plan.
 */
export function assessIssueAdequacy(
  input: IssueAdequacyInput,
): IssueAdequacyResult {
  const body = input.body.trim();
  const signals: string[] = [];
  const canonicalSections = CANONICAL_SECTION_PATTERNS.filter((section) => {
    const present = section.pattern.test(body);
    if (present) signals.push(section.name);
    return present;
  });
  const checklistItems = actionableChecklistItems(body);
  const hasChecklist = checklistItems.length > 0;
  if (hasChecklist) signals.push("checklist");
  const meaningfulDescription = hasMeaningfulDescription(body);
  if (meaningfulDescription) signals.push("description");

  const hasCanonicalPlan = canonicalSections.length ===
      CANONICAL_SECTION_PATTERNS.length &&
    meaningfulDescription && hasChecklist;
  const hasFallbackPlan = meaningfulDescription && hasChecklist;
  const adequate = hasCanonicalPlan || hasFallbackPlan;
  const score = canonicalSections.length + (hasChecklist ? 2 : 0) +
    (meaningfulDescription ? 1 : 0);
  return {
    adequate,
    score,
    signals,
    reason: adequate ? "issue_adequate" : "thin_issue",
  };
}

/**
 * Build a minimal plan markdown that satisfies kickstart's plan file checks
 * so the implement phase can run without a plan agent.
 */
export function synthesizePlanFromIssue(input: IssueAdequacyInput): string {
  const title = input.title.trim() || "Implementation";
  const body = input.body.trim() || "_No issue body provided._";
  const checklist = [...body.matchAll(/^\s*[-*+]\s+\[[ xX]\]\s+(.+)$/gm)].map(
    (match) => `- [ ] ${match[1].trim()}`,
  );
  const acceptance = checklist.length > 0 ? checklist.join("\n") : [
    "- [ ] Implement the changes described in the Overview",
    "- [ ] Add or update tests covering the change",
    "- [ ] Project lint / typecheck passes",
  ].join("\n");

  return `# ${title}

## Overview

${body}

## Implementation Plan

1. Read the Overview and any linked paths or snippets.
2. Implement the described behavior in the smallest coherent change set.
3. Cover the Acceptance Criteria below.
4. Run the repository's lint and typecheck before finishing.

## Acceptance Criteria

${acceptance}
`;
}

function planHasRequiredStructure(content: string): boolean {
  const requiredSections = [
    /^#\s+.+$/m,
    /^##\s+Overview/mi,
    /^##\s+Implementation\s+Plan/mi,
    /^##\s+Acceptance\s+Criteria/mi,
  ];
  if (!requiredSections.every((pattern) => pattern.test(content))) return false;

  return completionStatusFromPlanContent(content).total > 0;
}

/**
 * Chooses the only safe plan-phase skip, in precedence order: reusable plan,
 * actionable issue synthesis, or normal planning.
 */
export function decidePlanSkip(
  input: PlanSkipDecisionInput,
): PlanSkipDecision {
  const existingPlanCompletion = input.existingPlanContent === null
    ? null
    : completionStatusFromPlanContent(input.existingPlanContent);

  if (
    input.reuseExistingPlan &&
    input.existingPlanContent !== null &&
    planHasRequiredStructure(input.existingPlanContent) &&
    existingPlanCompletion !== null
  ) {
    // Completed plans remain reusable, while incomplete plans are passed on
    // unchanged so the implement phase can continue their remaining work.
    return {
      reason: "existing_plan",
      planContent: input.existingPlanContent,
      adequacy: assessIssueAdequacy(input.issue),
      existingPlanCompletion,
    };
  }

  const adequacy = assessIssueAdequacy(input.issue);
  if (adequacy.adequate) {
    const planContent = synthesizePlanFromIssue(input.issue);
    if (planHasRequiredStructure(planContent)) {
      return {
        reason: "issue_adequate",
        planContent,
        adequacy,
        existingPlanCompletion,
      };
    }
  }

  return {
    reason: "plan_required",
    planContent: null,
    adequacy,
    existingPlanCompletion,
  };
}
