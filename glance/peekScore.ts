// Copyright 2026 Chesapeake Computing
// SPDX-License-Identifier: Apache-2.0

/**
 * Deterministic heuristic scoring for `dn peek` (no LLM).
 *
 * Signals: age (30+ days since creation), unassigned, bug-like labels, staleness (14+
 * days since `updatedAt`), and active discussion (`commentCount`).
 */

import type { IssueListItem } from "../sdk/mod.ts";

/** Milliseconds thresholds */
const MS_DAY = 86_400_000;

export interface PeekScoreBreakdown {
  /** Total weighted score used for ranking. */
  total: number;
  ageBoost: number;
  unassignedBoost: number;
  bugBoost: number;
  staleBoost: number;
  discussionBoost: number;
}

export interface ScoredPeekIssue {
  readonly issue: IssueListItem;
  readonly breakdown: PeekScoreBreakdown;
}

/** Returns true when any label name matches common bug conventions. */
export function labelsLookLikeBug(labels: string[]): boolean {
  return labels.some((l) => /\bbug\b/i.test(l) || l.toLowerCase() === "bug");
}

/**
 * Scores open issues using fixed weights. Higher means “more worth looking at”.
 */
export function scorePeekIssues(
  issues: IssueListItem[],
  referenceTime: Date = new Date(),
): ScoredPeekIssue[] {
  const scored: ScoredPeekIssue[] = [];

  for (const issue of issues) {
    if (issue.state !== "OPEN") continue;

    let ageBoost = 0;
    const created = Date.parse(issue.createdAt);
    if (Number.isFinite(created)) {
      const ageMs = referenceTime.getTime() - created;
      if (ageMs >= 30 * MS_DAY) ageBoost = 35;
    }

    let unassignedBoost = 0;
    if (issue.assignees.length === 0) unassignedBoost = 25;

    let bugBoost = 0;
    if (labelsLookLikeBug(issue.labels)) bugBoost = 30;

    let staleBoost = 0;
    const updated = Date.parse(issue.updatedAt);
    if (Number.isFinite(updated)) {
      const quietMs = referenceTime.getTime() - updated;
      if (quietMs >= 14 * MS_DAY) staleBoost = 25;
    }

    let discussionBoost = 0;
    const cc = issue.commentCount;
    if (cc >= 10) discussionBoost = 28;
    else if (cc >= 5) discussionBoost = 18;
    else if (cc >= 2) discussionBoost = 10;

    const total = ageBoost +
      unassignedBoost +
      bugBoost +
      staleBoost +
      discussionBoost;

    scored.push({
      issue,
      breakdown: {
        total,
        ageBoost,
        unassignedBoost,
        bugBoost,
        staleBoost,
        discussionBoost,
      },
    });
  }

  scored.sort((a, b) => {
    const dt = b.breakdown.total - a.breakdown.total;
    if (dt !== 0) return dt;
    return a.issue.number - b.issue.number;
  });

  return scored;
}
