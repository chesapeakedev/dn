// Copyright 2026 Chesapeake Computing
// SPDX-License-Identifier: Apache-2.0

import {
  assertEquals,
  assertRejects,
  assertStringIncludes,
  assertThrows,
} from "@std/assert";
import {
  buildCursorCloudKickstartPrompt,
  buildCursorCloudLoopPrompt,
  cursorCloudRepositoryUrlFromIssue,
  type CursorCloudSdk,
  isCursorCloudProgressWaitEnabled,
  parseCursorCloudRef,
  prUrlFromCursorCloudRunResult,
  runCursorCloudAgentTracked,
  startCursorCloudAgent,
} from "./cursorCloudAgent.ts";
import type { ProgressEventInput, ProgressReporter } from "./progress.ts";

function recordingReporter(): {
  reporter: ProgressReporter;
  events: ProgressEventInput[];
} {
  const events: ProgressEventInput[] = [];
  return {
    events,
    reporter: {
      report: (input) => {
        events.push(input);
        return Promise.resolve();
      },
    },
  };
}

Deno.test("Cursor cloud helpers resolve issue repositories and validate refs", () => {
  assertEquals(
    cursorCloudRepositoryUrlFromIssue(
      "https://github.com/example/widgets/issues/12?notification=1",
    ),
    "https://github.com/example/widgets.git",
  );
  assertEquals(cursorCloudRepositoryUrlFromIssue("#12"), null);
  assertEquals(
    parseCursorCloudRef("feature/cloud-dispatch"),
    "feature/cloud-dispatch",
  );
  assertThrows(
    () => parseCursorCloudRef(undefined),
    Error,
    "--ref requires",
  );
  assertThrows(
    () => parseCursorCloudRef("two refs"),
    Error,
    "without whitespace",
  );
});

Deno.test("Cursor cloud prompts preserve kickstart phases and loop plans", () => {
  const kickstartPrompt = buildCursorCloudKickstartPrompt(
    "GitHub issue: https://github.com/example/widgets/issues/12",
    true,
  );
  assertStringIncludes(kickstartPrompt, "Phase 1 — Plan:");
  assertStringIncludes(kickstartPrompt, "Phase 2 — Implement:");
  assertStringIncludes(kickstartPrompt, "do not stop after the planning phase");
  assertStringIncludes(kickstartPrompt, "Create a pull request");

  const loopPrompt = buildCursorCloudLoopPrompt("# Existing plan");
  assertStringIncludes(loopPrompt, "implementation phase of a dn loop task");
  assertStringIncludes(loopPrompt, "# Existing plan");
});

Deno.test("startCursorCloudAgent configures the SDK cloud repository", async () => {
  let receivedPrompt = "";
  let receivedOptions: Parameters<CursorCloudSdk["create"]>[0] | undefined;
  let closed = false;
  const sdk: CursorCloudSdk = {
    create: (options) => {
      receivedOptions = options;
      return Promise.resolve({
        send: (prompt) => {
          receivedPrompt = prompt;
          return Promise.resolve({
            id: "run-123",
            agentId: "agent-456",
            wait: () =>
              Promise.resolve({ id: "run-123", status: "finished" as const }),
          });
        },
        close: () => {
          closed = true;
        },
      });
    },
  };

  const result = await startCursorCloudAgent({
    apiKey: "test-key",
    prompt: "Implement issue #12",
    repository: {
      url: "https://github.com/example/widgets.git",
      startingRef: "feature/cloud-dispatch",
    },
    autoCreatePr: true,
  }, sdk);

  assertEquals(result, { runId: "run-123", agentId: "agent-456" });
  assertEquals(receivedPrompt, "Implement issue #12");
  assertEquals(closed, true);
  assertEquals(receivedOptions, {
    apiKey: "test-key",
    model: { id: "auto" },
    cloud: {
      repos: [{
        url: "https://github.com/example/widgets.git",
        startingRef: "feature/cloud-dispatch",
      }],
      autoCreatePR: true,
    },
  });
});

Deno.test("startCursorCloudAgent requires an API key before creating an agent", async () => {
  const previous = Deno.env.get("CURSOR_API_KEY");
  Deno.env.delete("CURSOR_API_KEY");
  try {
    await assertRejects(
      () =>
        startCursorCloudAgent({
          prompt: "Implement issue #12",
          repository: {
            url: "https://github.com/example/widgets.git",
            startingRef: "main",
          },
          autoCreatePr: false,
        }, {
          create: () => Promise.reject(new Error("SDK must not be called")),
        }),
      Error,
      "CURSOR_API_KEY is required",
    );
  } finally {
    if (previous === undefined) Deno.env.delete("CURSOR_API_KEY");
    else Deno.env.set("CURSOR_API_KEY", previous);
  }
});

