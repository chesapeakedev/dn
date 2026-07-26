// Copyright 2026 Chesapeake Computing
// SPDX-License-Identifier: Apache-2.0

import { assertEquals, assertThrows } from "@std/assert";
import {
  applyProgressEnvFromClientPayload,
  openAutomationPullRequestUrl,
  openKickstartPullRequestUrl,
  renderWorkflowSummary,
  resolveWorkflowArguments,
  todoLoopBranchName,
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
      "--target",
      "github:issue:42",
      "42",
    ],
  );
});

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

Deno.test("resolveWorkflowArguments maps todo loop workflow dispatch input", () => {
  assertEquals(
    resolveWorkflowArguments(
      "dn.todo_loop",
      "workflow_dispatch",
      { inputs: { plan_file: "plans/team.plan.md" } },
      "opencode",
    ),
    ["--agent", "opencode", "loop", "plans/team.plan.md"],
  );
});

Deno.test("resolveWorkflowArguments uses default todo loop plan path", () => {
  assertEquals(
    resolveWorkflowArguments(
      "dn.todo_loop",
      "schedule",
      {},
      "codex",
    ),
    ["--agent", "codex", "loop", "plans/todo.plan.md"],
  );
});

Deno.test("resolveWorkflowArguments maps todo loop repository dispatch", () => {
  assertEquals(
    resolveWorkflowArguments(
      "dn.todo_loop",
      "repository_dispatch",
      {
        action: "dn.todo_loop",
        client_payload: {
          schema_version: "1.0",
          dispatch_id: "loop-1",
          plan_file: "plans/custom.plan.md",
        },
      },
      "opencode",
    ),
    ["--agent", "opencode", "loop", "plans/custom.plan.md"],
  );
});

Deno.test("todo loop uses a stable plan-specific automation branch", () => {
  assertEquals(
    todoLoopBranchName("plans/Team Queue.plan.md"),
    "dn/todo-loop-plans-team-queue-plan-md",
  );
});

Deno.test("workflow PR matching distinguishes kickstart and recurring branches", () => {
  const pulls = [
    {
      html_url: "https://github.com/acme/widgets/pull/10",
      head: { ref: "kickstart/issue_42_fix-widget" },
    },
    {
      html_url: "https://github.com/acme/widgets/pull/11",
      head: { ref: "dn/todo-loop-plans-team-plan-md" },
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
      "dn/todo-loop-plans-team-plan-md",
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
