// Copyright 2026 Chesapeake Computing
// SPDX-License-Identifier: Apache-2.0

import { assertEquals, assertRejects } from "@std/assert";
import {
  type MilestonePlan,
  parseMilestonePlan,
  publishMilestonePlan,
} from "./milestonePlan.ts";

const validPlan: MilestonePlan = {
  schema_version: "1.0",
  repo: "owner/repo",
  milestone: { title: "Auth refactor", due_on: "2026-08-01" },
  issues: [
    { id: "middleware", title: "Add middleware", body: "Body" },
    {
      id: "session",
      title: "Add session store",
      body: "Body",
      labels: ["enhancement"],
      blocked_by: ["middleware"],
    },
  ],
} as const;

Deno.test("parseMilestonePlan validates schema and local relationships", () => {
  assertEquals(parseMilestonePlan(validPlan), validPlan);
});

Deno.test("parseMilestonePlan rejects unresolved blocked_by ids", async () => {
  await assertRejects(
    async () =>
      await parseMilestonePlan({
        ...validPlan,
        issues: [{
          id: "issue",
          title: "Issue",
          body: "Body",
          blocked_by: ["missing"],
        }],
      }),
    Error,
    "Unknown blocked_by issue id: missing",
  );
});

Deno.test("publishMilestonePlan dry-run resolves repo without mutations", async () => {
  const result = await publishMilestonePlan(validPlan, { dryRun: true });
  if (!("dry_run" in result)) throw new Error("Expected dry-run result");
  assertEquals(result, {
    dry_run: true,
    repo: { owner: "owner", repo: "repo" },
    milestone: { title: "Auth refactor", due_on: "2026-08-01" },
    issues: validPlan.issues,
    relationships: [{ issue_id: "session", blocked_by_id: "middleware" }],
  });
});
