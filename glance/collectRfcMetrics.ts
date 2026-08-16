// Copyright 2026 Chesapeake Computing
// SPDX-License-Identifier: Apache-2.0

import { isAbsolute, join } from "@std/path";
import { getRfcDir, listRfcsFromState } from "../sdk/rfc/state.ts";
import { RFC_STATUSES, type RfcStatus } from "../sdk/rfc/types.ts";

/** One RFC touched within the glance reporting window (by file mtime). */
export interface RfcRecentlyUpdated {
  id: number;
  title: string;
  status: RfcStatus;
  /** Repository-relative path stored in RFC state. */
  path: string;
  /** ISO-8601 timestamp from the markdown file mtime. */
  updatedAt: string;
}

/** Aggregated RFC completion metrics for glance. */
export interface RfcMetrics {
  /** RFC count from `.state.json`, same source as `dn rfc list`. */
  total: number;
  /** Count with status `done`. */
  doneCount: number;
  /** Rounded percentage of `doneCount / total`, or 0 when empty. */
  percentDone: number;
  countsByStatus: Record<RfcStatus, number>;
  /** RFCs whose files were modified within the glance window. */
  recentlyUpdated: RfcRecentlyUpdated[];
}

function emptyCountsByStatus(): Record<RfcStatus, number> {
  const counts = {} as Record<RfcStatus, number>;
  for (const status of RFC_STATUSES) {
    counts[status] = 0;
  }
  return counts;
}

function resolveRfcPath(storedPath: string, repoRoot: string): string {
  if (isAbsolute(storedPath) || /^[A-Za-z]:[\\/]/.test(storedPath)) {
    return storedPath;
  }
  return join(repoRoot, storedPath);
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await Deno.stat(path);
    return true;
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) return false;
    throw error;
  }
}

/** Options for {@link gatherRfcMetrics}. */
export interface GatherRfcMetricsOptions {
  /** Repository root. Defaults to the process cwd. */
  repoRoot?: string;
  /** Glance `--days` window length. */
  windowDays: number;
  /** End of the reporting window (defaults to now). */
  referenceTime?: Date;
}

/**
 * Loads RFC completion metrics when the configured RFC directory exists.
 *
 * Returns `null` when `rfcs/` (or `dn.json` `rfc.dir`) is absent so glance
 * output stays unchanged. Metrics use the same state index as `dn rfc list`.
 */
export async function gatherRfcMetrics(
  options: GatherRfcMetricsOptions,
): Promise<RfcMetrics | null> {
  const repoRoot = options.repoRoot ?? Deno.cwd();
  const rfcDir = await getRfcDir({ repoRoot });
  if (!await pathExists(rfcDir)) {
    return null;
  }

  const rfcs = await listRfcsFromState({ repoRoot });
  const countsByStatus = emptyCountsByStatus();
  for (const rfc of rfcs) {
    countsByStatus[rfc.metadata.status]++;
  }

  const total = rfcs.length;
  const doneCount = countsByStatus.done;
  const percentDone = total > 0 ? Math.round((100 * doneCount) / total) : 0;

  const referenceTime = options.referenceTime ?? new Date();
  const windowStart = new Date(referenceTime);
  windowStart.setDate(windowStart.getDate() - options.windowDays);

  const recentlyUpdated: RfcRecentlyUpdated[] = [];
  for (const rfc of rfcs) {
    const absolutePath = resolveRfcPath(rfc.path, repoRoot);
    try {
      const stat = await Deno.stat(absolutePath);
      const mtime = stat.mtime ?? new Date(0);
      if (mtime >= windowStart && mtime <= referenceTime) {
        recentlyUpdated.push({
          id: rfc.metadata.id,
          title: rfc.metadata.title,
          status: rfc.metadata.status,
          path: rfc.path,
          updatedAt: mtime.toISOString(),
        });
      }
    } catch (error) {
      if (error instanceof Deno.errors.NotFound) continue;
      throw error;
    }
  }
  recentlyUpdated.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));

  return {
    total,
    doneCount,
    percentDone,
    countsByStatus,
    recentlyUpdated,
  };
}
