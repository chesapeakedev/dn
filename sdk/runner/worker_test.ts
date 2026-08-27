// Copyright 2026 Chesapeake Computing
// SPDX-License-Identifier: Apache-2.0

import { assert, assertEquals, assertRejects } from "@std/assert";
import type {
  DenoiseTaskDocument,
  RunnerHeartbeat,
  RunnerHeartbeatResponse,
  RunnerJob,
  RunnerJobCompletion,
  RunnerJobFailure,
  RunnerLeaseResponse,
  RunnerProgressEvent,
} from "./types.ts";
import {
  buildRunnerDenoiseTaskCommand,
  buildRunnerKickstartCommand,
  formatRunnerJobClaimLog,
  formatRunnerJobFailureMessage,
  formatRunnerJobOutcomeLog,
  formatRunnerProgressLog,
  formatRunnerReadyLog,
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
import { detectRunnerCapabilities } from "./doctor.ts";

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

  heartbeat(_heartbeat: RunnerHeartbeat): Promise<RunnerHeartbeatResponse> {
    return Promise.resolve({
      pending_task_ops: [],
      list_tasks_requested: false,
    });
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
  uploadedPlan: { path: string; markdown: string } | null = null;
  uploadPlan(
    _jobId: string,
    input: { path: string; markdown: string },
  ): Promise<void> {
    this.uploadedPlan = input;
    return Promise.resolve();
  }
}

function localConfig(path = "/workspace/dn") {
  return {
    schema_version: "1.0" as const,
    paused: false,
    repositories: {
      "chesapeakedev/dn": {
        path,
        trusted_at: "2026-07-23T12:00:00.000Z",
      },
    },
  };
}

function progressEvent(
  type: RunnerProgressEvent["type"],
  message: string,
  extra: Partial<RunnerProgressEvent> = {},
): string {
  return JSON.stringify({
    schema_version: "1.0",
    invocation_id: "invocation-1",
    seq: extra.seq ?? 1,
    ts: "2026-07-23T12:00:00.000Z",
    type,
    message,
    ...extra,
  });
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
    "--sandbox",
    "none",
    "--publish",
    "pr",
    "https://github.com/chesapeakedev/dn/issues/213",
  ]);
});

