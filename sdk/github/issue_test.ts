// Copyright 2026 Chesapeake Computing
// SPDX-License-Identifier: Apache-2.0

import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import {
  emptyIssueRelationships,
  type IssueData,
  parseTitleFromContextMarkdown,
  suggestPlanNameFromTitle,
  summarizeIssueForDisplay,
  writeIssueContext,
} from "./issue.ts";

Deno.test("suggestPlanNameFromTitle takes the first two words", () => {
  assertEquals(
    suggestPlanNameFromTitle("Add dark mode support for settings"),
    "add-dark",
  );
  assertEquals(suggestPlanNameFromTitle("Fix"), "fix");
  assertEquals(suggestPlanNameFromTitle("  "), null);
  assertEquals(
    suggestPlanNameFromTitle("Plan: name is required!!!"),
    "plan-name",
  );
});

Deno.test("parseTitleFromContextMarkdown supports issue and denoise headers", () => {
  assertEquals(
    parseTitleFromContextMarkdown("# Issue #42: Add dark mode\n\nbody"),
    "Add dark mode",
  );
  assertEquals(
    parseTitleFromContextMarkdown("# Denoise test task\n\nbody"),
    "Denoise test task",
  );
  assertEquals(parseTitleFromContextMarkdown("no heading"), null);
});

Deno.test("summarizeIssueForDisplay uses owner/repo and truncates long titles", () => {
  const issue: IssueData = {
    databaseId: 1,
    number: 42,
    title: "x".repeat(130),
    body: "",
    labels: [],
    repo: "dn",
    owner: "acme",
    relationships: emptyIssueRelationships(),
  };
  const line = summarizeIssueForDisplay(issue, 120);
  assertEquals(line, `acme/dn#42 — ${"x".repeat(117)}...`);
});

Deno.test("summarizeIssueForDisplay falls back to #n when owner/repo missing", () => {
  const issue: IssueData = {
    databaseId: null,
    number: 7,
    title: "Hello",
    body: "",
    labels: [],
    repo: "",
    owner: "",
    relationships: emptyIssueRelationships(),
  };
  assertEquals(summarizeIssueForDisplay(issue), "#7 — Hello");
});

Deno.test("writeIssueContext includes curated relationship summary", async () => {
  const tempFile = await Deno.makeTempFile({ suffix: ".md" });

  try {
    const relationships = emptyIssueRelationships();
    relationships.parent = {
      owner: "acme",
      repo: "platform",
      number: 7,
      title: "Parent issue",
      state: "OPEN",
      url: "https://github.com/acme/platform/issues/7",
    };
    relationships.subIssues = [{
      owner: "acme",
      repo: "platform",
      number: 42,
      title: "Child issue",
      state: "OPEN",
      url: "https://github.com/acme/platform/issues/42",
    }];
    relationships.subIssuesSummary = {
      totalCount: 2,
      openCount: 1,
      closedCount: 1,
    };
    relationships.blockedBy = [{
      owner: "acme",
      repo: "infra",
      number: 9,
      title: "Ship dependency",
      state: "OPEN",
      url: "https://github.com/acme/infra/issues/9",
    }];
    relationships.blockedBySummary = {
      totalCount: 1,
      openCount: 1,
      closedCount: 0,
    };

    const issueData: IssueData = {
      databaseId: 101,
      number: 12,
      title: "Implement relationship support",
      body: "Track issue relationships in kickstart.",
      labels: ["enhancement", "kickstart"],
      repo: "dn",
      owner: "mooch",
      relationships,
    };

    await writeIssueContext(issueData, tempFile);
    const content = await Deno.readTextFile(tempFile);

    assertStringIncludes(content, "## Relationships");
    assertStringIncludes(content, "### Parent");
    assertStringIncludes(content, "- acme/platform#7 Parent issue (open)");
    assertStringIncludes(content, "### Sub-issues");
    assertStringIncludes(content, "- 2 total (1 open, 1 closed)");
    assertStringIncludes(content, "- 1 more not shown");
    assertStringIncludes(content, "### Blocked By");
    assertStringIncludes(content, "- acme/infra#9 Ship dependency (open)");
    assert(content.includes("### Duplicate Of\n(none)"));
  } finally {
    await Deno.remove(tempFile);
  }
});
