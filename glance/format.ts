// Copyright 2026 Chesapeake Computing
// SPDX-License-Identifier: Apache-2.0

import type { VelocityData } from "./types.ts";

/**
 * Format a date for display.
 */
function formatDate(date: Date): string {
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

/**
 * Format the velocity data into a readable output.
 */
export function formatVelocity(data: VelocityData): string {
  const lines: string[] = [];

  // Header
  const dateRange = `${formatDate(data.weekStart)} - ${
    formatDate(data.weekEnd)
  }`;
  const days = Math.ceil(
    (data.weekEnd.getTime() - data.weekStart.getTime()) / (1000 * 60 * 60 * 24),
  );
  const title = `Project Velocity: Last ${days} Day${days !== 1 ? "s" : ""}`;
  lines.push("╔═══════════════════════════════════════════════════════════╗");
  lines.push(`║  ${title.padEnd(53)}║`);
  lines.push(`║  ${dateRange.padEnd(53)}║`);
  lines.push("╚═══════════════════════════════════════════════════════════╝");
  lines.push("");

  // Issues Opened
  lines.push(`📝 Issues Opened: ${data.issuesOpened.length}`);
  if (data.issuesOpened.length > 0) {
    for (const issue of data.issuesOpened) {
      lines.push(`   • #${issue.number}: ${issue.title}`);
      lines.push(`     ${issue.url}`);
    }
  } else {
    lines.push("   (none)");
  }
  lines.push("");

  // Issues Closed
  lines.push(`✅ Issues Closed: ${data.issuesClosed.length}`);
  if (data.issuesClosed.length > 0) {
    for (const issue of data.issuesClosed) {
      lines.push(`   • #${issue.number}: ${issue.title}`);
      lines.push(`     ${issue.url}`);
    }
  } else {
    lines.push("   (none)");
  }
  lines.push("");

  // Commits
  lines.push(`💻 Commits: ${data.commits.length}`);
  if (data.commits.length > 0) {
    const displayCommits = data.commits.slice(0, 10); // Show first 10
    for (const commit of displayCommits) {
      lines.push(`   • ${commit.sha}: ${commit.message}`);
    }
    if (data.commits.length > 10) {
      lines.push(`   ... and ${data.commits.length - 10} more`);
    }
  } else {
    lines.push("   (none)");
  }
  lines.push("");

  // User Activity
  lines.push("👥 Activity by User:");
  if (data.userActivity.length > 0) {
    for (const user of data.userActivity) {
      const parts: string[] = [];
      if (user.issuesOpened > 0) {
        parts.push(`${user.issuesOpened} opened`);
      }
      if (user.issuesClosed > 0) {
        parts.push(`${user.issuesClosed} closed`);
      }
      if (user.commits > 0) {
        parts.push(`${user.commits} commits`);
      }
      lines.push(`   • ${user.username}: ${parts.join(", ")}`);
    }
  } else {
    lines.push("   (none)");
  }

  return lines.join("\n");
}
