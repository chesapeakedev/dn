// Copyright 2026 Chesapeake Computing
// SPDX-License-Identifier: Apache-2.0

/**
 * Public module interface for the glance CLI tool.
 */

export type { Commit, Issue, UserActivity, VelocityData } from "./types.ts";
export {
  aggregateUserActivity,
  fetchCommits,
  fetchIssuesClosed,
  fetchIssuesOpened,
  getCurrentRepo,
  getWeekWindow,
} from "./gh.ts";
export { formatVelocity } from "./format.ts";
