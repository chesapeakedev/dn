// Copyright 2026 Chesapeake Computing
// SPDX-License-Identifier: Apache-2.0

import { assertEquals, assertThrows } from "@std/assert";
import { renderWorkflowSummary, resolveWorkflowArguments } from "./exec.ts";

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
    ["--agent", "claude", "init", "stack", "42", "--publish", "direct"],
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
      "direct",
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

Deno.test("resolveWorkflowArguments maps kickstart publish direct", () => {
  assertEquals(
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
    ["--agent", "cursor", "kickstart", "--publish", "direct", "42"],
  );
});

Deno.test("resolveWorkflowArguments rejects invalid publish mode", () => {
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
            publish: "invalid",
          },
        },
        "opencode",
      ),
    Error,
    'Invalid publish mode "invalid"',
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
