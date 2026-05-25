// Copyright 2026 Chesapeake Computing
// SPDX-License-Identifier: Apache-2.0

/**
 * Public module interface for the glance CLI tool.
 */

export type {
  Commit,
  FormatVelocityOptions,
  Issue,
  TrendDirection,
  UserActivity,
  VelocityData,
} from "./types.ts";
export {
  aggregateUserActivity,
  fetchCommits,
  fetchIssuesClosed,
  fetchIssuesOpened,
  getCurrentRepo,
  getWeekWindow,
} from "./gh.ts";
export { gatherVelocityData } from "./collectVelocity.ts";
export { formatVelocity } from "./format.ts";
export { labelsLookLikeBug, scorePeekIssues } from "./peekScore.ts";
export { formatPeekIssues } from "./peekFormat.ts";
export type { FormatPeekOutputOptions } from "./peekFormat.ts";
export type { PeekScoreBreakdown, ScoredPeekIssue } from "./peekScore.ts";
