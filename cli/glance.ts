// Copyright 2026 Chesapeake Computing
// SPDX-License-Identifier: Apache-2.0

import {
  aggregateUserActivity,
  fetchCommits,
  fetchIssuesClosed,
  fetchIssuesOpened,
  formatVelocity,
  getCurrentRepo,
} from "../glance/mod.ts";
import type { VelocityData } from "../glance/types.ts";

function parseArgs(args: string[]): { help: boolean; days: number } {
  let help = false;
  let days = 7;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--help" || arg === "-h") {
      help = true;
    } else if (arg === "--days" || arg === "-d") {
      const daysArg = args[i + 1];
      if (daysArg) {
        days = parseInt(daysArg, 10);
        if (isNaN(days) || days < 1) {
          throw new Error(`Invalid days value: ${daysArg}`);
        }
        i++;
      }
    }
  }

  return { help, days };
}

function showHelp(): void {
  console.log(`
dn glance - Project velocity overview

Usage:
  dn glance [options]

Options:
  -h, --help     Show this help message
  -d, --days N   Show activity for the last N days (default: 7)
`);
}

function getTimeWindow(days: number): { start: Date; end: Date } {
  const end = new Date();
  const start = new Date();
  start.setDate(start.getDate() - days);
  return { start, end };
}

export async function handleGlance(args: string[]): Promise<void> {
  const parsed = parseArgs(args);

  if (parsed.help) {
    showHelp();
    return;
  }

  const repo = await getCurrentRepo();
  const { start, end } = getTimeWindow(parsed.days);

  const [issuesOpened, issuesClosed, commits] = await Promise.all([
    fetchIssuesOpened(repo.owner, repo.repo, start),
    fetchIssuesClosed(repo.owner, repo.repo, start),
    fetchCommits(repo.owner, repo.repo, start),
  ]);

  const userActivity = aggregateUserActivity(
    issuesOpened,
    issuesClosed,
    commits,
  );

  const velocityData: VelocityData = {
    issuesOpened,
    issuesClosed,
    commits,
    userActivity,
    weekStart: start,
    weekEnd: end,
  };

  console.log(formatVelocity(velocityData));
}
