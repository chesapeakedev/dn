// Copyright 2026 Chesapeake Computing
// SPDX-License-Identifier: Apache-2.0

import type { IssueListItem } from "../sdk/mod.ts";
import { isColorEnabled, isUnattended } from "../sdk/github/output.ts";
import type { PeekScoreBreakdown, ScoredPeekIssue } from "./peekScore.ts";
import {
  formatRelativeCalendarDays,
  truncateWithEllipsis,
} from "./velocityHelpers.ts";

const ANSI = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
} as const;

const TITLE_MAX = 72;

function decorate(text: string, code: string): string {
  if (!isColorEnabled() || isUnattended()) return text;
  return `${code}${text}${ANSI.reset}`;
}

export interface FormatPeekOutputOptions {
  compact?: boolean;
  noUrls?: boolean;
  verbose?: boolean;
}

function breakdownLines(b: PeekScoreBreakdown): string[] {
  if (b.total === 0) return [];
  const rows: string[] = [];
  if (b.ageBoost) rows.push(`        age (+${b.ageBoost})`);
  if (b.unassignedBoost) {
    rows.push(`        unassigned (+${b.unassignedBoost})`);
  }
  if (b.bugBoost) rows.push(`        bug label (+${b.bugBoost})`);
  if (b.staleBoost) rows.push(`        stale (+${b.staleBoost})`);
  if (b.discussionBoost) {
    rows.push(`        discussion (+${b.discussionBoost})`);
  }
  return rows;
}

function summarizeAssignees(assignees: string[]): string {
  if (assignees.length === 0) return "(unassigned)";
  return assignees.slice(0, 3).map((a) => `@${a}`).join(", ") +
    (assignees.length > 3 ? "…" : "");
}

/** Renders peek results for stdout. */
export function formatPeekIssues(
  top: ScoredPeekIssue[],
  options: FormatPeekOutputOptions = {},
): string {
  const opts: Required<FormatPeekOutputOptions> = {
    compact: options.compact ?? false,
    noUrls: options.noUrls ?? false,
    verbose: options.verbose ?? false,
  };
  const now = new Date();
  const lines: string[] = [];

  const head = opts.compact
    ? "Peek (heuristic)"
    : "Suggested next issues (heuristic)";
  lines.push(decorate(head, ANSI.bold));

  let rank = 1;
  for (const row of top) {
    const i: IssueListItem = row.issue;
    const title = truncateWithEllipsis(i.title, TITLE_MAX);
    const labels = i.labels.length > 0 ? i.labels.slice(0, 6).join(", ") : "";
    const rel = formatRelativeCalendarDays(i.updatedAt, now);

    lines.push(opts.compact ? "" : "");

    lines.push(
      `${rank}. #${i.number}  score=${row.breakdown.total}  up ${rel}`,
    );
    lines.push(`   ${title}`);
    lines.push(`   assignees: ${summarizeAssignees(i.assignees)}`);
    if (labels) lines.push(`   labels: ${labels}`);
    if (!opts.noUrls) lines.push(`   ${i.url}`);
    if (opts.verbose) {
      lines.push(...breakdownLines(row.breakdown));
    }
    rank++;
  }

  return lines.join("\n");
}
