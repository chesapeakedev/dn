// Copyright 2026 Chesapeake Computing
// SPDX-License-Identifier: Apache-2.0

import { assertEquals } from "@std/assert";
import { classifyLoopTarget, resolveLoopTarget } from "./loop.ts";

Deno.test("classifyLoopTarget accepts plan files, issue URLs, and issue numbers", () => {
  assertEquals(classifyLoopTarget(null), { kind: "auto" });
  assertEquals(classifyLoopTarget("plans/task.plan.md"), {
    kind: "plan-file",
    path: "plans/task.plan.md",
  });
  assertEquals(classifyLoopTarget("https://github.com/o/r/issues/123"), {
    kind: "github-issue",
    input: "https://github.com/o/r/issues/123",
  });
  assertEquals(classifyLoopTarget("#123"), {
    kind: "github-issue",
    input: "#123",
  });
});

Deno.test("resolveLoopTarget maps an issue URL to an existing matching plan", async () => {
  const repoRoot = await Deno.makeTempDir({ prefix: "dn-loop-target-" });
  try {
    await Deno.mkdir(`${repoRoot}/plans`, { recursive: true });
    await Deno.writeTextFile(
      `${repoRoot}/plans/copilot.plan.md`,
      [
        "# Add Copilot mode",
        "",
        "Issue: https://github.com/chesapeakedev/chesapeake/issues/211",
        "",
      ].join("\n"),
    );

    const resolved = await resolveLoopTarget(
      {
        kind: "github-issue",
        input: "https://github.com/chesapeakedev/chesapeake/issues/211",
      },
      repoRoot,
    );

    assertEquals(resolved, {
      planFilePath: `${repoRoot}/plans/copilot.plan.md`,
      issueUrl: "https://github.com/chesapeakedev/chesapeake/issues/211",
      planSource: "file",
    });
  } finally {
    await Deno.remove(repoRoot, { recursive: true });
  }
});

Deno.test("resolveLoopTarget falls back to an issue source with no matching plan", async () => {
  const repoRoot = await Deno.makeTempDir({ prefix: "dn-loop-target-" });
  try {
    await Deno.mkdir(`${repoRoot}/plans`, { recursive: true });
    await Deno.writeTextFile(
      `${repoRoot}/plans/unrelated.plan.md`,
      "# Unrelated\n\nIssue: https://github.com/o/r/issues/1\n",
    );

    const resolved = await resolveLoopTarget(
      {
        kind: "github-issue",
        input: "https://github.com/chesapeakedev/chesapeake/issues/211",
      },
      repoRoot,
    );

    assertEquals(resolved, {
      planFilePath: null,
      issueUrl: "https://github.com/chesapeakedev/chesapeake/issues/211",
      planSource: "github-issue",
    });
  } finally {
    await Deno.remove(repoRoot, { recursive: true });
  }
});