Deno.test("isCursorCloudProgressWaitEnabled requires dispatch id and progress mode", () => {
  assertEquals(isCursorCloudProgressWaitEnabled({}), false);
  assertEquals(
    isCursorCloudProgressWaitEnabled({
      DN_DISPATCH_ID: "inv-1",
      DN_PROGRESS: "ndjson",
    }),
    true,
  );
  assertEquals(
    isCursorCloudProgressWaitEnabled({
      DN_DISPATCH_ID: "inv-1",
      DN_PROGRESS: "http",
      DN_PROGRESS_URL: "https://example.test/events",
      DN_PROGRESS_TOKEN: "token",
    }),
    true,
  );
  assertEquals(
    isCursorCloudProgressWaitEnabled({
      DN_DISPATCH_ID: "inv-1",
      DN_PROGRESS: "http",
    }),
    false,
  );
});

Deno.test("prUrlFromCursorCloudRunResult reads the first branch PR URL", () => {
  assertEquals(
    prUrlFromCursorCloudRunResult({
      id: "run-1",
      status: "finished",
      git: {
        branches: [{
          repoUrl: "https://github.com/example/widgets.git",
          prUrl: "https://github.com/example/widgets/pull/9",
        }],
      },
    }),
    "https://github.com/example/widgets/pull/9",
  );
  assertEquals(
    prUrlFromCursorCloudRunResult({ id: "run-1", status: "finished" }),
    undefined,
  );
});

Deno.test("runCursorCloudAgentTracked fire-and-forget skips wait without progress env", async () => {
  let waited = false;
  const sdk: CursorCloudSdk = {
    create: () =>
      Promise.resolve({
        send: () =>
          Promise.resolve({
            id: "run-1",
            agentId: "bc-1",
            wait: () => {
              waited = true;
              return Promise.resolve({
                id: "run-1",
                status: "finished" as const,
              });
            },
          }),
      }),
  };
  const { events, reporter } = recordingReporter();
  const result = await runCursorCloudAgentTracked(
    {
      apiKey: "test-key",
      prompt: "do the work",
      repository: {
        url: "https://github.com/example/widgets.git",
        startingRef: "main",
      },
      autoCreatePr: true,
    },
    sdk,
    {},
    reporter,
  );

  assertEquals(result, {
    runId: "run-1",
    agentId: "bc-1",
    waited: false,
  });
  assertEquals(waited, false);
  assertEquals(events, []);
});

Deno.test("runCursorCloudAgentTracked waits and emits progress when configured", async () => {
  const sdk: CursorCloudSdk = {
    create: () =>
      Promise.resolve({
        send: () =>
          Promise.resolve({
            id: "run-9",
            agentId: "bc-9",
            wait: () =>
              Promise.resolve({
                id: "run-9",
                status: "finished" as const,
                git: {
                  branches: [{
                    repoUrl: "https://github.com/example/widgets.git",
                    prUrl: "https://github.com/example/widgets/pull/42",
                  }],
                },
              }),
          }),
      }),
  };
  const { events, reporter } = recordingReporter();
  const result = await runCursorCloudAgentTracked(
    {
      apiKey: "test-key",
      prompt: "do the work",
      repository: {
        url: "https://github.com/example/widgets.git",
        startingRef: "main",
      },
      autoCreatePr: true,
    },
    sdk,
    {
      DN_DISPATCH_ID: "inv-9",
      DN_PROGRESS: "ndjson",
    },
    reporter,
  );

  assertEquals(result, {
    runId: "run-9",
    agentId: "bc-9",
    waited: true,
    status: "finished",
    prUrl: "https://github.com/example/widgets/pull/42",
  });
  assertEquals(
    events.map((event) => event.type),
    [
      "invocation.queued",
      "invocation.running",
      "phase.started",
      "step.started",
      "step.completed",
      "phase.completed",
      "publish.completed",
      "invocation.succeeded",
    ],
  );
  assertEquals(
    events.at(-2)?.data?.pr_url,
    "https://github.com/example/widgets/pull/42",
  );
});

Deno.test("runCursorCloudAgentTracked reports failure for errored cloud runs", async () => {
  const sdk: CursorCloudSdk = {
    create: () =>
      Promise.resolve({
        send: () =>
          Promise.resolve({
            id: "run-err",
            agentId: "bc-err",
            wait: () =>
              Promise.resolve({
                id: "run-err",
                status: "error" as const,
                error: { message: "tool failed" },
              }),
          }),
      }),
  };
  const { events, reporter } = recordingReporter();
  await assertRejects(
    () =>
      runCursorCloudAgentTracked(
        {
          apiKey: "test-key",
          prompt: "do the work",
          repository: {
            url: "https://github.com/example/widgets.git",
            startingRef: "main",
          },
          autoCreatePr: false,
        },
        sdk,
        {
          DN_DISPATCH_ID: "inv-err",
          DN_PROGRESS: "ndjson",
        },
        reporter,
      ),
    Error,
    "tool failed",
  );
  assertEquals(events.at(-1)?.type, "invocation.failed");
  assertEquals(
    events.filter((event) => event.type === "invocation.failed").length,
    1,
  );
});
