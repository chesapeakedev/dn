// Copyright 2026 Chesapeake Computing
// SPDX-License-Identifier: Apache-2.0

import { assert, assertStringIncludes } from "@std/assert";
import {
  emptyIssueRelationships,
  type IssueData,
  writeIssueContext,
} from "./issue.ts";

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
