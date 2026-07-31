// Copyright 2026 Chesapeake Computing
// SPDX-License-Identifier: Apache-2.0

import { checkRunnerRepositories, detectRunnerCapabilities } from "./doctor.ts";
import type { LocalRunnerConfig } from "./config.ts";
import { loadRunnerConfig } from "./config.ts";
import type {
  RunnerHeartbeat,
  RunnerJob,
  RunnerJobCompletion,
  RunnerJobFailure,
  RunnerLeaseResponse,
  RunnerProgressEvent,
} from "./types.ts";
import {
  denoiseTaskToMarkdown,
  RUNNER_PROTOCOL_VERSION,
  validateRunnerJob,
} from "./types.ts";

const DEFAULT_LEASE_RENEWAL_MS = 15_000;
const DEFAULT_CANCELLATION_GRACE_MS = 10_000;
const MAX_PROGRESS_EVENTS = 10_000;
const MAX_PROGRESS_LINE_LENGTH = 32 * 1024;

/** Minimal API surface required by the local runner loop. */
export interface RunnerWorkerClient {
  /** Reports current device readiness. */
  heartbeat(heartbeat: RunnerHeartbeat): Promise<void>;
  /** Atomically claims at most one job after an optional long poll. */
  claimJob(
    waitSeconds?: number,
    signal?: AbortSignal,
  ): Promise<{ job: RunnerJob | null }>;
  /** Renews a job lease and returns cancellation state. */
  renewLease(jobId: string, leaseId: string): Promise<RunnerLeaseResponse>;
  /** Forwards one existing progress-schema event. */
  sendProgress(jobId: string, event: RunnerProgressEvent): Promise<void>;
  /** Records a successful terminal receipt. */
  completeJob(
    jobId: string,
    completion: RunnerJobCompletion,
  ): Promise<void>;
  /** Records failure, cancellation, or lease interruption. */
  failJob(jobId: string, failure: RunnerJobFailure): Promise<void>;
}

/** Child-process shape used by the job executor. */
export interface RunnerChildProcess {
  /** Local process standard output. */
  stdout: ReadableStream<Uint8Array>;
  /** Local process standard error containing NDJSON progress. */
  stderr: ReadableStream<Uint8Array>;
  /** Terminal child status. */
  status: Promise<Deno.CommandStatus>;
  /** Sends a bounded cancellation signal to the child. */
  kill(signal: Deno.Signal): void;
}

/** Options for running one claimed job. */
export interface RunRunnerJobOptions {
  /** Opaque paired runner identifier expected by the job. */
  runnerId: string;
  /** Local argv prefix used to invoke this dn build. */
  commandPrefix: string[];
  /** Private local repository registrations. */
  config: LocalRunnerConfig;
  /** Authenticated runner API implementation. */
  client: RunnerWorkerClient;
  /** Optional child-process factory for embedding and tests. */
  spawn?: (
    command: string[],
    cwd: string,
    env: Record<string, string>,
  ) => RunnerChildProcess;
  /** Lease renewal interval override in milliseconds. */
  leaseRenewalMs?: number;
  /** Cancellation grace override in milliseconds. */
  cancellationGraceMs?: number;
  /** Receives ordinary child stdout lines. */
  stdout?: (line: string) => void;
  /** Receives non-progress diagnostics. */
  stderr?: (line: string) => void;
}

/** Options for the long-running outbound worker. */
export interface ServeRunnerOptions {
  /** Opaque paired runner identifier. */
  runnerId: string;
  /** Installed dn version reported in heartbeats. */
  dnVersion: string;
  /** Local argv prefix used to invoke this dn build. */
  commandPrefix: string[];
  /** Authenticated runner API implementation. */
  client: RunnerWorkerClient;
  /** Return after one heartbeat/claim cycle for diagnostics. */
  once?: boolean;
  /** Optional signal that stops the outbound loop. */
  signal?: AbortSignal;
}

function defaultSpawn(
  command: string[],
  cwd: string,
  env: Record<string, string>,
): RunnerChildProcess {
  if (command.length === 0) throw new Error("Runner command is empty.");
  const child = new Deno.Command(command[0], {
    args: command.slice(1),
    cwd,
    env,
    stdin: "null",
    stdout: "piped",
    stderr: "piped",
  }).spawn();
  return child;
}

