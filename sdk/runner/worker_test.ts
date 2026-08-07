// Copyright 2026 Chesapeake Computing
// SPDX-License-Identifier: Apache-2.0

import { assert, assertEquals } from "@std/assert";
import type {
  DenoiseTaskDocument,
  RunnerHeartbeat,
  RunnerJob,
  RunnerJobCompletion,
  RunnerJobFailure,
  RunnerLeaseResponse,
  RunnerProgressEvent,
} from "./types.ts";
import {
  buildRunnerDenoiseTaskCommand,
  buildRunnerKickstartCommand,
  formatRunnerServeLog,
  parseRunnerProgressLine,
  type RunnerChildProcess,
  type RunnerWorkerClient,
  runRunnerJob,
  serveRunner,
} from "./worker.ts";
import {
  getRunnerConfigPaths,
  RUNNER_CONFIG_SCHEMA_VERSION,
  saveRunnerConfig,
} from "./config.ts";

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

Deno.test("buildRunnerKickstartCommand constructs exact typed argv", async () => {
  const { argv } = await buildRunnerKickstartCommand(job(), [
    "/usr/local/bin/dn",
  ]);
  assertEquals(argv, [
    "/usr/local/bin/dn",
    "--unattended",
    "--agent",
    "codex",
    "kickstart",
    "--publish",
    "pr",
    "https://github.com/chesapeakedev/dn/issues/213",
  ]);
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

function denoiseTaskDoc(): DenoiseTaskDocument {
  return {
    schema_version: "1.0",
    id: "task-denoise-1",
    title: "Denoise test task",
    body: "Test body content.",
    status: "open",
    updated_at: "2026-07-23T12:00:00.000Z",
    repo_hint: "chesapeakedev/dn",
    created_at: "2026-07-23T12:00:00.000Z",
  };
}

function denoiseTaskJob(): RunnerJob {
  return {
    protocol_version: "1.0",
    id: "job-denoise-1",
    invocation_id: "invocation-denoise-1",
    runner_id: "runner-1",
    repository: "chesapeakedev/dn",
    operation: {
      type: "denoise-task",
      task_document: denoiseTaskDoc(),
      publish: "none",
      agent: "codex",
    },
    created_at: "2026-07-23T12:00:00.000Z",
    queued_until: "2026-07-24T12:00:00.000Z",
    lease: {
      id: "lease-denoise-1",
      expires_at: "2026-07-23T12:01:00.000Z",
      cancel_requested: false,
    },
  };
}

Deno.test("buildRunnerKickstartCommand dispatches denoise-task to temp file", async () => {
  const { argv, cleanup } = await buildRunnerKickstartCommand(
    denoiseTaskJob(),
    ["/usr/local/bin/dn"],
  );
  try {
    assertEquals(argv[0], "/usr/local/bin/dn");
    assertEquals(argv[1], "--unattended");
    assertEquals(argv[2], "--agent");
    assertEquals(argv[3], "codex");
    assertEquals(argv[4], "kickstart");
    assertEquals(argv[5], "--publish");
    assertEquals(argv[6], "none");
    assert(argv[7].endsWith(".md"), `Expected .md file, got ${argv[7]}`);
    // Verify the materialized content
    const content = await Deno.readTextFile(argv[7]);
    assert(content.startsWith("# Denoise test task"));
    assert(content.includes("Test body content."));
  } finally {
    if (cleanup) await cleanup();
  }
});

Deno.test("buildRunnerDenoiseTaskCommand creates temp file and cleanup", async () => {
  const { argv, cleanup } = await buildRunnerDenoiseTaskCommand(
    denoiseTaskJob(),
    ["/usr/local/bin/dn"],
  );
  // Verify the temp file exists before cleanup
  const fileExists = await Deno.stat(argv[7]).then(() => true).catch(() =>
    false
  );
  assert(fileExists, "Temp file should exist before cleanup");
  await cleanup();
  const fileExistsAfter = await Deno.stat(argv[7]).then(() => true).catch(() =>
    false
  );
  assertEquals(
    fileExistsAfter,
    false,
    "Temp file should be removed after cleanup",
  );
});

Deno.test("formatRunnerServeLog prefixes an ISO-8601 timestamp", () => {
  assertEquals(
    formatRunnerServeLog(
      "No work available; waiting for jobs",
      new Date("2026-08-07T19:55:00.000Z"),
    ),
    "[2026-08-07T19:55:00.000Z] No work available; waiting for jobs",
  );
});

Deno.test("serveRunner logs ready and idle status when no job is claimed", async () => {
  const directory = await Deno.makeTempDir({ prefix: "dn-runner-serve-" });
  const previousHome = Deno.env.get("DN_RUNNER_HOME");
  Deno.env.set("DN_RUNNER_HOME", directory);
  const logs: string[] = [];
  const client = new RecordingClient();
  try {
    await saveRunnerConfig({
      schema_version: RUNNER_CONFIG_SCHEMA_VERSION,
      paused: false,
      repositories: {},
    }, getRunnerConfigPaths(directory));
    await serveRunner({
      runnerId: "runner-1",
      dnVersion: "0.0.0-test",
      commandPrefix: ["/usr/local/bin/dn"],
      client,
      once: true,
      log: (line) => logs.push(line),
      now: () => new Date("2026-08-07T19:55:00.000Z"),
    });
    assertEquals(logs, [
      "[2026-08-07T19:55:00.000Z] Runner ready; accepting work as runner-1",
      "[2026-08-07T19:55:00.000Z] No work available; waiting for jobs",
    ]);
  } finally {
    if (previousHome === undefined) Deno.env.delete("DN_RUNNER_HOME");
    else Deno.env.set("DN_RUNNER_HOME", previousHome);
    await Deno.remove(directory, { recursive: true });
  }
});

Deno.test("serveRunner waits between empty claims", async () => {
  const directory = await Deno.makeTempDir({ prefix: "dn-runner-idle-" });
  const previousHome = Deno.env.get("DN_RUNNER_HOME");
  Deno.env.set("DN_RUNNER_HOME", directory);
  const client = new RecordingClient();
  let claims = 0;
  const originalClaim = client.claimJob.bind(client);
  client.claimJob = async () => {
    claims += 1;
    return await originalClaim();
  };
  const controller = new AbortController();
  try {
    await saveRunnerConfig({
      schema_version: RUNNER_CONFIG_SCHEMA_VERSION,
      paused: false,
      repositories: {},
    }, getRunnerConfigPaths(directory));
    const started = Date.now();
    const serving = serveRunner({
      runnerId: "runner-1",
      dnVersion: "0.0.0-test",
      commandPrefix: ["/usr/local/bin/dn"],
      client,
      signal: controller.signal,
      idleWaitMs: 80,
      log: () => {},
    });
    const deadline = Date.now() + 5_000;
    while (claims < 2 && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    controller.abort();
    await serving;
    const elapsed = Date.now() - started;
    assert(claims >= 2, `expected at least 2 claims, got ${claims}`);
    assert(
      elapsed >= 80,
      `expected idle backoff before second claim, elapsed ${elapsed}ms`,
    );
    assert(claims <= 8, `idle wait too short: ${claims} claims in ${elapsed}ms`);
  } finally {
    controller.abort();
    if (previousHome === undefined) Deno.env.delete("DN_RUNNER_HOME");
    else Deno.env.set("DN_RUNNER_HOME", previousHome);
    await Deno.remove(directory, { recursive: true });
  }
});
