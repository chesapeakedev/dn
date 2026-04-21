// Copyright 2026 Chesapeake Computing
// SPDX-License-Identifier: Apache-2.0

/**
 * GitHub REST helpers for issue relationship mutations.
 *
 * GitHub currently exposes documented REST endpoints for issue dependencies
 * and sub-issues. Duplicate marking remains comment-driven, so that helper is
 * implemented on top of issue comments elsewhere.
 */

import { getIssueIdentifiers } from "./github-gql.ts";
import { resolveGitHubToken } from "./token.ts";

const GITHUB_API_BASE = "https://api.github.com";

/**
 * Options for replacing a sub-issue's current parent during attach.
 */
export interface AddSubIssueOptions {
  /** Replace the sub-issue's existing parent instead of failing the request. */
  replaceParent?: boolean;
}

/**
 * Placement options for sub-issue reprioritization.
 */
export interface ReprioritizeSubIssueOptions {
  /** Place the sub-issue after this sibling issue database ID. */
  afterIssueId?: number;
}

function buildHeaders(token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "Content-Type": "application/json",
    "X-GitHub-Api-Version": "2022-11-28",
  };
}

async function request<T>(
  path: string,
  options: {
    method?: "GET" | "POST" | "DELETE" | "PATCH";
    body?: unknown;
  } = {},
): Promise<T> {
  const token = await resolveGitHubToken();
  const response = await fetch(`${GITHUB_API_BASE}${path}`, {
    method: options.method ?? "GET",
    headers: buildHeaders(token),
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });

  if (!response.ok) {
    const errorBody = await response.text().catch(() => "");
    throw new Error(
      `GitHub API request failed (${response.status} ${response.statusText}): ${errorBody}`,
    );
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return (await response.json()) as T;
}

/**
 * Add a blocking dependency to an issue.
 *
 * @param owner - Repository owner for the blocked issue
 * @param repo - Repository name for the blocked issue
 * @param issueNumber - Issue that is blocked
 * @param blockingOwner - Repository owner for the blocking issue
 * @param blockingRepo - Repository name for the blocking issue
 * @param blockingIssueNumber - Issue that blocks the current issue
 */
export async function addIssueBlockedBy(
  owner: string,
  repo: string,
  issueNumber: number,
  blockingOwner: string,
  blockingRepo: string,
  blockingIssueNumber: number,
): Promise<void> {
  const { databaseId } = await getIssueIdentifiers(
    blockingOwner,
    blockingRepo,
    blockingIssueNumber,
  );

  await request<void>(
    `/repos/${owner}/${repo}/issues/${issueNumber}/dependencies/blocked_by`,
    {
      method: "POST",
      body: { issue_id: databaseId },
    },
  );
}

/**
 * Remove a blocking dependency from an issue.
 *
 * @param owner - Repository owner for the blocked issue
 * @param repo - Repository name for the blocked issue
 * @param issueNumber - Issue that is blocked
 * @param blockingOwner - Repository owner for the blocking issue
 * @param blockingRepo - Repository name for the blocking issue
 * @param blockingIssueNumber - Issue currently blocking the issue
 */
export async function removeIssueBlockedBy(
  owner: string,
  repo: string,
  issueNumber: number,
  blockingOwner: string,
  blockingRepo: string,
  blockingIssueNumber: number,
): Promise<void> {
  const { databaseId } = await getIssueIdentifiers(
    blockingOwner,
    blockingRepo,
    blockingIssueNumber,
  );

  await request<void>(
    `/repos/${owner}/${repo}/issues/${issueNumber}/dependencies/blocked_by`,
    {
      method: "DELETE",
      body: { issue_id: databaseId },
    },
  );
}

/**
 * Add a sub-issue to a parent issue.
 *
 * @param owner - Repository owner for the parent issue
 * @param repo - Repository name for the parent issue
 * @param issueNumber - Parent issue number
 * @param subIssueOwner - Repository owner for the child issue
 * @param subIssueRepo - Repository name for the child issue
 * @param subIssueNumber - Child issue number
 * @param options - Optional attach behavior
 */
export async function addSubIssue(
  owner: string,
  repo: string,
  issueNumber: number,
  subIssueOwner: string,
  subIssueRepo: string,
  subIssueNumber: number,
  options: AddSubIssueOptions = {},
): Promise<void> {
  const { databaseId } = await getIssueIdentifiers(
    subIssueOwner,
    subIssueRepo,
    subIssueNumber,
  );

  await request<void>(
    `/repos/${owner}/${repo}/issues/${issueNumber}/sub_issues`,
    {
      method: "POST",
      body: {
        sub_issue_id: databaseId,
        ...(options.replaceParent !== undefined &&
          { replace_parent: options.replaceParent }),
      },
    },
  );
}

/**
 * Remove a sub-issue from a parent issue.
 *
 * @param owner - Repository owner for the parent issue
 * @param repo - Repository name for the parent issue
 * @param issueNumber - Parent issue number
 * @param subIssueOwner - Repository owner for the child issue
 * @param subIssueRepo - Repository name for the child issue
 * @param subIssueNumber - Child issue number
 */
export async function removeSubIssue(
  owner: string,
  repo: string,
  issueNumber: number,
  subIssueOwner: string,
  subIssueRepo: string,
  subIssueNumber: number,
): Promise<void> {
  const { databaseId } = await getIssueIdentifiers(
    subIssueOwner,
    subIssueRepo,
    subIssueNumber,
  );

  await request<void>(
    `/repos/${owner}/${repo}/issues/${issueNumber}/sub_issue`,
    {
      method: "DELETE",
      body: { sub_issue_id: databaseId },
    },
  );
}

/**
 * Move a sub-issue after a sibling issue within the same parent.
 *
 * @param owner - Repository owner for the parent issue
 * @param repo - Repository name for the parent issue
 * @param issueNumber - Parent issue number
 * @param subIssueOwner - Repository owner for the child issue
 * @param subIssueRepo - Repository name for the child issue
 * @param subIssueNumber - Child issue number
 * @param options - Placement options
 */
export async function reprioritizeSubIssue(
  owner: string,
  repo: string,
  issueNumber: number,
  subIssueOwner: string,
  subIssueRepo: string,
  subIssueNumber: number,
  options: ReprioritizeSubIssueOptions,
): Promise<void> {
  const { databaseId: subIssueId } = await getIssueIdentifiers(
    subIssueOwner,
    subIssueRepo,
    subIssueNumber,
  );

  if (options.afterIssueId === undefined) {
    throw new Error("reprioritizeSubIssue requires afterIssueId");
  }

  await request<void>(
    `/repos/${owner}/${repo}/issues/${issueNumber}/sub_issues/priority`,
    {
      method: "PATCH",
      body: {
        sub_issue_id: subIssueId,
        after_id: options.afterIssueId,
      },
    },
  );
}
