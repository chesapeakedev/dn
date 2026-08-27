// Copyright 2026 Chesapeake Computing
// SPDX-License-Identifier: Apache-2.0

import { assertEquals, assertThrows } from "@std/assert";
import { join } from "@std/path";
import {
  applyProgressEnvFromClientPayload,
  evaluateDailyKickstartReadiness,
  materializeKickstartPlanArtifact,
  openAutomationPullRequestUrl,
  openKickstartPullRequestUrl,
  renderWorkflowSummary,
  resolveDailyKickstartMilestone,
  resolveWorkflowArguments,
} from "./exec.ts";

Deno.test("applyProgressEnvFromClientPayload sets HTTP progress env", () => {
  const env: Record<string, string> = {};
  assertEquals(
    applyProgressEnvFromClientPayload(
      {
        progress: {
          mode: "http",
          url: "https://denoise.example/api/kickstart/invocations/id/events",
          token: "secret-token",
        },
      },
      (key, value) => {
        env[key] = value;
      },
    ),
    true,
  );
  assertEquals(env.DN_PROGRESS, "http");
  assertEquals(
    env.DN_PROGRESS_URL,
    "https://denoise.example/api/kickstart/invocations/id/events",
  );
  assertEquals(env.DN_PROGRESS_TOKEN, "secret-token");
});

Deno.test("applyProgressEnvFromClientPayload ignores incomplete progress", () => {
  const env: Record<string, string> = {};
  assertEquals(
    applyProgressEnvFromClientPayload(
      { progress: { mode: "http", url: "https://example.com" } },
      (key, value) => {
        env[key] = value;
      },
    ),
    false,
  );
  assertEquals(Object.keys(env).length, 0);
});

Deno.test("resolveWorkflowArguments maps init stack payload", () => {
  assertEquals(
    resolveWorkflowArguments(
      "dn.init_stack",
      "repository_dispatch",
      {
        action: "dn.init_stack",
        client_payload: {
          schema_version: "1.0",
          dispatch_id: "dispatch-1",
          milestone: 42,
          refresh: false,
        },
      },
      "claude",
    ),
    ["--agent", "claude", "init", "stack", "42", "--publish", "pr"],
  );
});

Deno.test("resolveWorkflowArguments maps init stack refresh payload", () => {
  assertEquals(
    resolveWorkflowArguments(
      "dn.init_stack",
      "repository_dispatch",
      {
        action: "dn.init_stack",
        client_payload: {
          schema_version: "1.0",
          dispatch_id: "dispatch-1b",
          milestone: 42,
          stack_mode: "refresh",
        },
      },
      "claude",
    ),
    [
      "--agent",
      "claude",
      "init",
      "stack",
      "42",
      "--refresh",
      "--publish",
      "pr",
    ],
  );
});

Deno.test("resolveWorkflowArguments preserves issue URL as one argument", () => {
  const issue = "https://github.com/acme/widgets/issues/42";
  assertEquals(
    resolveWorkflowArguments(
      "dn.kickstart_issue",
      "repository_dispatch",
      {
        action: "dn.kickstart_issue",
        client_payload: {
          schema_version: "1.0",
          dispatch_id: "dispatch-2",
          issue_url: issue,
          awp: true,
        },
      },
      "cursor",
    ),
    ["--agent", "cursor", "kickstart", "--publish", "pr", issue],
  );
});

Deno.test("resolveWorkflowArguments adds --plan-only for pause_after plan", () => {
  const issue = "https://github.com/acme/widgets/issues/42";
  assertEquals(
    resolveWorkflowArguments(
      "dn.kickstart_issue",
      "repository_dispatch",
      {
        action: "dn.kickstart_issue",
        client_payload: {
          schema_version: "1.0",
          dispatch_id: "dispatch-plan",
          issue_url: issue,
          awp: true,
          pause_after: "plan",
        },
      },
      "cursor",
    ),
    [
      "--agent",
      "cursor",
      "kickstart",
      "--publish",
      "pr",
      "--plan-only",
      issue,
    ],
  );
});

Deno.test("resolveWorkflowArguments adds --skip-plan for implement beat", () => {
  const issue = "https://github.com/acme/widgets/issues/42";
  assertEquals(
    resolveWorkflowArguments(
      "dn.kickstart_issue",
      "repository_dispatch",
      {
        action: "dn.kickstart_issue",
        client_payload: {
          schema_version: "1.0",
          dispatch_id: "dispatch-impl",
          issue_url: issue,
          awp: true,
          skip_plan: true,
          plan_file: "plans/issue-42.plan.md",
        },
      },
      "cursor",
    ),
    [
      "--agent",
      "cursor",
      "kickstart",
      "--publish",
      "pr",
      "--skip-plan",
      "--saved-plan",
      "issue-42",
      issue,
    ],
  );
});