/** Builds a command for a denoise-task job, materializing the task to a temp file. */
export async function buildRunnerDenoiseTaskCommand(
  job: RunnerJob,
  commandPrefix: string[],
): Promise<{ argv: string[]; cleanup: () => Promise<void> }> {
  if (job.operation.type !== "denoise-task") {
    throw new Error("Expected a denoise-task operation.");
  }
  const tmpDir = await Deno.makeTempDir({ prefix: "dn-denoise-task-" });
  const mdPath = `${tmpDir}/task.md`;
  const markdown = denoiseTaskToMarkdown(job.operation.task_document);
  await Deno.writeTextFile(mdPath, markdown);
  const cleanup = async () => {
    try {
      await Deno.remove(tmpDir, { recursive: true });
    } catch {
      // Temp directory cleanup is best-effort.
    }
  };
  return {
    argv: [
      ...commandPrefix,
      "--unattended",
      "--agent",
      job.operation.agent,
      "kickstart",
      "--publish",
      job.operation.publish,
      mdPath,
    ],
    cleanup,
  };
}

/** Builds a command for a remote job, dispatching by operation type. */
export function buildRunnerKickstartCommand(
  job: RunnerJob,
  commandPrefix: string[],
):
  | { argv: string[]; cleanup?: () => Promise<void> }
  | Promise<{ argv: string[]; cleanup?: () => Promise<void> }> {
  validateRunnerJob(job);
  if (commandPrefix.length === 0) {
    throw new Error("Runner command prefix is empty.");
  }
  if (job.operation.type === "denoise-task") {
    return buildRunnerDenoiseTaskCommand(job, commandPrefix);
  }
  return {
    argv: [
      ...commandPrefix,
      "--unattended",
      "--agent",
      job.operation.agent,
      "kickstart",
      "--publish",
      job.operation.publish,
      job.operation.issue_url,
    ],
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Parses one NDJSON line and accepts only the existing progress schema. */
export function parseRunnerProgressLine(
  line: string,
  invocationId: string,
): RunnerProgressEvent | null {
  if (line.length > MAX_PROGRESS_LINE_LENGTH) return null;
  let value: unknown;
  try {
    value = JSON.parse(line);
  } catch {
    return null;
  }
  if (
    !isRecord(value) ||
    value.schema_version !== "1.0" ||
    value.invocation_id !== invocationId ||
    typeof value.seq !== "number" ||
    !Number.isInteger(value.seq) ||
    typeof value.ts !== "string" ||
    typeof value.type !== "string" ||
    typeof value.message !== "string"
  ) {
    return null;
  }
  const allowedTypes = [
    "invocation.queued",
    "invocation.running",
    "step.started",
    "step.completed",
    "phase.started",
    "phase.completed",
    "lint.completed",
    "publish.completed",
    "agent.line",
    "invocation.succeeded",
    "invocation.failed",
  ];
  if (!allowedTypes.includes(value.type)) return null;
  return value as unknown as RunnerProgressEvent;
}

async function consumeLines(
  stream: ReadableStream<Uint8Array>,
  callback: (line: string) => Promise<void> | void,
): Promise<void> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let pending = "";
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      pending += decoder.decode(value, { stream: true });
      const lines = pending.split(/\r?\n/);
      pending = lines.pop() ?? "";
      for (const line of lines) await callback(line);
    }
    pending += decoder.decode();
    if (pending) await callback(pending);
  } finally {
    reader.releaseLock();
  }
}

function waitFor(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolvePromise) => {
    if (signal?.aborted) {
      resolvePromise();
      return;
    }
    const timer = setTimeout(resolvePromise, ms);
    signal?.addEventListener("abort", () => {
      clearTimeout(timer);
      resolvePromise();
    }, { once: true });
  });
}

async function terminateChild(
  child: RunnerChildProcess,
  graceMs: number,
): Promise<void> {
  try {
    child.kill("SIGTERM");
  } catch {
    return;
  }
  const grace = new AbortController();
  const stopped = await Promise.race([
    child.status.then(() => true),
    waitFor(graceMs, grace.signal).then(() => false),
  ]);
  grace.abort();
  if (!stopped) {
    try {
      child.kill("SIGKILL");
    } catch {
      // The process may have exited between the grace timeout and this call.
    }
  }
}

function completionFrom(
  startedAt: number,
  prUrl?: string,
): RunnerJobCompletion {
  const durationMs = Math.max(0, Date.now() - startedAt);
  return {
    completed_at: new Date().toISOString(),
    duration_ms: durationMs,
    local_compute_minutes: Math.ceil(durationMs / 60_000),
    hosted_runs_avoided: 1,
    ...(prUrl ? { pr_url: prUrl } : {}),
  };
}

