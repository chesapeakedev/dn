#!/usr/bin/env -S deno run --allow-run --allow-env --allow-net
// Copyright 2026 Chesapeake Computing
// SPDX-License-Identifier: Apache-2.0

import {
  aggregateUserActivity,
  fetchCommits,
  fetchIssuesClosed,
  fetchIssuesOpened,
  formatVelocity,
  getCurrentRepo,
} from "./mod.ts";
import type { VelocityData } from "./types.ts";

/**
 * Parse command line arguments.
 */
function parseArgs(): { help: boolean; days: number } {
  const args = Deno.args;
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
          console.error(`Invalid days value: ${daysArg}`);
          Deno.exit(1);
        }
        i++;
      }
    }
  }

  return { help, days };
}

/**
 * Display help message.
 */
function showHelp(): void {
  console.log(`
glance - Project velocity overview

Usage:
  glance [options]

Options:
  -h, --help     Show this help message
  -d, --days N   Show activity for the last N days (default: 7)

Description:
  Visualizes recent project velocity using GitHub issues and commits.
  Shows issues opened/closed, commits, and per-user activity breakdown.

Requirements:
  - GitHub authentication: run \`gh auth login\`, or \`dn auth\` for browser login, or set GITHUB_TOKEN (see docs/authentication.md)
  - Must be run from within a git or sapling repository with a GitHub remote
`);
}

/**
 * Calculate time window based on days.
 */
function getTimeWindow(days: number): { start: Date; end: Date } {
  const end = new Date();
  const start = new Date();
  start.setDate(start.getDate() - days);
  return { start, end };
}

/**
 * Main entry point.
 */
async function main(): Promise<void> {
  const args = parseArgs();

  if (args.help) {
    showHelp();
    Deno.exit(0);
  }

  try {
    // Get repository info
    const repo = await getCurrentRepo();
    console.error(`Repository: ${repo.owner}/${repo.repo}`);

    // Calculate time window
    const { start, end } = getTimeWindow(args.days);
    console.error(
      `Time window: ${start.toLocaleDateString()} - ${end.toLocaleDateString()}`,
    );

    // Fetch data
    console.error("Fetching data...");
    const [issuesOpened, issuesClosed, commits] = await Promise.all([
      fetchIssuesOpened(repo.owner, repo.repo, start),
      fetchIssuesClosed(repo.owner, repo.repo, start),
      fetchCommits(repo.owner, repo.repo, start),
    ]);

    // Aggregate user activity
    const userActivity = aggregateUserActivity(
      issuesOpened,
      issuesClosed,
      commits,
    );

    // Build velocity data
    const velocityData: VelocityData = {
      issuesOpened,
      issuesClosed,
      commits,
      userActivity,
      weekStart: start,
      weekEnd: end,
    };

    // Format and display
    const output = formatVelocity(velocityData);
    console.log(output);
  } catch (error) {
    console.error(
      `Error: ${error instanceof Error ? error.message : String(error)}`,
    );
    Deno.exit(1);
  }
}

if (import.meta.main) {
  await main();
}
