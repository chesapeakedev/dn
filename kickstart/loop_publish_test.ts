// Copyright 2026 Chesapeake Computing
// SPDX-License-Identifier: Apache-2.0

import { assertRejects } from "@std/assert";
import { type KickstartConfig, runLoopPhase } from "./lib.ts";

function baseConfig(
  overrides: Partial<KickstartConfig> = {},
): KickstartConfig {
  return {
    publish: "pr",
    agentHarness: "codex",
    allowCrossRepo: false,
    issueUrl: null,
    saveCtx: false,
    savedPlanName: null,
    verbosity: "medium",
    skipPlan: false,
    planOnly: false,
    ...overrides,
  };
}

Deno.test("runLoopPhase requires issue data when publishing", async () => {
  const tmpDir = await Deno.makeTempDir({ prefix: "dn-loop-publish-" });
  const planPath = `${tmpDir}/plan.plan.md`;
  await Deno.writeTextFile(
    planPath,
    "# Plan\n\n## Overview\n\nWork.\n\n## Acceptance Criteria\n\n- [ ] done\n",
  );
  try {
    await assertRejects(
      () =>
        runLoopPhase(
          baseConfig({ publish: "pr", workspaceRoot: tmpDir }),
          planPath,
          `${tmpDir}/plan_output.txt`,
          null,
          tmpDir,
        ),
      Error,
      "Publishing requires a resolvable GitHub issue",
    );
    await assertRejects(
      () =>
        runLoopPhase(
          baseConfig({ publish: "direct", workspaceRoot: tmpDir }),
          planPath,
          `${tmpDir}/plan_output.txt`,
          null,
          tmpDir,
        ),
      Error,
      "Publishing requires a resolvable GitHub issue",
    );
  } finally {
    await Deno.remove(tmpDir, { recursive: true });
  }
});
