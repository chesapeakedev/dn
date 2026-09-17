// Copyright 2026 Chesapeake Computing
// SPDX-License-Identifier: Apache-2.0

import { assertEquals } from "@std/assert";
import {
  assessIssueAdequacy,
  decidePlanSkip,
  synthesizePlanFromIssue,
} from "./issueAdequacy.ts";

Deno.test("thin title-only issues stay on the plan path", () => {
  const result = assessIssueAdequacy({
    title: "Fix the bug",
    body: "It is broken.",
  });
  assertEquals(result.adequate, false);
  assertEquals(result.reason, "thin_issue");
});

Deno.test("structured issues with AC and paths are adequate", () => {
  const result = assessIssueAdequacy({
    title: "Tiered dn.json and user config",
    body: `# Summary

Ship tiered config merge for dn.

## Acceptance Criteria

- [ ] Precedence documented in AGENTS.md
- [ ] Unit tests cover merge order
- [ ] Actions bridge reads .github/dn/config.json

## Implementation Plan

1. Add merge helper in sdk/config.ts
2. Wire CLI load path
3. Update docs

Touch \`sdk/config.ts\` and \`cli/main.ts\`.
`,
  });
  assertEquals(result.adequate, true);
  assertEquals(result.reason, "issue_adequate");
  assertEquals(result.signals.includes("acceptance_section"), true);
  assertEquals(result.signals.includes("checklist"), true);
});

Deno.test("canonical kickstart plan headings are adequate", () => {
  const result = assessIssueAdequacy({
    title: "Add retry handling",
    body: `### overview

Add bounded retries to the request path so transient failures recover.

## IMPLEMENTATION PLAN

1. Add the retry policy.

#### Acceptance Criteria

* [x] Retries stop at the configured limit.
* [ ] Tests cover transient failures.
`,
  });
  assertEquals(result.adequate, true);
  assertEquals(result.signals.includes("overview_section"), true);
  assertEquals(result.signals.includes("implementation_section"), true);
  assertEquals(result.signals.includes("acceptance_section"), true);
});

Deno.test("unheaded descriptions with actionable checklists are adequate", () => {
  const result = assessIssueAdequacy({
    title: "Add retry handling",
    body: `Transient requests should retry with bounded exponential backoff.

- [ ] Add the retry policy to the request path
+ [x] Add deterministic tests for transient failures
`,
  });
  assertEquals(result.adequate, true);
  assertEquals(result.reason, "issue_adequate");
});

Deno.test("headed descriptions use the conservative checklist fallback", () => {
  const result = assessIssueAdequacy({
    title: "Add retry handling",
    body: `## Background

Transient requests should retry with bounded exponential backoff.

* [ ] Add the retry policy to the request path
`,
  });
  assertEquals(result.adequate, true);
});

Deno.test("checklists without meaningful descriptions stay on the plan path", () => {
  const cases = [
    "- [ ] Add retries\n- [x] Add tests",
    "## Approach\n\nUse retries.\n\n- [ ] \n",
    "A description without any acceptance criteria.",
  ];
  for (const body of cases) {
    const result = assessIssueAdequacy({ title: "Retry handling", body });
    assertEquals(result.adequate, false);
    assertEquals(result.reason, "thin_issue");
  }
});

Deno.test("generic headings do not substitute for canonical plan sections", () => {
  const result = assessIssueAdequacy({
    title: "Improve behavior",
    body: `## Summary

This is a meaningful description of the requested behavior change.

## Approach

Implement it carefully.
`,
  });
  assertEquals(result.adequate, false);
});

Deno.test("synthesizePlanFromIssue includes required plan sections", () => {
  const plan = synthesizePlanFromIssue({
    title: "Add skip-plan",
    body:
      "Skip plan when adequate.\n\n+ [ ] Heuristic works\n- [ ] Progress event emitted",
  });
  assertEquals(/^#\s+Add skip-plan/m.test(plan), true);
  assertEquals(/^##\s+Overview/m.test(plan), true);
  assertEquals(/^##\s+Implementation\s+Plan/m.test(plan), true);
  assertEquals(/^##\s+Acceptance\s+Criteria/m.test(plan), true);
  assertEquals(plan.includes("Heuristic works"), true);
});

Deno.test("long unstructured issues stay on the plan path", () => {
  const result = assessIssueAdequacy({
    title: "Improve behavior",
    body: "This needs a careful improvement. ".repeat(30),
  });
  assertEquals(result.adequate, false);
  assertEquals(result.reason, "thin_issue");
});

Deno.test("decidePlanSkip rejects malformed existing plans", () => {
  const result = decidePlanSkip({
    issue: { title: "Vague", body: "Please improve this." },
    existingPlanContent: "# Incomplete\n\n## Overview\nNot enough.",
    reuseExistingPlan: true,
  });
  assertEquals(result.reason, "plan_required");
});

Deno.test("decidePlanSkip reuses valid incomplete plans", () => {
  const plan = `# Feature

## Overview
Work

## Implementation Plan
Do it

## Acceptance Criteria
- [ ] Remaining
`;
  const result = decidePlanSkip({
    issue: { title: "Vague", body: "Please improve this." },
    existingPlanContent: plan,
    reuseExistingPlan: true,
  });
  assertEquals(result.reason, "existing_plan");
  assertEquals(result.existingPlanCompletion?.incomplete, ["Remaining"]);
});
