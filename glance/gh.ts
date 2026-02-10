// Copyright 2026 Chesapeake Computing
// SPDX-License-Identifier: Apache-2.0

import type { UserActivity } from "./types.ts";
import type { Commit, Issue } from "../sdk/mod.ts";
import {
  fetchCommits as fetchCommitsGql,
  fetchIssuesClosed as fetchIssuesClosedGql,
  fetchIssuesOpened as fetchIssuesOpenedGql,
  getCurrentRepoFromRemote,
} from "../sdk/mod.ts";

/**
 * Get the current repository owner and name.
 */
export async function getCurrentRepo(): Promise<{
  owner: string;
  repo: string;
}> {
  return await getCurrentRepoFromRemote();
}

/**
 * Calculate the one-week time window (last 7 days).
 */
export function getWeekWindow(): { start: Date; end: Date } {
  const end = new Date();
  const start = new Date();
  start.setDate(start.getDate() - 7);
  return { start, end };
}

/**
 * Fetch issues opened since a given date.
 */
export async function fetchIssuesOpened(
  owner: string,
  repo: string,
  since: Date,
): Promise<Issue[]> {
  return await fetchIssuesOpenedGql(owner, repo, since);
}

/**
 * Fetch issues closed since a given date.
 */
export async function fetchIssuesClosed(
  owner: string,
  repo: string,
  since: Date,
): Promise<Issue[]> {
  return await fetchIssuesClosedGql(owner, repo, since);
}

/**
 * Fetch commits since a given date.
 */
export async function fetchCommits(
  owner: string,
  repo: string,
  since: Date,
): Promise<Commit[]> {
  return await fetchCommitsGql(owner, repo, since);
}

/**
 * Aggregate user activity from issues and commits.
 */
export function aggregateUserActivity(
  issuesOpened: Issue[],
  issuesClosed: Issue[],
  commits: Commit[],
): UserActivity[] {
  const activityMap = new Map<string, UserActivity>();

  for (const issue of issuesOpened) {
    const existing = activityMap.get(issue.author) || {
      username: issue.author,
      issuesOpened: 0,
      issuesClosed: 0,
      commits: 0,
    };
    existing.issuesOpened++;
    activityMap.set(issue.author, existing);
  }

  for (const issue of issuesClosed) {
    const existing = activityMap.get(issue.author) || {
      username: issue.author,
      issuesOpened: 0,
      issuesClosed: 0,
      commits: 0,
    };
    existing.issuesClosed++;
    activityMap.set(issue.author, existing);
  }

  for (const commit of commits) {
    const existing = activityMap.get(commit.author) || {
      username: commit.author,
      issuesOpened: 0,
      issuesClosed: 0,
      commits: 0,
    };
    existing.commits++;
    activityMap.set(commit.author, existing);
  }

  return Array.from(activityMap.values()).sort((a, b) => {
    const totalA = a.issuesOpened + a.issuesClosed + a.commits;
    const totalB = b.issuesOpened + b.issuesClosed + b.commits;
    return totalB - totalA;
  });
}
