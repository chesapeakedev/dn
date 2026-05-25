// Copyright 2026 Chesapeake Computing
// SPDX-License-Identifier: Apache-2.0

import { assertEquals } from "@std/assert";

import { parseMeldTarget } from "./target.ts";

/** Repository root when `deno test` runs from the project directory. */
const repoRoot = Deno.cwd();

Deno.test("parseMeldTarget defaults to implicit plan naming", async () => {
  const parsed = await parseMeldTarget(null, repoRoot);
  assertEquals(parsed.isDefaultPlan, true);
  assertEquals(parsed.kind, "plan");
});

Deno.test(
  "parseMeldTarget maps README.md basename to readme kind",
  async () => {
    const parsed = await parseMeldTarget("README.md", repoRoot);
    assertEquals(parsed.kind, "readme");
    assertEquals(parsed.workspaceRelativePath, "README.md");
  },
);

Deno.test(
  "parseMeldTarget classifies arbitrary workspace markdown targets",
  async () => {
    const parsed = await parseMeldTarget("notes/design.md", repoRoot);
    assertEquals(parsed.kind, "markdown");
    assertEquals(parsed.workspaceRelativePath, "notes/design.md");
  },
);

Deno.test("parseMeldTarget understands github comment targets", async () => {
  const parsed = await parseMeldTarget("github:comment:42", repoRoot);
  assertEquals(parsed.kind, "github-comment");
  assertEquals(parsed.github?.variant, "comment");
  assertEquals(parsed.github?.issueSpecifier, "42");
});
