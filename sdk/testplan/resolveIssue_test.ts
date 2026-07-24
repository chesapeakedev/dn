// Copyright 2026 Chesapeake Computing
// SPDX-License-Identifier: Apache-2.0

import { assertEquals, assertThrows } from "@std/assert";
import { resolveIssueRefFromPlan } from "./resolveIssue.ts";

Deno.test("resolveIssueRefFromPlan prefers full GitHub URL in body", () => {
  const ref = resolveIssueRefFromPlan(
    `# Plan\n\nGitHub issue: [#341](https://github.com/chesapeakedev/chesapeake/issues/341)\n`,
    "plans/dn-land.plan.md",
  );
  assertEquals(ref, "https://github.com/chesapeakedev/chesapeake/issues/341");
});

Deno.test("resolveIssueRefFromPlan falls back to issue-N filename", () => {
  const ref = resolveIssueRefFromPlan(
    `# Plan\n\n## Overview\n\nDo the thing.\n`,
    "plans/issue-123.plan.md",
  );
  assertEquals(ref, "123");
});

Deno.test("resolveIssueRefFromPlan falls back to Issue #N label", () => {
  const ref = resolveIssueRefFromPlan(
    `# Plan\n\n## Issue\nIssue #99: Add auth\n`,
    "plans/auth.plan.md",
  );
  assertEquals(ref, "99");
});

Deno.test("resolveIssueRefFromPlan falls back to bare #N", () => {
  const ref = resolveIssueRefFromPlan(
    `# Plan\n\nSee #42 for context.\n`,
    "plans/feature.plan.md",
  );
  assertEquals(ref, "42");
});

Deno.test("resolveIssueRefFromPlan throws when no issue reference exists", () => {
  assertThrows(
    () =>
      resolveIssueRefFromPlan(
        `# Plan\n\n## Overview\n\nNo issue link here.\n`,
        "plans/orphan.plan.md",
      ),
    Error,
    "Could not resolve a GitHub issue",
  );
});
