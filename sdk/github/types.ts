// Copyright 2026 Chesapeake Computing
// SPDX-License-Identifier: Apache-2.0

/**
 * Shared types for GitHub API operations.
 * These types are used across multiple modules (glance, shared).
 */

export interface Issue {
  number: number;
  title: string;
  state: "open" | "closed";
  author: string;
  createdAt: string;
  closedAt: string | null;
  url: string;
}

export interface Commit {
  sha: string;
  message: string;
  author: string;
  date: string;
  url: string;
}

// Re-export issue CRUD types from github-gql.ts for convenience
export type {
  CommentResult,
  CreateIssueOptions,
  IssueComment,
  IssueListItem,
  IssueResult,
  IssueWithComments,
  ListIssuesOptions,
  UpdateIssueOptions,
} from "./github-gql.ts";
