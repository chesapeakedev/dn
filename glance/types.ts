// Copyright 2026 Chesapeake Computing
// SPDX-License-Identifier: Apache-2.0

/**
 * Types for the glance CLI tool.
 */

// Import types from sdk/github for use and re-export
import type { Commit, Issue } from "../sdk/mod.ts";
export type { Commit, Issue };

/** Direction of activity change vs an equal-length prior window. */
export type TrendDirection = "up" | "down" | "flat";

export interface UserActivity {
  username: string;
  issuesOpened: number;
  issuesClosed: number;
  commits: number;
  /** Share of total counted events in the window (opens + closes + commits), 0–100. */
  activitySharePercent: number;
}

export interface VelocityData {
  issuesOpened: Issue[];
  issuesClosed: Issue[];
  commits: Commit[];
  userActivity: UserActivity[];
  /** Inclusive start of the current reporting window. */
  weekStart: Date;
  /** End of the current window (typically “now”). */
  weekEnd: Date;
  /** Length of each compared window in whole days (same as CLI `--days`). */
  windowDays: number;
  /** Start of the prior window (same length as the current window, immediately before `weekStart`). */
  priorWindowStart: Date;
  priorIssuesOpenedCount: number;
  priorIssuesClosedCount: number;
  priorCommitsCount: number;
  trends: {
    issuesOpened: TrendDirection;
    issuesClosed: TrendDirection;
    commits: TrendDirection;
  };
  /** Opened minus closed in the current window (backlog pressure signal). */
  netIssueFlow: number;
}

/** Options for `formatVelocity`. */
export interface FormatVelocityOptions {
  compact?: boolean;
  noUrls?: boolean;
}
