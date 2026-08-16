// Copyright 2026 Chesapeake Computing
// SPDX-License-Identifier: Apache-2.0

import type { Issue } from "../sdk/mod.ts";
import { isColorEnabled, isUnattended } from "../sdk/github/output.ts";
import { RFC_STATUSES } from "../sdk/rfc/types.ts";
import type { RfcMetrics } from "./collectRfcMetrics.ts";
import type {
  FormatVelocityOptions,
  TrendDirection,
  VelocityData,
} from "./types.ts";
import {
  asciiFilledBar,
  formatRelativeCalendarDays,
  truncateWithEllipsis,
} from "./velocityHelpers.ts";

const ANSI = {
  reset: "\x1b[0m",
  yellow: "\x1b[33m",
} as const;

const TITLE_MAX = 72;
/** Hot if created or closed within this many hours of report `now`. */
export const HOT_RECENT_HOURS = 48;

function trendArrow(d: TrendDirection): string {
  switch (d) {
    case "up":
      return "\u2191"; // ↑
    case "down":
      return "\u2193"; // ↓
    default:
      return "\u2192"; // →
  }
}

function trendLabel(d: TrendDirection): string {
  switch (d) {
    case "up":
      return "[UP]";
    case "down":
      return "[DOWN]";
    default:
      return "[FLAT]";
  }
}

function hotMark(text: string): string {
  if (!isColorEnabled() || isUnattended()) return text;
  return `${ANSI.yellow}${text}${ANSI.reset}`;
}

