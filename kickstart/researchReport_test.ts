// Copyright 2026 Chesapeake Computing
// SPDX-License-Identifier: Apache-2.0

import { assertEquals, assertRejects } from "@std/assert";
import {
  checkResearchReport,
  validateResearchReportContent,
} from "./researchReport.ts";

const VALID = `# Title

## Summary

Short summary.

## Request Context

From issue #1.

## Code Pointers

- \`cli/main.ts\`: entry

## Likely Affected Areas

- \`cli/\`

## Open Questions

- TBD

## Suggested Approach

High level only.
`;

Deno.test("validateResearchReportContent accepts a complete report", () => {
  assertEquals(validateResearchReportContent(VALID), []);
});

Deno.test("validateResearchReportContent rejects plan-style sections", () => {
  const bad = VALID + "\n## Implementation Plan\n\nSteps.\n";
  const errors = validateResearchReportContent(bad);
  assertEquals(errors.length > 0, true);
});

Deno.test("checkResearchReport reads a fixture file", async () => {
  const dir = await Deno.makeTempDir({ prefix: "dn-research-report-" });
  const path = `${dir}/research.md`;
  await Deno.writeTextFile(path, VALID);
  try {
    await checkResearchReport(path);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("checkResearchReport throws when file missing", async () => {
  await assertRejects(
    () => checkResearchReport("/nonexistent/dn-research-missing.md"),
    Error,
    "Research report not found",
  );
});
