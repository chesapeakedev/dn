// Copyright 2026 Chesapeake Computing
// SPDX-License-Identifier: Apache-2.0

import { assertEquals, assertInstanceOf } from "@std/assert";
import {
  createProgressReporter,
  HttpReporter,
  NdjsonReporter,
  NullReporter,
  redactAgentOutput,
  streamAgentOutput,
} from "./progress.ts";
import type { ProgressEventInput, ProgressReporter } from "./progress.ts";

class RecordingReporter implements ProgressReporter {
  readonly events: ProgressEventInput[] = [];

  report(input: ProgressEventInput): Promise<void> {
    this.events.push(input);
    return Promise.resolve();
  }
}

Deno.test("NdjsonReporter emits versioned events with increasing sequence", async () => {
  const lines: string[] = [];
  const originalError = console.error;
  console.error = (value: unknown) => lines.push(String(value));
  try {
    const reporter = new NdjsonReporter("dispatch-123");
    await reporter.report({ type: "step.started", step: 3, message: "Plan" });
    await reporter.report({
      type: "phase.completed",
      phase: "plan",
      step: 3,
      message: "Plan complete",
    });
  } finally {
    console.error = originalError;
  }

  const events = lines.map((line) =>
    JSON.parse(line) as Record<string, unknown>
  );
  assertEquals(events.map((event) => event.schema_version), ["1.0", "1.0"]);
  assertEquals(events.map((event) => event.invocation_id), [
    "dispatch-123",
    "dispatch-123",
  ]);
  assertEquals(events.map((event) => event.seq), [1, 2]);
  assertEquals(events[0].step, 3);
  assertEquals(events[1].phase, "plan");
});

Deno.test("HttpReporter posts events with bearer authentication", async () => {
  const requests: Request[] = [];
  const reporter = new HttpReporter(
    "dispatch-456",
    "https://denoise.example/progress",
    "progress-token",
    (input, init) => {
      requests.push(new Request(input, init));
      return Promise.resolve(new Response(null, { status: 202 }));
    },
  );

  await reporter.report({ type: "invocation.running", message: "Running" });

  assertEquals(requests.length, 1);
  assertEquals(
    requests[0].headers.get("Authorization"),
    "Bearer progress-token",
  );
  const event = await requests[0].json() as Record<string, unknown>;
  assertEquals(event.schema_version, "1.0");
  assertEquals(event.invocation_id, "dispatch-456");
  assertEquals(event.seq, 1);
  assertEquals(event.type, "invocation.running");
  assertEquals(event.message, "Running");
  assertEquals(typeof event.ts, "string");
});

Deno.test("createProgressReporter requires dispatch id and complete HTTP configuration", () => {
  assertInstanceOf(
    createProgressReporter({ DN_PROGRESS: "ndjson" }),
    NullReporter,
  );
  assertInstanceOf(
    createProgressReporter({
      DN_DISPATCH_ID: "dispatch",
      DN_PROGRESS: "ndjson",
    }),
    NdjsonReporter,
  );
  assertInstanceOf(
    createProgressReporter({
      DN_DISPATCH_ID: "dispatch",
      DN_PROGRESS: "http",
      DN_PROGRESS_URL: "https://denoise.example/progress",
    }),
    NullReporter,
  );
});

Deno.test("streamAgentOutput preserves output and reports redacted complete lines", async () => {
  const reporter = new RecordingReporter();
  const written: string[] = [];
  const input = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(
        new TextEncoder().encode("first\nTOKEN=super-secret"),
      );
      controller.enqueue(new TextEncoder().encode("-value\nlast"));
      controller.close();
    },
  });

  const output = await streamAgentOutput(input, reporter, {
    phase: "plan",
    stream: "stderr",
    verbose: true,
    write: (chunk) => {
      written.push(new TextDecoder().decode(chunk));
      return Promise.resolve();
    },
  });

  assertEquals(output, "first\nTOKEN=super-secret-value\nlast");
  assertEquals(written.join(""), output);
  assertEquals(reporter.events, [
    {
      type: "agent.line",
      phase: "plan",
      message: "first",
      data: { stream: "stderr" },
    },
    {
      type: "agent.line",
      phase: "plan",
      message: "TOKEN=[REDACTED]",
      data: { stream: "stderr" },
    },
    {
      type: "agent.line",
      phase: "plan",
      message: "last",
      data: { stream: "stderr" },
    },
  ]);
});

Deno.test("streamAgentOutput suppresses lines unless verbose", async () => {
  const reporter = new RecordingReporter();
  await streamAgentOutput(new Blob(["quiet\n"]).stream(), reporter, {
    phase: "implement",
    stream: "stdout",
    verbose: false,
  });
  assertEquals(reporter.events, []);
});

Deno.test("redactAgentOutput removes known API-key and bearer-token formats", () => {
  assertEquals(
    redactAgentOutput("key=sk-proj-abcdefghijk Bearer abcdefghijkl"),
    "key=[REDACTED] Bearer [REDACTED]",
  );
});