Deno.test("buildRunnerKickstartCommand passes --allow-cross-repo when issue repo differs", async () => {
  const crossRepoJob = job();
  crossRepoJob.repository = "chesapeakedev/other";
  const { argv } = await buildRunnerKickstartCommand(crossRepoJob, [
    "/usr/local/bin/dn",
  ]);
  assertEquals(argv, [
    "/usr/local/bin/dn",
    "--unattended",
    "--agent",
    "codex",
    "kickstart",
    "--sandbox",
    "none",
    "--publish",
    "pr",
    "--allow-cross-repo",
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
  assertEquals(spawnedCommand[5], "--sandbox");
  assertEquals(spawnedCommand[6], "none");
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

Deno.test("buildRunnerKickstartCommand constructs land argv without --single", async () => {
  const land = job();
  land.operation = {
    type: "land",
    issue_url: "https://github.com/chesapeakedev/dn/issues/213",
    agent: "cursor",
  };
  const { argv } = await buildRunnerKickstartCommand(land, [
    "/usr/local/bin/dn",
  ]);
  assertEquals(argv, [
    "/usr/local/bin/dn",
    "--unattended",
    "--agent",
    "cursor",
    "land",
  ]);
});

Deno.test("buildRunnerKickstartCommand constructs sync argv without skip-preflight", async () => {
  const sync = job();
  sync.operation = {
    type: "sync",
    issue_url: "https://github.com/chesapeakedev/dn/issues/213",
  };
  const { argv } = await buildRunnerKickstartCommand(sync, [
    "/usr/local/bin/dn",
  ]);
  assertEquals(argv, [
    "/usr/local/bin/dn",
    "--unattended",
    "sync",
  ]);
  assertEquals(argv.includes("--skip-preflight"), false);
});

Deno.test("buildRunnerKickstartCommand appends a repo-relative land plan file", async () => {
  const land = job();
  land.operation = {
    type: "land",
    issue_url: "https://github.com/chesapeakedev/dn/issues/213",
    agent: "codex",
    plan_file: "plans/foo.plan.md",
  };
  const { argv } = await buildRunnerKickstartCommand(land, [
    "/usr/local/bin/dn",
  ]);
  assertEquals(argv, [
    "/usr/local/bin/dn",
    "--unattended",
    "--agent",
    "codex",
    "land",
    "plans/foo.plan.md",
  ]);
});

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
    assertEquals(argv[5], "--sandbox");
    assertEquals(argv[6], "none");
    assertEquals(argv[7], "--publish");
    assertEquals(argv[8], "none");
    assert(argv[9].endsWith(".md"), `Expected .md file, got ${argv[9]}`);
    // Verify the materialized content
    const content = await Deno.readTextFile(argv[9]);
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
  const mdPath = argv[9];
  // Verify the temp file exists before cleanup
  const fileExists = await Deno.stat(mdPath).then(() => true).catch(() =>
    false
  );
  assert(fileExists, "Temp file should exist before cleanup");
  await cleanup();
  const fileExistsAfter = await Deno.stat(mdPath).then(() => true).catch(() =>
    false
  );
  assertEquals(
    fileExistsAfter,
    false,
    "Temp file should be removed after cleanup",
  );
});

Deno.test("formatRunnerJobFailureMessage prefers invocation.failed detail", () => {
  assertEquals(
    formatRunnerJobFailureMessage(1, {
      invocationFailedMessage:
        "exe.dev sandbox kickstart runs require a GitHub issue",
      diagnosticLines: ["ignored stderr"],
    }),
    "dn kickstart exited with code 1. exe.dev sandbox kickstart runs require a GitHub issue",
  );
});

Deno.test("formatRunnerJobFailureMessage falls back to stderr diagnostics", () => {
  assertEquals(
    formatRunnerJobFailureMessage(2, {
      diagnosticLines: [
        "noise",
        "Error: exe.dev sandbox kickstart runs require a GitHub issue and --publish pr so remote work is persisted on a topic branch.",
      ],
    }),
    "dn kickstart exited with code 2. noise\nError: exe.dev sandbox kickstart runs require a GitHub issue and --publish pr so remote work is persisted on a topic branch.",
  );
});

Deno.test("formatRunnerJobOutcomeLog summarizes terminal results", () => {
  assertEquals(
    formatRunnerJobOutcomeLog("job-1", { kind: "succeeded" }),
    "Job job-1 succeeded",
  );
  assertEquals(
    formatRunnerJobOutcomeLog("job-1", {
      kind: "succeeded",
      durationMs: 724_000,
    }),
    "Job job-1 succeeded (12m 4s)",
  );
  assertEquals(
    formatRunnerJobOutcomeLog("job-1", {
      kind: "succeeded",
      prUrl: "https://github.com/chesapeakedev/dn/pull/214",
    }),
    "Job job-1 succeeded (https://github.com/chesapeakedev/dn/pull/214)",
  );
  assertEquals(
    formatRunnerJobOutcomeLog("job-1", {
      kind: "succeeded",
      prUrl: "https://github.com/chesapeakedev/dn/pull/214",
      durationMs: 724_000,
    }),
    "Job job-1 succeeded (12m 4s, https://github.com/chesapeakedev/dn/pull/214)",
  );
  assertEquals(
    formatRunnerJobOutcomeLog("job-2", {
      kind: "failed",
      message: "dn kickstart exited with code 1. boom",
      durationMs: 5_000,
    }),
    "Job job-2 failed (5s): dn kickstart exited with code 1. boom",
  );
});

Deno.test("runRunnerJob includes stderr reason in failJob message", async () => {
  const client = new RecordingClient();
  const outcome = await runRunnerJob(job(), {
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
    spawn() {
      const failed = JSON.stringify({
        schema_version: "1.0",
        invocation_id: "invocation-1",
        seq: 1,
        ts: "2026-07-23T12:00:00.000Z",
        type: "invocation.failed",
        message:
          "exe.dev sandbox kickstart runs require a GitHub issue and --publish pr",
      });
      return {
        stdout: stream(""),
        stderr: stream(`${failed}\n`),
        status: Promise.resolve({ success: false, code: 1, signal: null }),
        kill() {},
      };
    },
  });
  assertEquals(outcome.kind, "failed");
  assertEquals(
    client.failure?.message,
    "dn kickstart exited with code 1. exe.dev sandbox kickstart runs require a GitHub issue and --publish pr",
  );
  assertEquals(client.failure?.exit_code, 1);
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
    const capabilities = await detectRunnerCapabilities();
    const stamp = new Date("2026-08-07T19:55:00.000Z");
    assertEquals(logs, [
      formatRunnerServeLog(
        formatRunnerReadyLog("runner-1", capabilities, 0),
        stamp,
      ),
      formatRunnerServeLog("No work available; waiting for jobs", stamp),
    ]);
    assertEquals(
      (await Deno.stat(getRunnerConfigPaths(directory).alive)).isFile,
      true,
    );
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
    assert(
      claims <= 8,
      `idle wait too short: ${claims} claims in ${elapsed}ms`,
    );
  } finally {
    controller.abort();
    if (previousHome === undefined) Deno.env.delete("DN_RUNNER_HOME");
    else Deno.env.set("DN_RUNNER_HOME", previousHome);
    await Deno.remove(directory, { recursive: true });
  }
});

Deno.test("formatRunnerJobClaimLog summarizes operation details", () => {
  assertEquals(
    formatRunnerJobClaimLog(job()),
    "Claimed job job-1 (kickstart, codex, publish=pr) chesapeakedev/dn#213",
  );
  const land = job();
  land.id = "job-land";
  land.operation = {
    type: "land",
    issue_url: "https://github.com/chesapeakedev/dn/issues/213",
    agent: "cursor",
    plan_file: "plans/foo.plan.md",
  };
  assertEquals(
    formatRunnerJobClaimLog(land),
    "Claimed job job-land (land, cursor) chesapeakedev/dn#213 plans/foo.plan.md",
  );
  const sync = job();
  sync.id = "job-sync";
  sync.operation = {
    type: "sync",
    issue_url: "https://github.com/chesapeakedev/dn/issues/213",
  };
  assertEquals(
    formatRunnerJobClaimLog(sync),
    "Claimed job job-sync (sync) chesapeakedev/dn#213",
  );
  assertEquals(
    formatRunnerJobClaimLog(denoiseTaskJob()),
    'Claimed job job-denoise-1 (denoise-task, codex, publish=none) task-denoise-1 "Denoise test task"',
  );
});

Deno.test("formatRunnerReadyLog includes harnesses, docker, and repo count", () => {
  assertEquals(
    formatRunnerReadyLog("runner-1", {
      harnesses: ["codex", "opencode"],
      docker: true,
    }, 2),
    "Runner ready; accepting work as runner-1 (codex, opencode; docker; 2 repos)",
  );
  assertEquals(
    formatRunnerReadyLog("runner-1", { harnesses: [], docker: false }, 1),
    "Runner ready; accepting work as runner-1 (no harnesses; no docker; 1 repo)",
  );
});

Deno.test("formatRunnerProgressLog mirrors high-signal events only", () => {
  const phase: RunnerProgressEvent = {
    schema_version: "1.0",
    invocation_id: "invocation-1",
    seq: 1,
    ts: "2026-07-23T12:00:00.000Z",
    type: "phase.started",
    phase: "plan",
    message: "Plan phase started",
  };
  assertEquals(
    formatRunnerProgressLog("job-1", phase),
    "Job job-1 plan started: Plan phase started",
  );
  assertEquals(
    formatRunnerProgressLog("job-1", {
      ...phase,
      type: "publish.completed",
      message: "Published",
      data: { pr_url: "https://github.com/chesapeakedev/dn/pull/214" },
    }),
    "Job job-1 publish completed: Published (https://github.com/chesapeakedev/dn/pull/214)",
  );
  assertEquals(
    formatRunnerProgressLog("job-1", {
      ...phase,
      type: "invocation.failed",
      message: "boom",
    }),
    "Job job-1 invocation failed: boom",
  );
  assertEquals(
    formatRunnerProgressLog("job-1", {
      ...phase,
      type: "agent.line",
      message: "thinking",
    }),
    null,
  );
  assertEquals(
    formatRunnerProgressLog("job-1", {
      ...phase,
      type: "step.started",
      step: 1,
      message: "Resolving issue context",
    }),
    null,
  );
});

Deno.test("serveRunner logs idle once across empty claims", async () => {
  const directory = await Deno.makeTempDir({ prefix: "dn-runner-idle-once-" });
  const previousHome = Deno.env.get("DN_RUNNER_HOME");
  Deno.env.set("DN_RUNNER_HOME", directory);
  const logs: string[] = [];
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
    const serving = serveRunner({
      runnerId: "runner-1",
      dnVersion: "0.0.0-test",
      commandPrefix: ["/usr/local/bin/dn"],
      client,
      signal: controller.signal,
      idleWaitMs: 20,
      idleLogIntervalMs: 60_000,
      log: (line) => logs.push(line),
    });
    const deadline = Date.now() + 3_000;
    while (claims < 3 && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 15));
    }
    controller.abort();
    await serving;
    const idle = logs.filter((line) =>
      line.includes("No work available; waiting for jobs")
    );
    const still = logs.filter((line) =>
      line.includes("Still waiting for jobs")
    );
    assertEquals(idle.length, 1);
    assertEquals(still.length, 0);
    assert(claims >= 3, `expected at least 3 claims, got ${claims}`);
  } finally {
    controller.abort();
    if (previousHome === undefined) Deno.env.delete("DN_RUNNER_HOME");
    else Deno.env.set("DN_RUNNER_HOME", previousHome);
    await Deno.remove(directory, { recursive: true });
  }
});