Deno.test("materializeKickstartPlanArtifact writes reviewed markdown", async () => {
  const tmp = await Deno.makeTempDir();
  const previous = Deno.cwd();
  Deno.chdir(tmp);
  try {
    const path = await materializeKickstartPlanArtifact(
      { plan_file: "plans/issue-42.plan.md" },
      {
        DN_PROGRESS_URL:
          "https://denoise.example/api/kickstart/invocations/id/events",
        DN_PROGRESS_TOKEN: "secret",
      },
      () =>
        Promise.resolve(
          new Response(
            JSON.stringify({
              path: "plans/issue-42.plan.md",
              markdown: "# Plan\n\n## Overview\n\nDo it.\n",
            }),
            { status: 200 },
          ),
        ),
    );
    assertEquals(path, "plans/issue-42.plan.md");
    assertEquals(
      await Deno.readTextFile("plans/issue-42.plan.md"),
      "# Plan\n\n## Overview\n\nDo it.\n",
    );
  } finally {
    Deno.chdir(previous);
    await Deno.remove(tmp, { recursive: true });
  }
});

Deno.test("resolveWorkflowArguments maps meld planning payload", () => {
  const issue = "https://github.com/acme/widgets/issues/42";
  assertEquals(
    resolveWorkflowArguments(
      "dn.meld_issue_plan",
      "repository_dispatch",
      {
        action: "dn.meld_issue_plan",
        client_payload: {
          schema_version: "1.0",
          dispatch_id: "dispatch-meld",
          issue_url: issue,
          plan_name: "widgets",
        },
      },
      "codex",
    ),
    [
      "--agent",
      "codex",
      "meld",
      "--yes",
      "--plan-name",
      "widgets",
      "--target",
      `github:issue:${issue}`,
      issue,
    ],
  );
});

Deno.test("resolveWorkflowArguments keeps legacy prep dispatch compatible", () => {
  assertEquals(
    resolveWorkflowArguments(
      "dn.prep_issue_plan",
      "repository_dispatch",
      {
        action: "dn.prep_issue_plan",
        client_payload: {
          schema_version: "1.0",
          dispatch_id: "dispatch-prep",
          issue_number: 42,
        },
      },
      "opencode",
    ),
    [
      "--agent",
      "opencode",
      "meld",
      "--yes",
      "--target",
      "github:issue:42",
      "42",
    ],
  );
});

Deno.test("canonical meld mapping accepts the legacy prep event action", () => {
  assertEquals(
    resolveWorkflowArguments(
      "dn.meld_issue_plan",
      "repository_dispatch",
      {
        action: "dn.prep_issue_plan",
        client_payload: {
          schema_version: "1.0",
          dispatch_id: "dispatch-prep-canonical",
          issue_number: 42,
        },
      },
      "opencode",
    ),
    [
      "--agent",
      "opencode",
      "meld",
      "--yes",
      "--target",
      "github:issue:42",
      "42",
    ],
  );
});

Deno.test(
  "resolveWorkflowArguments auto-approves unattended GitHub meld targets",
  () => {
    const args = resolveWorkflowArguments(
      "dn.meld_issue_plan",
      "repository_dispatch",
      {
        action: "dn.meld_issue_plan",
        client_payload: {
          schema_version: "1.0",
          dispatch_id: "dispatch-unattended-yes",
          issue_number: 7,
        },
      },
      "cursor",
    );
    assertEquals(args.includes("--yes"), true);
    assertEquals(args.includes("--target"), true);
    assertEquals(args[args.indexOf("--target") + 1], "github:issue:7");
  },
);

Deno.test("resolveWorkflowArguments rejects canonical direct publishing", () => {
  assertThrows(
    () =>
      resolveWorkflowArguments(
        "dn.kickstart_issue",
        "repository_dispatch",
        {
          action: "dn.kickstart_issue",
          client_payload: {
            schema_version: "1.0",
            dispatch_id: "dispatch-2b",
            issue_number: 42,
            publish: "direct",
          },
        },
        "cursor",
      ),
    Error,
    "client_payload.publish must be pr",
  );
});

Deno.test("resolveWorkflowArguments rejects canonical none publishing", () => {
  assertThrows(
    () =>
      resolveWorkflowArguments(
        "dn.kickstart_issue",
        "repository_dispatch",
        {
          action: "dn.kickstart_issue",
          client_payload: {
            schema_version: "1.0",
            dispatch_id: "dispatch-3",
            issue_number: 42,
            publish: "none",
          },
        },
        "opencode",
      ),
    Error,
    "client_payload.publish must be pr",
  );
});

Deno.test("resolveWorkflowArguments uses scheduled milestone environment", () => {
  assertEquals(
    resolveWorkflowArguments(
      "dn.daily_kickstart",
      "schedule",
      {},
      "codex",
      { DN_DAILY_KICKSTART_MILESTONE: "7" },
    ),
    [
      "--agent",
      "codex",
      "kickstart",
      "--publish",
      "pr",
      "--milestone",
      "7",
      "--once",
    ],
  );
});

