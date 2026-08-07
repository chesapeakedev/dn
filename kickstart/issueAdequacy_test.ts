// Copyright 2026 Chesapeake Computing
// SPDX-License-Identifier: Apache-2.0

import { assertEquals } from "@std/assert";
import {
  assessIssueAdequacy,
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

Deno.test("synthesizePlanFromIssue includes required plan sections", () => {
  const plan = synthesizePlanFromIssue({
    title: "Add skip-plan",
    body: "Skip plan when adequate.\n\n- [ ] Heuristic works\n- [ ] Progress event emitted",
  });
  assertEquals(/^#\s+Add skip-plan/m.test(plan), true);
  assertEquals(/^##\s+Overview/m.test(plan), true);
  assertEquals(/^##\s+Implementation\s+Plan/m.test(plan), true);
  assertEquals(/^##\s+Acceptance\s+Criteria/m.test(plan), true);
  assertEquals(plan.includes("Heuristic works"), true);
});