Deno.test("serveRunner logs a periodic still-waiting idle line", async () => {
  const directory = await Deno.makeTempDir({ prefix: "dn-runner-idle-still-" });
  const previousHome = Deno.env.get("DN_RUNNER_HOME");
  Deno.env.set("DN_RUNNER_HOME", directory);
  const logs: string[] = [];
  const client = new RecordingClient();
  const controller = new AbortController();
  try {
    await saveRunnerConfig({
      schema_version: RUNNER_CONFIG_SCHEMA_VERSION,
      paused: false,
      repositories: {},
    }, getRunnerConfigPaths(directory));
    const serving = serveRunner({
      runnerId: "runner-1",
      dnVersion: "0.0.0-test",
      commandPrefix: ["/usr/local/bin/dn"],
      client,
      signal: controller.signal,
      idleWaitMs: 15,
      idleLogIntervalMs: 40,
      log: (line) => logs.push(line),
    });
    const deadline = Date.now() + 3_000;
    while (
      !logs.some((line) => line.includes("Still waiting for jobs")) &&
      Date.now() < deadline
    ) {
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    controller.abort();
    await serving;
    assert(
      logs.some((line) => line.includes("Still waiting for jobs")),
      `expected still-waiting log, got ${JSON.stringify(logs)}`,
    );
  } finally {
    controller.abort();
    if (previousHome === undefined) Deno.env.delete("DN_RUNNER_HOME");
    else Deno.env.set("DN_RUNNER_HOME", previousHome);
    await Deno.remove(directory, { recursive: true });
  }
});

Deno.test("serveRunner retries transient heartbeat failures", async () => {
  const directory = await Deno.makeTempDir({ prefix: "dn-runner-retry-" });
  const previousHome = Deno.env.get("DN_RUNNER_HOME");
  Deno.env.set("DN_RUNNER_HOME", directory);
  const logs: string[] = [];
  const client = new RecordingClient();
  let heartbeats = 0;
  const original = client.heartbeat.bind(client);
  client.heartbeat = async (heartbeat: RunnerHeartbeat) => {
    heartbeats += 1;
    if (heartbeats === 1) throw new Error("temporarily unavailable");
    return await original(heartbeat);
  };
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
      apiRetryMs: 20,
      log: (line) => logs.push(line),
    });
    assert(
      logs.some((line) =>
        line.includes("Heartbeat failed: temporarily unavailable; retrying in")
      ),
      `expected retry log, got ${JSON.stringify(logs)}`,
    );
    assert(
      logs.some((line) => line.includes("Runner ready; accepting work")),
    );
  } finally {
    if (previousHome === undefined) Deno.env.delete("DN_RUNNER_HOME");
    else Deno.env.set("DN_RUNNER_HOME", previousHome);
    await Deno.remove(directory, { recursive: true });
  }
});

