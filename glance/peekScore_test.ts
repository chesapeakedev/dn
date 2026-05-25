// Copyright 2026 Chesapeake Computing
// SPDX-License-Identifier: Apache-2.0

import { assertEquals } from "@std/assert";
import type { IssueListItem } from "../sdk/mod.ts";
import { labelsLookLikeBug, scorePeekIssues } from "./peekScore.ts";

function issueFixture(
  overrides: Partial<IssueListItem> & Pick<IssueListItem, "number">,
): IssueListItem {
  return {
    id: `dummy-${overrides.number}`,
    number: overrides.number,
    title: overrides.title ?? "Title",
    state: overrides.state ?? "OPEN",
    author: overrides.author ?? "alice",
    assignees: overrides.assignees ?? [],
    labels: overrides.labels ?? [],
    createdAt: overrides.createdAt ?? "2026-01-01T00:00:00Z",
    updatedAt: overrides.updatedAt ?? "2026-01-01T00:00:00Z",
    closedAt: overrides.closedAt ?? null,
    url: overrides.url ?? "https://github.com/o/r/issues/" + overrides.number,
    commentCount: overrides.commentCount ?? 0,
  };
}

Deno.test("labelsLookLikeBug detects bug label variants", () => {
  assertEquals(labelsLookLikeBug([]), false);
  assertEquals(labelsLookLikeBug(["documentation"]), false);
  assertEquals(labelsLookLikeBug(["Bug"]), true);
  assertEquals(labelsLookLikeBug(["foobar-bug"]), true);
});

Deno.test("scorePeekIssues ranks older unassigned bugs above fresh assigned", () => {
  const now = new Date("2026-05-25T12:00:00Z");

  const newAssigned = issueFixture({
    number: 1,
    assignees: ["sam"],
    createdAt: "2026-05-20T00:00:00Z",
    updatedAt: "2026-05-21T00:00:00Z",
    labels: [],
  });

  const staleBug = issueFixture({
    number: 2,
    title: "Regress",
    labels: ["bug"],
    assignees: [],
    createdAt: "2026-03-01T00:00:00Z",
    updatedAt: "2026-04-01T00:00:00Z",
    commentCount: 6,
  });

  const ranked = scorePeekIssues([newAssigned, staleBug], now);
  assertEquals(ranked[0]?.issue.number, 2);
  assertEquals(ranked[1]?.issue.number, 1);
});

Deno.test("scorePeekIssues ignores closed rows", () => {
  const now = new Date("2026-05-25T12:00:00Z");
  const openRow = issueFixture({ number: 10 });
  const closedRow = issueFixture({
    number: 11,
    state: "CLOSED",
  });
  assertEquals(scorePeekIssues([openRow, closedRow], now).length, 1);
});
