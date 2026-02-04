// Copyright 2026 Chesapeake Computing
// SPDX-License-Identifier: Apache-2.0

/**
 * Types for the glance CLI tool.
 */

// Re-export shared types from sdk/github for backward compatibility
export type { Commit, Issue } from "../sdk/github/mod.ts";

export interface UserActivity {
  username: string;
  issuesOpened: number;
  issuesClosed: number;
  commits: number;
}

export interface VelocityData {
  issuesOpened: import("../sdk/github/mod.ts").Issue[];
  issuesClosed: import("../sdk/github/mod.ts").Issue[];
  commits: import("../sdk/github/mod.ts").Commit[];
  userActivity: UserActivity[];
  weekStart: Date;
  weekEnd: Date;
}