Deno.test("serveRunner does not retry a rejected credential", async () => {
  const directory = await Deno.makeTempDir({ prefix: "dn-runner-auth-" });
  const previousHome = Deno.env.get("DN_RUNNER_HOME");
  Deno.env.set("DN_RUNNER_HOME", directory);
  const logs: string[] = [];
  const client = new RecordingClient();
  client.heartbeat = () =>
    Promise.reject(new Error("invalid or expired runner credential"));
  try {
    await saveRunnerConfig({
      schema_version: RUNNER_CONFIG_SCHEMA_VERSION,
      paused: false,
      repositories: {},
    }, getRunnerConfigPaths(directory));
    await assertRejects(
      () =>
        serveRunner({
          runnerId: "runner-1",
          dnVersion: "0.0.0-test",
          commandPrefix: ["/usr/local/bin/dn"],
          client,
          once: true,
          apiRetryMs: 20,
          log: (line) => logs.push(line),
        }),
      Error,
      "invalid or expired runner credential",
    );
    assertEquals(logs.length, 0);
  } finally {
    if (previousHome === undefined) Deno.env.delete("DN_RUNNER_HOME");
    else Deno.env.set("DN_RUNNER_HOME", previousHome);
    await Deno.remove(directory, { recursive: true });
  }
});

