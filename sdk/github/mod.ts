// Copyright 2026 Chesapeake Computing
// SPDX-License-Identifier: Apache-2.0

/**
 * @dn/sdk/github - GitHub API and VCS utilities
 *
 * This module provides utilities for interacting with the GitHub API,
 * version control systems (git/sapling), and issue management.
 */

// Shared types
export type { Commit, Issue } from "./types.ts";

// Issue CRUD types
export type {
  CommentResult,
  CreateIssueOptions,
  IssueComment,
  IssueListItem,
  IssueResult,
  IssueWithComments,
  ListIssuesOptions,
  UpdateIssueOptions,
} from "./types.ts";

// GitHub GraphQL API client
export {
  fetchCommits,
  fetchIssueFromUrl,
  fetchIssuesClosed,
  fetchIssuesOpened,
  getCurrentRepoFromRemote,
  getDefaultBranch,
} from "./github-gql.ts";

// Issue CRUD operations
export {
  addIssueComment,
  closeIssue,
  createIssue,
  getIssueWithComments,
  listIssues,
  reopenIssue,
  updateIssue,
} from "./github-gql.ts";

// Token resolution
// NOTE: Only high-level token resolution is part of the public API.
export { resolveGitHubToken } from "./token.ts";

// GitHub REST API utilities
export { createPR } from "./github.ts";

// Issue utilities
export type { IssueData } from "./issue.ts";
export {
  fetchIssueFromUrl as fetchIssue,
  parseIssueFromFile,
  resolveIssueUrlInput,
  writeIssueContext,
} from "./issue.ts";

// VCS utilities (public, stable subset)
export type { GitContext } from "./vcs.ts";
export { commitAndPush, detectVcs } from "./vcs.ts";

// Prompt assembly
// Internal: not part of the stable SDK surface

// OpenCode execution
export type { OpenCodeResult } from "./opencode.ts";
export { runOpenCode } from "./opencode.ts";

// Cursor headless agent
// Experimental: intentionally not exported from the public SDK

// Output utilities
// Internal: CLI-facing only