/** Executes one validated job, renews its lease, and reports its terminal state. */
export async function runRunnerJob(
  job: RunnerJob,
  options: RunRunnerJobOptions,
): Promise<void> {
  validateRunnerJob(job, options.runnerId);
  const registration = options.config.repositories[job.repository];
  if (!registration) {
    await options.client.failJob(job.id, {
      failed_at: new Date().toISOString(),
      reason: "failed",
      message: `Repository ${job.repository} is not registered on this device.`,
    });
    return;
  }
  const { argv: command, cleanup } = await buildRunnerKickstartCommand(
    job,
    options.commandPrefix,
  );
  const child = (options.spawn ?? defaultSpawn)(
    command,
    registration.path,
    {
      DN_DISPATCH_ID: job.invocation_id,
      DN_PROGRESS: "ndjson",
      DN_PROGRESS_VERBOSE: "1",
    },
  );
  const startedAt = Date.now();
  const stopLeaseLoop = new AbortController();
  let cancellationRequested = job.lease.cancel_requested;
  let interrupted = false;
  let progressCount = 0;
  let prUrl: string | undefined;

  const stdoutTask = consumeLines(
    child.stdout,
    (line) => options.stdout?.(line),
  );
  const stderrTask = consumeLines(child.stderr, async (line) => {
    const event = parseRunnerProgressLine(line, job.invocation_id);
    if (!event) {
      options.stderr?.(line);
      return;
    }
    if (
      event.type === "publish.completed" &&
      typeof event.data?.pr_url === "string"
    ) {
      prUrl = event.data.pr_url;
    }
    if (progressCount >= MAX_PROGRESS_EVENTS) return;
    progressCount++;
    try {
      await options.client.sendProgress(job.id, event);
    } catch (error) {
      options.stderr?.(
        `Progress delivery failed: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  });

  if (cancellationRequested) {
    await terminateChild(
      child,
      options.cancellationGraceMs ?? DEFAULT_CANCELLATION_GRACE_MS,
    );
  }

  const leaseTask = (async (): Promise<void> => {
    while (!stopLeaseLoop.signal.aborted && !cancellationRequested) {
      await waitFor(
        options.leaseRenewalMs ?? DEFAULT_LEASE_RENEWAL_MS,
        stopLeaseLoop.signal,
      );
      if (stopLeaseLoop.signal.aborted) break;
      try {
        const response = await options.client.renewLease(
          job.id,
          job.lease.id,
        );
        job.lease = response.lease;
        if (response.lease.cancel_requested) {
          cancellationRequested = true;
          await terminateChild(
            child,
            options.cancellationGraceMs ?? DEFAULT_CANCELLATION_GRACE_MS,
          );
        }
      } catch (error) {
        interrupted = true;
        options.stderr?.(
          `Lease renewal failed; interrupting job to prevent duplicate work: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
        await terminateChild(
          child,
          options.cancellationGraceMs ?? DEFAULT_CANCELLATION_GRACE_MS,
        );
      }
    }
  })();

  try {
    const status = await child.status;
    stopLeaseLoop.abort();
    await Promise.all([stdoutTask, stderrTask, leaseTask]);

    if (cancellationRequested || interrupted || !status.success) {
      const reason = cancellationRequested
        ? "cancelled"
        : interrupted
        ? "interrupted"
        : "failed";
      const failure: RunnerJobFailure = {
        failed_at: new Date().toISOString(),
        reason,
        message: reason === "cancelled"
          ? "Job cancelled by its owner."
          : reason === "interrupted"
          ? "Runner lost its job lease; explicit retry is required."
          : `dn kickstart exited with code ${status.code}.`,
        ...(status.code === undefined ? {} : { exit_code: status.code }),
      };
      await options.client.failJob(job.id, failure);
      return;
    }
    await options.client.completeJob(
      job.id,
      completionFrom(startedAt, prUrl),
    );
  } finally {
    await cleanup?.();
  }
}

/** Runs the authenticated heartbeat/claim loop with one-job concurrency. */
export async function serveRunner(
  options: ServeRunnerOptions,
): Promise<void> {
  const capabilities = await detectRunnerCapabilities();
  do {
    if (options.signal?.aborted) return;
    const config = await loadRunnerConfig();
    const repositories = await checkRunnerRepositories(config);
    const heartbeat: RunnerHeartbeat = {
      protocol_version: RUNNER_PROTOCOL_VERSION,
      dn_version: options.dnVersion,
      capabilities,
      repositories,
      state: config.paused ? "paused" : "ready",
    };
    await options.client.heartbeat(heartbeat);
    if (config.paused) {
      if (options.once) return;
      await waitFor(15_000, options.signal);
      continue;
    }
    const { job } = await options.client.claimJob(25, options.signal);
    if (job) {
      await options.client.heartbeat({ ...heartbeat, state: "busy" });
      await runRunnerJob(job, {
        runnerId: options.runnerId,
        commandPrefix: options.commandPrefix,
        config,
        client: options.client,
        stdout: console.log,
        stderr: console.error,
      });
    }
    if (options.once) return;
  } while (!options.signal?.aborted);
}