Deno.test("serveRunner heartbeats again after a transient claim failure", async () => {
  const directory = await Deno.makeTempDir({
    prefix: "dn-runner-claim-retry-",
  });
  const previousHome = Deno.env.get("DN_RUNNER_HOME");
  Deno.env.set("DN_RUNNER_HOME", directory);
  const logs: string[] = [];
  const client = new RecordingClient();
  let heartbeats = 0;
  let claims = 0;
  const originalHeartbeat = client.heartbeat.bind(client);
  client.heartbeat = async (heartbeat: RunnerHeartbeat) => {
    heartbeats += 1;
    return await originalHeartbeat(heartbeat);
  };
  client.claimJob = () => {
    claims += 1;
    if (claims === 1) return Promise.reject(new Error("connection reset"));
    return Promise.resolve({ job: null });
  };
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
      apiRetryMs: 20,
      log: (line) => logs.push(line),
    });
    assertEquals(heartbeats, 2);
    assert(
      logs.some((line) =>
        line.includes(
          "Claim failed: connection reset; retrying after the next heartbeat",
        )
      ),
      `expected claim retry log, got ${JSON.stringify(logs)}`,
    );
  } finally {
    if (previousHome === undefined) Deno.env.delete("DN_RUNNER_HOME");
    else Deno.env.set("DN_RUNNER_HOME", previousHome);
    await Deno.remove(directory, { recursive: true });
  }
});

