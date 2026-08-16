// Copyright 2026 Chesapeake Computing
// SPDX-License-Identifier: Apache-2.0

import { assertEquals } from "@std/assert";
import { join } from "@std/path";
import { handleRfc } from "../cli/rfc.ts";
import { gatherRfcMetrics } from "./collectRfcMetrics.ts";
import { formatVelocity } from "./format.ts";
import { formatGlanceJson } from "./json.ts";
import type { VelocityData } from "./types.ts";

async function withTempCwd(
  fn: (root: string) => Promise<void>,
): Promise<void> {
  const root = await Deno.makeTempDir({ prefix: "dn-glance-rfc-" });
  const previous = Deno.cwd();
  try {
    Deno.chdir(root);
    await fn(root);
  } finally {
    Deno.chdir(previous);
    await Deno.remove(root, { recursive: true });
  }
}

function emptyVelocity(referenceTime: Date): VelocityData {
  return {
    issuesOpened: [],
    issuesClosed: [],
    commits: [],
    userActivity: [],
    weekStart: new Date(referenceTime.getTime() - 7 * 86_400_000),
    weekEnd: referenceTime,
    windowDays: 7,
    priorWindowStart: new Date(referenceTime.getTime() - 14 * 86_400_000),
    priorIssuesOpenedCount: 0,
    priorIssuesClosedCount: 0,
    priorCommitsCount: 0,
    trends: {
      issuesOpened: "flat",
      issuesClosed: "flat",
      commits: "flat",
    },
    netIssueFlow: 0,
  };
}

Deno.test("gatherRfcMetrics returns null without RFC directory", async () => {
  await withTempCwd(async (root) => {
    const metrics = await gatherRfcMetrics({
      repoRoot: root,
      windowDays: 7,
    });
    assertEquals(metrics, null);
  });
});

Deno.test("gatherRfcMetrics counts statuses from RFC state", async () => {
  await withTempCwd(async (root) => {
    const originalLog = console.log;
    console.log = () => {};
    try {
      await handleRfc(["init"]);
      await handleRfc(["create", "--title", "First", "--slug", "first"]);
      await handleRfc(["create", "--title", "Second", "--slug", "second"]);
      await handleRfc(["status", "1", "review"]);
      await handleRfc(["complete", "2"]);
    } finally {
      console.log = originalLog;
    }

    const metrics = await gatherRfcMetrics({
      repoRoot: root,
      windowDays: 7,
    });
    assertEquals(metrics !== null, true);
    assertEquals(metrics!.total, 2);
    assertEquals(metrics!.doneCount, 1);
    assertEquals(metrics!.percentDone, 50);
    assertEquals(metrics!.countsByStatus.draft, 0);
    assertEquals(metrics!.countsByStatus.review, 1);
    assertEquals(metrics!.countsByStatus.done, 1);
    assertEquals(metrics!.recentlyUpdated.length, 2);

    const configured = join(root, "custom-rfcs");
    await Deno.mkdir(configured, { recursive: true });
    await Deno.writeTextFile(
      join(root, "dn.json"),
      JSON.stringify({ schema_version: "2.0", rfc: { dir: "custom-rfcs" } }),
    );
    const emptyCustom = await gatherRfcMetrics({
      repoRoot: root,
      windowDays: 7,
    });
    assertEquals(emptyCustom !== null, true);
    assertEquals(emptyCustom!.total, 0);
  });
});

Deno.test("formatVelocity unchanged without RFC metrics", () => {
  const referenceTime = new Date("2026-01-15T12:00:00.000Z");
  const velocity = emptyVelocity(referenceTime);
  const baseline = formatVelocity(velocity);
  const again = formatVelocity(velocity, { rfcMetrics: null });
  assertEquals(again, baseline);
  assertEquals(baseline.includes("RFCs:"), false);
});

Deno.test("formatVelocity includes RFC strip when corpus exists", () => {
  const referenceTime = new Date("2026-01-15T12:00:00.000Z");
  const velocity = emptyVelocity(referenceTime);
  const output = formatVelocity(velocity, {
    rfcMetrics: {
      total: 3,
      doneCount: 1,
      percentDone: 33,
      countsByStatus: {
        draft: 1,
        review: 1,
        accepted: 0,
        implementing: 0,
        done: 1,
        superseded: 0,
      },
      recentlyUpdated: [{
        id: 2,
        title: "Auth model",
        status: "review",
        path: "rfcs/002-auth-model.md",
        updatedAt: "2026-01-14T10:00:00.000Z",
      }],
    },
  });
  assertEquals(output.includes("RFCs: 3 total, 33% done (1 done)"), true);
  assertEquals(output.includes("draft:1"), true);
  assertEquals(output.includes("002 [review] Auth model"), true);
});

Deno.test("formatGlanceJson omits RFC fields without corpus", () => {
  const referenceTime = new Date("2026-01-15T12:00:00.000Z");
  const velocity = emptyVelocity(referenceTime);
  const parsed = JSON.parse(formatGlanceJson(velocity, null)) as Record<
    string,
    unknown
  >;
  assertEquals(parsed.schema_version, "1.0");
  assertEquals("rfc" in parsed, false);
});

Deno.test("formatGlanceJson includes RFC fields when present", () => {
  const referenceTime = new Date("2026-01-15T12:00:00.000Z");
  const velocity = emptyVelocity(referenceTime);
  const parsed = JSON.parse(
    formatGlanceJson(velocity, {
      total: 1,
      doneCount: 0,
      percentDone: 0,
      countsByStatus: {
        draft: 1,
        review: 0,
        accepted: 0,
        implementing: 0,
        done: 0,
        superseded: 0,
      },
      recentlyUpdated: [],
    }),
  ) as { rfc?: { total: number } };
  assertEquals(parsed.rfc?.total, 1);
});
