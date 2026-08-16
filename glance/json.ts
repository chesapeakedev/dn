// Copyright 2026 Chesapeake Computing
// SPDX-License-Identifier: Apache-2.0

import type { RfcMetrics } from "./collectRfcMetrics.ts";
import type { VelocityData } from "./types.ts";

/** Machine-readable glance report (`dn glance --json`). */
export interface GlanceJsonReport {
  schema_version: "1.0";
  windowDays: number;
  weekStart: string;
  weekEnd: string;
  velocity: {
    issuesOpenedCount: number;
    issuesClosedCount: number;
    commitsCount: number;
    priorIssuesOpenedCount: number;
    priorIssuesClosedCount: number;
    priorCommitsCount: number;
    netIssueFlow: number;
    trends: VelocityData["trends"];
    issuesOpened: VelocityData["issuesOpened"];
    issuesClosed: VelocityData["issuesClosed"];
    commits: VelocityData["commits"];
    userActivity: VelocityData["userActivity"];
  };
  rfc?: {
    total: number;
    doneCount: number;
    percentDone: number;
    countsByStatus: RfcMetrics["countsByStatus"];
    recentlyUpdated: RfcMetrics["recentlyUpdated"];
  };
}

/**
 * Serializes glance velocity (and optional RFC metrics) as JSON.
 *
 * Omits `rfc` when the corpus directory is absent.
 */
export function formatGlanceJson(
  velocity: VelocityData,
  rfc: RfcMetrics | null,
): string {
  const report: GlanceJsonReport = {
    schema_version: "1.0",
    windowDays: velocity.windowDays,
    weekStart: velocity.weekStart.toISOString(),
    weekEnd: velocity.weekEnd.toISOString(),
    velocity: {
      issuesOpenedCount: velocity.issuesOpened.length,
      issuesClosedCount: velocity.issuesClosed.length,
      commitsCount: velocity.commits.length,
      priorIssuesOpenedCount: velocity.priorIssuesOpenedCount,
      priorIssuesClosedCount: velocity.priorIssuesClosedCount,
      priorCommitsCount: velocity.priorCommitsCount,
      netIssueFlow: velocity.netIssueFlow,
      trends: velocity.trends,
      issuesOpened: velocity.issuesOpened,
      issuesClosed: velocity.issuesClosed,
      commits: velocity.commits,
      userActivity: velocity.userActivity,
    },
  };

  if (rfc) {
    report.rfc = {
      total: rfc.total,
      doneCount: rfc.doneCount,
      percentDone: rfc.percentDone,
      countsByStatus: rfc.countsByStatus,
      recentlyUpdated: rfc.recentlyUpdated,
    };
  }

  return `${JSON.stringify(report, null, 2)}\n`;
}
