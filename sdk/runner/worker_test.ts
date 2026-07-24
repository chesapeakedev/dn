// Copyright 2026 Chesapeake Computing
// SPDX-License-Identifier: Apache-2.0

import { assert, assertEquals } from "@std/assert";
import type {
  RunnerHeartbeat,
  RunnerJob,
  RunnerJobCompletion,
  RunnerJobFailure,
  RunnerLeaseResponse,
  RunnerProgressEvent,
} from "./types.ts";
import {
  buildRunnerKickstartCommand,
  parseRunnerProgressLine,
  type RunnerChildProcess,
  type RunnerWorkerClient,
  runRunnerJob,
} from "./worker.ts";

function job(): RunnerJob {
  return {
    protocol_version: "1.0",
    id: "job-1",
    invocation_id: "invocation-1",
    runner_id: "runner-1",
    repository: "chesapeakedev/dn",
    operation: {
      type: "kickstart",
      issue_url: "https://github.com/chesapeakedev/dn/issues/213",
      publish: "pr",
      agent: "codex",
    },
    created_at: "2026-07-23T12:00:00.000Z",
    queued_until: "2026-07-24T12:00:00.000Z",
    lease: {
      id: "lease-1",
      expires_at: "2026-07-23T12:01:00.000Z",
      cancel_requested: false,
    },
  };
}

class RecordingClient implements RunnerWorkerClient {
  progress: RunnerProgressEvent[] = [];
  completion: RunnerJobCompletion | null = null;
  failure: RunnerJobFailure | null = null;
  cancelOnRenewal = false;

  heartbeat(_heartbeat: RunnerHeartbeat): Promise<void> {
    return Promise.resolve();
  }
  claimJob(): Promise<{ job: RunnerJob | null }> {
    return Promise.resolve({ job: null });
  }
  renewLease(): Promise<RunnerLeaseResponse> {
    return Promise.resolve({
      lease: {
        id: "lease-1",
        expires_at: "2026-07-23T12:02:00.000Z",
        cancel_requested: this.cancelOnRenewal,
      },
    });
  }
  sendProgress(
    _jobId: string,
    event: RunnerProgressEvent,
  ): Promise<void> {
    this.progress.push(event);
    return Promise.resolve();
  }
  completeJob(
    _jobId: string,
    completion: RunnerJobCompletion,
  ): Promise<void> {
    this.completion = completion;
    return Promise.resolve();
  }
  failJob(_jobId: string, failure: RunnerJobFailure): Promise<void> {
    this.failure = failure;
    return Promise.resolve();
  }
}

function stream(text: string): ReadableStream<Uint8Array> {
  return new Blob([text]).stream();
}

Deno.test("buildRunnerKickstartCommand constructs exact typed argv", () => {
  assertEquals(
    buildRunnerKickstartCommand(job(), ["/usr/local/bin/dn"]),
    [
      "/usr/local/bin/dn",
      "--unattended",
      "--agent",
      "codex",
      "kickstart",
      "--publish",
      "pr",
      "https://github.com/chesapeakedev/dn/issues/213",
    ],
  );
});

Deno.test("parseRunnerProgressLine validates invocation correlation", () => {
  const line = JSON.stringify({
    schema_version: "1.0",
    invocation_id: "invocation-1",
    seq: 1,
    ts: "2026-07-23T12:00:00.000Z",
    type: "invocation.running",
    message: "Running",
  });
  assertEquals(
    parseRunnerProgressLine(line, "invocation-1")?.type,
    "invocation.running",
  );
  assertEquals(parseRunnerProgressLine(line, "another-invocation"), null);
  assertEquals(parseRunnerProgressLine("not json", "invocation-1"), null);
  assertEquals(
    parseRunnerProgressLine("x".repeat(32 * 1024 + 1), "invocation-1"),
    null,
  );
});

Deno.test("runRunnerJob forwards NDJSON progress and completion receipt", async () => {
  const client = new RecordingClient();
  let spawnedCommand: string[] = [];
  let spawnedEnv: Record<string, string> = {};
  await runRunnerJob(job(), {
    runnerId: "runner-1",
    commandPrefix: ["/usr/local/bin/dn"],
    config: {
      schema_version: "1.0",
      paused: false,
      repositories: {
        "chesapeakedev/dn": {
          path: "/workspace/dn",
          trusted_at: "2026-07-23T12:00:00.000Z",
        },
      },
    },
    client,
    spawn(command, _cwd, env) {
      spawnedCommand = command;
      spawnedEnv = env;
      const event = JSON.stringify({
        schema_version: "1.0",
        invocation_id: "invocation-1",
        seq: 1,
        ts: "2026-07-23T12:00:00.000Z",
        type: "publish.completed",
        message: "Published",
        data: { pr_url: "https://github.com/chesapeakedev/dn/pull/214" },
      });
      return {
        stdout: stream("done\n"),
        stderr: stream(`${event}\n`),
        status: Promise.resolve({ success: true, code: 0, signal: null }),
        kill() {},
      };
    },
  });
  assertEquals(spawnedCommand[4], "kickstart");
  assertEquals(spawnedEnv.DN_PROGRESS, "ndjson");
  assertEquals(client.progress.length, 1);
  assertEquals(
    client.completion?.pr_url,
    "https://github.com/chesapeakedev/dn/pull/214",
  );
  assertEquals(client.completion?.hosted_runs_avoided, 1);
});

Deno.test("runRunnerJob terminates on cancellation and does not complete", async () => {
  const client = new RecordingClient();
  client.cancelOnRenewal = true;
  let resolveStatus: (status: Deno.CommandStatus) => void = () => {};
  const status = new Promise<Deno.CommandStatus>((resolvePromise) => {
    resolveStatus = resolvePromise;
  });
  const signals: Deno.Signal[] = [];
  const process: RunnerChildProcess = {
    stdout: stream(""),
    stderr: stream(""),
    status,
    kill(signal) {
      signals.push(signal);
      resolveStatus({ success: false, code: 143, signal: "SIGTERM" });
    },
  };
  await runRunnerJob(job(), {
    runnerId: "runner-1",
    commandPrefix: ["/usr/local/bin/dn"],
    config: {
      schema_version: "1.0",
      paused: false,
      repositories: {
        "chesapeakedev/dn": {
          path: "/workspace/dn",
          trusted_at: "2026-07-23T12:00:00.000Z",
        },
      },
    },
    client,
    spawn: () => process,
    leaseRenewalMs: 1,
    cancellationGraceMs: 1,
  });
  assert(signals.includes("SIGTERM"));
  assertEquals(client.failure?.reason, "cancelled");
  assertEquals(client.completion, null);
});