function formatCalendarDate(date: Date): string {
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function rateLine(count: number, days: number): string {
  if (days <= 0) return "0/day";
  const r = count / days;
  const rounded = Math.round(r * 10) / 10;
  return `${rounded}/day`;
}

function netFlowPhrase(net: number): string {
  if (net > 0) return `(backlog grew by ${net})`;
  if (net < 0) return `(burned down ${Math.abs(net)})`;
  return "(opened = closed)";
}

function boxLine(text: string, contentWidth: number): string {
  const useUnicode = !isUnattended();
  const body = text.length > contentWidth ? text.slice(0, contentWidth) : text;
  const padded = body + " ".repeat(contentWidth - body.length);
  if (useUnicode) return `\u2551  ${padded}\u2551`;
  return `|  ${padded}|`;
}

function boxFrameTop(contentWidth: number): string {
  const inner = contentWidth + 2;
  const useUnicode = !isUnattended();
  if (useUnicode) return "\u2554" + "\u2550".repeat(inner) + "\u2557";
  return "+" + "-".repeat(inner) + "+";
}

function boxFrameSep(contentWidth: number): string {
  const inner = contentWidth + 2;
  const useUnicode = !isUnattended();
  if (useUnicode) return "\u2560" + "\u2550".repeat(inner) + "\u2563";
  return "+" + "-".repeat(inner) + "+";
}

function boxFrameBot(contentWidth: number): string {
  const inner = contentWidth + 2;
  const useUnicode = !isUnattended();
  if (useUnicode) return "\u255A" + "\u2550".repeat(inner) + "\u255D";
  return "+" + "-".repeat(inner) + "+";
}

/**
 * Returns true if `iso` is within the last {@link HOT_RECENT_HOURS} hours of `now`.
 */
export function isRecentlyActive(iso: string, now: Date): boolean {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return false;
  return now.getTime() - t <= HOT_RECENT_HOURS * 3_600_000;
}

/** Primary bucket for grouping; first label or "(no label)". */
export function primaryIssueLabel(issue: Issue): string {
  if (issue.labels.length === 0) return "(no label)";
  return [...issue.labels].sort((a, b) => a.localeCompare(b))[0] ??
    "(no label)";
}

function groupIssuesByLabel(issues: Issue[]): Map<string, Issue[]> {
  const m = new Map<string, Issue[]>();
  for (const issue of issues) {
    const key = primaryIssueLabel(issue);
    const list = m.get(key) ?? [];
    list.push(issue);
    m.set(key, list);
  }
  for (const list of m.values()) {
    list.sort((a, b) => a.number - b.number);
  }
  return m;
}

function formatIssueBlocks(
  issues: Issue[],
  opts: { compact: boolean; noUrls: boolean },
  referenceTime: Date,
  eventTime: (i: Issue) => string | null,
): string[] {
  const lines: string[] = [];
  const groups = groupIssuesByLabel(issues);
  const keys = [...groups.keys()].sort((a, b) => a.localeCompare(b));
  for (const label of keys) {
    const bucket = groups.get(label)!;
    lines.push(
      opts.compact ? `  ${label}:` : `  -- ${label} --`,
    );
    for (const issue of bucket) {
      const when = eventTime(issue);
      const rel = when
        ? `${formatRelativeCalendarDays(when, referenceTime)}`
        : "";
      const hot = when && isRecentlyActive(when, referenceTime)
        ? (isUnattended() ? " [HOT]" : hotMark(" [HOT]"))
        : "";
      const title = truncateWithEllipsis(issue.title, TITLE_MAX);
      const bullet = isUnattended() ? "-" : "\u2022";
      lines.push(
        `   ${bullet} #${issue.number}: ${title}${hot}${
          rel ? ` (${rel})` : ""
        }`,
      );
      if (!opts.noUrls) {
        lines.push(`     ${issue.url}`);
      }
    }
  }
  return lines;
}

function formatRfcSummaryStrip(
  metrics: RfcMetrics,
  opts: { compact: boolean },
  referenceTime: Date,
): string[] {
  const lines: string[] = [];
  lines.push(...(opts.compact ? [] : [""]));

  const statusParts = RFC_STATUSES
    .filter((status) => metrics.countsByStatus[status] > 0)
    .map((status) => `${status}:${metrics.countsByStatus[status]}`);

  const header = isUnattended() ? "RFCs" : "RFCs";
  lines.push(
    `${header}: ${metrics.total} total, ${metrics.percentDone}% done (${metrics.doneCount} done)`,
  );
  if (statusParts.length > 0) {
    lines.push(`   ${statusParts.join("  ")}`);
  }

  if (metrics.recentlyUpdated.length > 0) {
    lines.push(`   ${opts.compact ? "Updated:" : "Recently updated:"}`);
    for (const rfc of metrics.recentlyUpdated.slice(0, 5)) {
      const rel = formatRelativeCalendarDays(rfc.updatedAt, referenceTime);
      const idStr = rfc.id.toString().padStart(3, "0");
      const title = truncateWithEllipsis(rfc.title, TITLE_MAX);
      lines.push(
        `   - ${idStr} [${rfc.status}] ${title} (${rel})`,
      );
    }
    if (metrics.recentlyUpdated.length > 5) {
      lines.push(`   ... and ${metrics.recentlyUpdated.length - 5} more`);
    }
  } else if (metrics.total > 0) {
    lines.push("   (no RFCs updated in window)");
  }

  return lines;
}

/**
 * Renders velocity data for terminal or CI.
 */
export function formatVelocity(
  data: VelocityData,
  options: FormatVelocityOptions = {},
): string {
  const opts = {
    compact: options.compact ?? false,
    noUrls: options.noUrls ?? false,
  };
  const now = data.weekEnd;
  const lines: string[] = [];

  const contentWidth = 53;
  const days = data.windowDays > 0 ? data.windowDays : 1;
  const opensPerDay = rateLine(data.issuesOpened.length, days);
  const closesPerDay = rateLine(data.issuesClosed.length, days);
  const commitsPerDay = rateLine(data.commits.length, days);

  const dateRange = `${formatCalendarDate(data.weekStart)} - ${
    formatCalendarDate(now)
  }`;
  const title = `Project Velocity: last ${days} day${days !== 1 ? "s" : ""}`;

  lines.push(boxFrameTop(contentWidth));
  lines.push(boxLine(title, contentWidth));
  lines.push(boxLine(dateRange, contentWidth));
  lines.push(boxFrameSep(contentWidth));
  const priorOpens = rateLine(data.priorIssuesOpenedCount, days);
  const priorCloses = rateLine(data.priorIssuesClosedCount, days);
  const priorCommits = rateLine(data.priorCommitsCount, days);

  const tOpen = isUnattended()
    ? trendLabel(data.trends.issuesOpened)
    : trendArrow(data.trends.issuesOpened);
  const tClose = isUnattended()
    ? trendLabel(data.trends.issuesClosed)
    : trendArrow(data.trends.issuesClosed);
  const tCommit = isUnattended()
    ? trendLabel(data.trends.commits)
    : trendArrow(data.trends.commits);

  const summary1 =
    `Opens: ${data.issuesOpened.length} (${opensPerDay}) ${tOpen}  vs prior ${data.priorIssuesOpenedCount} (${priorOpens})`;
  const summary2 =
    `Closes: ${data.issuesClosed.length} (${closesPerDay}) ${tClose}  vs prior ${data.priorIssuesClosedCount} (${priorCloses})`;
  const summary3 =
    `Commits: ${data.commits.length} (${commitsPerDay}) ${tCommit}  vs prior ${data.priorCommitsCount} (${priorCommits})`;
  const summary4 = `Net issue flow: ${
    data.netIssueFlow >= 0 ? "+" : ""
  }${data.netIssueFlow} opened - closed ${netFlowPhrase(data.netIssueFlow)}`;

  for (const row of [summary1, summary2, summary3, summary4]) {
    lines.push(boxLine(row, contentWidth));
  }
  lines.push(boxFrameBot(contentWidth));

  if (options.rfcMetrics) {
    lines.push(...formatRfcSummaryStrip(options.rfcMetrics, opts, now));
  }

  const blank = opts.compact ? [] : [""];
  lines.push(...blank);

  // Issues opened
  const openHeader = isUnattended()
    ? "Issues opened"
    : `\u{1F4DD} Issues opened: ${data.issuesOpened.length}`;
  lines.push(openHeader);
  if (data.issuesOpened.length === 0) lines.push("   (none)");
  else {lines.push(...formatIssueBlocks(data.issuesOpened, opts, now, (i) =>
      i.createdAt));}

  lines.push(...(opts.compact ? [] : [""]));

  const closeHeader = isUnattended()
    ? "Issues closed"
    : `\u2705 Issues closed: ${data.issuesClosed.length}`;
  lines.push(closeHeader);
  if (data.issuesClosed.length === 0) lines.push("   (none)");
  else {
    lines.push(
      ...formatIssueBlocks(
        data.issuesClosed,
        opts,
        now,
        (i) => i.closedAt,
      ),
    );
  }

  lines.push(...(opts.compact ? [] : [""]));

  const commitHeader = isUnattended()
    ? "Commits"
    : `\u{1F4BB} Commits: ${data.commits.length}`;
  lines.push(commitHeader);
  if (data.commits.length === 0) {
    lines.push("   (none)");
  } else {
    const displayCommits = data.commits.slice(0, 10);
    for (const commit of displayCommits) {
      const rel = formatRelativeCalendarDays(commit.date, now);
      const sha = commit.sha;
      const msg = truncateWithEllipsis(commit.message, TITLE_MAX - 10);
      lines.push(`   - ${sha}: ${msg} (${rel})`);
      if (!opts.noUrls) lines.push(`     ${commit.url}`);
    }
    if (data.commits.length > 10) {
      lines.push(`   ... and ${data.commits.length - 10} more`);
    }
  }

  lines.push(...(opts.compact ? [] : [""]));

  const userHeader = isUnattended()
    ? "Activity by user (share of opens+closes+commits in window)"
    : `\u{1F465} Activity by user (share)`;
  lines.push(userHeader);
  if (data.userActivity.length === 0) {
    lines.push("   (none)");
  } else {
    const maxTotal = Math.max(
      ...data.userActivity.map((u) =>
        u.issuesOpened + u.issuesClosed + u.commits
      ),
      1,
    );
    for (const user of data.userActivity) {
      const total = user.issuesOpened + user.issuesClosed + user.commits;
      const frac = total / maxTotal;
      const bar = asciiFilledBar(frac, 12);
      const parts: string[] = [];
      if (user.issuesOpened > 0) parts.push(`${user.issuesOpened} opened`);
      if (user.issuesClosed > 0) parts.push(`${user.issuesClosed} closed`);
      if (user.commits > 0) parts.push(`${user.commits} commits`);
      const pct = `${user.activitySharePercent}%`;
      lines.push(
        `   - ${user.username}: ${pct} ${bar} ${parts.join(", ")}`,
      );
    }
  }

  return lines.join("\n");
}