Deno.test("runRunnerJob logs spawn, phase, and publish; skips agent.line", async () => {
  const client = new RecordingClient();
  const status: string[] = [];
  await runRunnerJob(job(), {
    runnerId: "runner-1",
    commandPrefix: ["/usr/local/bin/dn"],
    config: localConfig(),
    client,
    status: (line) => status.push(line),
    spawn(_command, cwd) {
      const events = [
        progressEvent("phase.started", "Plan phase started", {
          phase: "plan",
          seq: 1,
        }),
        progressEvent("agent.line", "thinking", { seq: 2 }),
        progressEvent("step.started", "Resolving issue context", {
          step: 1,
          seq: 3,
        }),
        progressEvent("publish.completed", "Published", {
          seq: 4,
          data: { pr_url: "https://github.com/chesapeakedev/dn/pull/214" },
        }),
      ].join("\n") + "\n";
      assertEquals(cwd, "/workspace/dn");
      return {
        stdout: stream("done\n"),
        stderr: stream(events),
        status: Promise.resolve({ success: true, code: 0, signal: null }),
        kill() {},
      };
    },
  });
  assertEquals(
    status[0],
    "Starting job job-1 in /workspace/dn: dn --unattended --agent codex kickstart --sandbox none --publish pr https://github.com/chesapeakedev/dn/issues/213",
  );
  assert(status.includes("Job job-1 plan started: Plan phase started"));
  assert(
    status.includes(
      "Job job-1 publish completed: Published (https://github.com/chesapeakedev/dn/pull/214)",
    ),
  );
  assertEquals(status.some((line) => line.includes("thinking")), false);
  assertEquals(status.some((line) => line.includes("Resolving issue")), false);
  assertEquals(client.progress.length, 4);
});

Deno.test("runRunnerJob logs cancel before the terminal outcome", async () => {
  const client = new RecordingClient();
  client.cancelOnRenewal = true;
  const status: string[] = [];
  let resolveStatus: (status: Deno.CommandStatus) => void = () => {};
  const childStatus = new Promise<Deno.CommandStatus>((resolvePromise) => {
    resolveStatus = resolvePromise;
  });
  await runRunnerJob(job(), {
    runnerId: "runner-1",
    commandPrefix: ["/usr/local/bin/dn"],
    config: localConfig(),
    client,
    status: (line) => status.push(line),
    spawn: () => ({
      stdout: stream(""),
      stderr: stream(""),
      status: childStatus,
      kill() {
        resolveStatus({ success: false, code: 143, signal: "SIGTERM" });
      },
    }),
    leaseRenewalMs: 1,
    cancellationGraceMs: 1,
  });
  assert(
    status.includes("Job job-1 cancel requested; sending SIGTERM"),
    `expected cancel log, got ${JSON.stringify(status)}`,
  );
  assertEquals(client.failure?.reason, "cancelled");
});

Deno.test("buildRunnerKickstartCommand adds --plan-only for pause_after plan", async () => {
  const planJob = job();
  planJob.operation = {
    type: "kickstart",
    issue_url: "https://github.com/chesapeakedev/dn/issues/213",
    publish: "pr",
    agent: "codex",
    pause_after: "plan",
  };
  const { argv } = await buildRunnerKickstartCommand(planJob, [
    "/usr/local/bin/dn",
  ]);
  assertEquals(argv, [
    "/usr/local/bin/dn",
    "--unattended",
    "--agent",
    "codex",
    "kickstart",
    "--sandbox",
    "none",
    "--publish",
    "pr",
    "--plan-only",
    "https://github.com/chesapeakedev/dn/issues/213",
  ]);
});

Deno.test("buildRunnerKickstartCommand constructs loop argv", async () => {
  const loopJob: RunnerJob = {
    ...job(),
    id: "job-loop-1",
    operation: {
      type: "loop",
      issue_url: "https://github.com/chesapeakedev/dn/issues/213",
      agent: "codex",
      publish: "pr",
      plan_file: "plans/issue-213.plan.md",
    },
  };
  const { argv } = await buildRunnerKickstartCommand(loopJob, [
    "/usr/local/bin/dn",
  ]);
  assertEquals(argv, [
    "/usr/local/bin/dn",
    "--unattended",
    "--agent",
    "codex",
    "loop",
    "--publish",
    "pr",
    "--plan-file",
    "plans/issue-213.plan.md",
    "https://github.com/chesapeakedev/dn/issues/213",
  ]);
});
