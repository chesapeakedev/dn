// Copyright 2026 Chesapeake Computing
// SPDX-License-Identifier: Apache-2.0

/**
 * Heuristics for skipping the kickstart plan agent when an issue (or task
 * markdown) already contains enough detail to implement.
 *
 * Defaults to planning when unsure — false positives waste less than a bad skip.
 */

export interface IssueAdequacyInput {
  title: string;
  body: string;
}

export type IssueAdequacyReason =
  | "existing_plan"
  | "issue_adequate"
  | "thin_issue";

export interface IssueAdequacyResult {
  adequate: boolean;
  score: number;
  signals: string[];
  reason: IssueAdequacyReason;
}

const SECTION_PATTERNS: readonly { name: string; pattern: RegExp }[] = [
  { name: "summary_section", pattern: /^#{1,3}\s+summary\b/im },
  { name: "acceptance_section", pattern: /^#{1,3}\s+acceptance\s+criteria\b/im },
  {
    name: "implementation_section",
    pattern: /^#{1,3}\s+(implementation(\s+plan)?|proposed(\s+approach)?|approach)\b/im,
  },
  { name: "context_section", pattern: /^#{1,3}\s+(context|background|details)\b/im },
];

const CHECKLIST_PATTERN = /^\s*[-*]\s+\[[ xX]\]\s+\S+/m;
const FILE_PATH_PATTERN =
  /(?:^|[\s`(])((?:[\w.-]+\/)+[\w.-]+\.[A-Za-z][A-Za-z0-9]*)\b/;
const CODE_FENCE_PATTERN = /```[\s\S]{20,}?```/;

/**
 * Score how implement-ready an issue body is. Adequate when score >= 3, or
 * body is long (>= 800) with at least two signals.
 */
export function assessIssueAdequacy(
  input: IssueAdequacyInput,
): IssueAdequacyResult {
  const title = input.title.trim();
  const body = input.body.trim();
  const signals: string[] = [];
  let score = 0;

  if (body.length >= 400) {
    score += 1;
    signals.push("body_length");
  }
  if (body.length >= 800) {
    score += 1;
    signals.push("body_long");
  }

  for (const section of SECTION_PATTERNS) {
    if (section.pattern.test(body)) {
      score += 1;
      signals.push(section.name);
    }
  }

  if (CHECKLIST_PATTERN.test(body)) {
    score += 2;
    signals.push("checklist");
  }

  if (FILE_PATH_PATTERN.test(body)) {
    score += 1;
    signals.push("file_paths");
  }

  if (CODE_FENCE_PATTERN.test(body)) {
    score += 1;
    signals.push("code_fence");
  }

  // Title-only or near-empty bodies never skip.
  if (body.length < 80) {
    return {
      adequate: false,
      score,
      signals,
      reason: "thin_issue",
    };
  }

  // Vague one-liners with no structure stay on the plan path.
  if (
    body.length < 200 &&
    title.length > 0 &&
    signals.filter((s) => s !== "body_length").length === 0
  ) {
    return {
      adequate: false,
      score,
      signals,
      reason: "thin_issue",
    };
  }

  const adequate = score >= 3 || (body.length >= 800 && score >= 2);
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
  const checklist = [...body.matchAll(/^\s*[-*]\s+\[[ xX]\]\s+(.+)$/gm)].map(
    (match) => `- [ ] ${match[1].trim()}`,
  );
  const acceptance = checklist.length > 0
    ? checklist.join("\n")
    : [
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
