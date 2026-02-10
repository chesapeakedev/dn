// Copyright 2026 Chesapeake Computing
// SPDX-License-Identifier: Apache-2.0

/**
 * Types for the glance CLI tool.
 */

// Import types from sdk/github for use and re-export
import type { Commit, Issue } from "../sdk/mod.ts";
export type { Commit, Issue };

export interface UserActivity {
  username: string;
  issuesOpened: number;
  issuesClosed: number;
  commits: number;
}

export interface VelocityData {
  issuesOpened: Issue[];
  issuesClosed: Issue[];
  commits: Commit[];
  userActivity: UserActivity[];
  weekStart: Date;
  weekEnd: Date;
}
