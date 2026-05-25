// Copyright 2026 Chesapeake Computing
// SPDX-License-Identifier: Apache-2.0

import {
  aggregateUserActivity,
  fetchCommits,
  fetchIssuesClosed,
  fetchIssuesOpened,
} from "./gh.ts";
import type { VelocityData } from "./types.ts";
import { trendDirectionFromCounts } from "./velocityHelpers.ts";

/**
 * Decorate per-user aggregates with percentage share of total window events.
 */
function addActivityShares(
  userActivity: import("./types.ts").UserActivity[],
): import("./types.ts").UserActivity[] {
  let grandTotal = 0;
  for (const u of userActivity) {
    grandTotal += u.issuesOpened + u.issuesClosed + u.commits;
  }
  if (grandTotal === 0) {
    return userActivity.map((u) => ({ ...u, activitySharePercent: 0 }));
  }
  return userActivity.map((u) => {
    const total = u.issuesOpened + u.issuesClosed + u.commits;
    return {
      ...u,
      activitySharePercent: Math.round((1000 * total) / grandTotal) / 10,
    };
  });
}

/**
 * Loads velocity data for `--days`: current vs prior windows, trends, and net flow.
 */
export async function gatherVelocityData(
  owner: string,
  repo: string,
  days: number,
): Promise<VelocityData> {
  const weekEnd = new Date();
  const weekStart = new Date(weekEnd);
  weekStart.setDate(weekStart.getDate() - days);

  const priorWindowStart = new Date(weekStart);
  priorWindowStart.setDate(priorWindowStart.getDate() - days);

  const [openedSpan, closedSpan, commitsSpan] = await Promise.all([
    fetchIssuesOpened(owner, repo, priorWindowStart),
    fetchIssuesClosed(owner, repo, priorWindowStart),
    fetchCommits(owner, repo, priorWindowStart),
  ]);

  const inCurrentWindow = (d: Date): boolean => d >= weekStart && d <= weekEnd;

  const inPriorWindow = (d: Date): boolean =>
    d >= priorWindowStart && d < weekStart;

  const parseDate = (iso: string): Date | null => {
    const t = Date.parse(iso);
    if (!Number.isFinite(t)) return null;
    return new Date(t);
  };

  const issuesOpened = openedSpan.filter((i) => {
    const d = parseDate(i.createdAt);
    return d !== null && inCurrentWindow(d);
  });
  const issuesClosed = closedSpan.filter((i) => {
    if (!i.closedAt) return false;
    const d = parseDate(i.closedAt);
    return d !== null && inCurrentWindow(d);
  });
  const commits = commitsSpan.filter((c) => {
    const d = parseDate(c.date);
    return d !== null && inCurrentWindow(d);
  });

  const priorIssuesOpened = openedSpan.filter((i) => {
    const d = parseDate(i.createdAt);
    return d !== null && inPriorWindow(d);
  });
  const priorIssuesClosed = closedSpan.filter((i) => {
    if (!i.closedAt) return false;
    const d = parseDate(i.closedAt);
    return d !== null && inPriorWindow(d);
  });
  const priorCommits = commitsSpan.filter((c) => {
    const d = parseDate(c.date);
    return d !== null && inPriorWindow(d);
  });

  const ua = aggregateUserActivity(issuesOpened, issuesClosed, commits);
  const userActivity = addActivityShares(ua);

  const netIssueFlow = issuesOpened.length - issuesClosed.length;
  const trends = {
    issuesOpened: trendDirectionFromCounts(
      issuesOpened.length,
      priorIssuesOpened.length,
    ),
    issuesClosed: trendDirectionFromCounts(
      issuesClosed.length,
      priorIssuesClosed.length,
    ),
    commits: trendDirectionFromCounts(commits.length, priorCommits.length),
  };

  return {
    issuesOpened,
    issuesClosed,
    commits,
    userActivity,
    weekStart,
    weekEnd,
    windowDays: days,
    priorWindowStart,
    priorIssuesOpenedCount: priorIssuesOpened.length,
    priorIssuesClosedCount: priorIssuesClosed.length,
    priorCommitsCount: priorCommits.length,
    trends,
    netIssueFlow,
  };
}