Deno.test("resolveDailyKickstartMilestone reads input and env", () => {
  assertEquals(
    resolveDailyKickstartMilestone({ inputs: { milestone: "9" } }),
    "9",
  );
  assertEquals(
    resolveDailyKickstartMilestone({}, { DN_DAILY_KICKSTART_MILESTONE: "3" }),
    "3",
  );
  assertEquals(resolveDailyKickstartMilestone({}, {}), undefined);
  assertEquals(
    resolveDailyKickstartMilestone({}, { DN_DAILY_KICKSTART_MILESTONE: "  " }),
    undefined,
  );
});

Deno.test("evaluateDailyKickstartReadiness soft-skips without milestone", async () => {
  const result = await evaluateDailyKickstartReadiness(
    "/tmp",
    "acme",
    "widgets",
    undefined,
  );
  assertEquals(result.kind, "skip");
  if (result.kind === "skip") {
    assertEquals(
      result.reason.includes("DN_DAILY_KICKSTART_MILESTONE"),
      true,
    );
  }
});

Deno.test("evaluateDailyKickstartReadiness soft-skips missing stack", async () => {
  const workspace = await Deno.makeTempDir({ prefix: "dn-daily-skip-" });
  try {
    const result = await evaluateDailyKickstartReadiness(
      workspace,
      "acme",
      "widgets",
      "42",
    );
    assertEquals(result.kind, "skip");
    if (result.kind === "skip") {
      assertEquals(result.reason.includes("stack file missing"), true);
    }
  } finally {
    await Deno.remove(workspace, { recursive: true });
  }
});

Deno.test("evaluateDailyKickstartReadiness soft-skips empty queue", async () => {
  const workspace = await Deno.makeTempDir({ prefix: "dn-daily-empty-" });
  try {
    const plansDir = join(workspace, "plans");
    await Deno.mkdir(plansDir, { recursive: true });
    const stackPath = join(plansDir, "acme_widgets_7.stack.md");
    await Deno.writeTextFile(
      stackPath,
      [
        "---",
        "milestone: 7",
        "---",
        "",
        "- [x] https://github.com/acme/widgets/issues/1 done",
        "",
      ].join("\n"),
    );
    const result = await evaluateDailyKickstartReadiness(
      workspace,
      "acme",
      "widgets",
      "7",
    );
    assertEquals(result.kind, "skip");
    if (result.kind === "skip") {
      assertEquals(result.reason.includes("queue is empty"), true);
    }
  } finally {
    await Deno.remove(workspace, { recursive: true });
  }
});

Deno.test("evaluateDailyKickstartReadiness is ready with unchecked item", async () => {
  const workspace = await Deno.makeTempDir({ prefix: "dn-daily-ready-" });
  try {
    const plansDir = join(workspace, "plans");
    await Deno.mkdir(plansDir, { recursive: true });
    await Deno.writeTextFile(
      join(plansDir, "acme_widgets_7.stack.md"),
      [
        "---",
        "milestone: 7",
        "---",
        "",
        "- [ ] https://github.com/acme/widgets/issues/99 next",
        "",
      ].join("\n"),
    );
    const result = await evaluateDailyKickstartReadiness(
      workspace,
      "acme",
      "widgets",
      "7",
    );
    assertEquals(result, {
      kind: "ready",
      milestone: "7",
      stackPath: join(plansDir, "acme_widgets_7.stack.md"),
      issueNumber: "99",
    });
  } finally {
    await Deno.remove(workspace, { recursive: true });
  }
});

Deno.test("workflow PR matching distinguishes kickstart and automation branches", () => {
  const pulls = [
    {
      html_url: "https://github.com/acme/widgets/pull/10",
      head: { ref: "kickstart/issue_42_fix-widget" },
    },
    {
      html_url: "https://github.com/acme/widgets/pull/11",
      head: { ref: "dn/automation-plans-team-plan-md" },
    },
  ];
  assertEquals(
    openKickstartPullRequestUrl(pulls, "42"),
    "https://github.com/acme/widgets/pull/10",
  );
  assertEquals(openKickstartPullRequestUrl(pulls, "4"), undefined);
  assertEquals(
    openAutomationPullRequestUrl(
      pulls,
      "dn/automation-plans-team-plan-md",
    ),
    "https://github.com/acme/widgets/pull/11",
  );
});

Deno.test("renderWorkflowSummary highlights and escapes validation failures", () => {
  const summary = renderWorkflowSummary({
    workflowId: "dn.kickstart_issue",
    eventName: "repository_dispatch",
    status: "failed",
    checks: [{
      name: "Payload",
      status: "failed",
      message: "bad | value\nsecond line",
    }],
    error: { code: "invalid_payload", message: "invalid" },
  });
  assertEquals(summary.includes("❌ dn workflow"), true);
  assertEquals(summary.includes("bad \\| value second line"), true);
  assertEquals(summary.includes("### Failure"), true);
});
