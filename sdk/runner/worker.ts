// Copyright 2026 Chesapeake Computing
// SPDX-License-Identifier: Apache-2.0

import { formatElapsedTime } from "../github/output.ts";
import { formatAgentFailureOutput } from "../github/progress.ts";
import { checkRunnerRepositories, detectRunnerCapabilities } from "./doctor.ts";
import type { LocalRunnerConfig } from "./config.ts";
import {
  loadRunnerConfig,
  loadRunnerCredential,
  recordRunnerLoopAlive,
  saveRunnerCredential,
} from "./config.ts";
import type {
  RunnerCapabilities,
  RunnerHeartbeat,
  RunnerHeartbeatResponse,
  RunnerJob,
  RunnerJobCompletion,
  RunnerJobFailure,
  RunnerLeaseResponse,
  RunnerProgressEvent,
} from "./types.ts";
import {
  denoiseTaskToMarkdown,
  repositoryFromIssueUrl,
  RUNNER_PROTOCOL_VERSION,
  validateRunnerJob,
} from "./types.ts";
import { applyTaskSyncOp, listTasks } from "../tasks/tasks.ts";

const DEFAULT_LEASE_RENEWAL_MS = 15_000;
const DEFAULT_CANCELLATION_GRACE_MS = 10_000;
const DEFAULT_IDLE_WAIT_MS = 2_500;
const DEFAULT_IDLE_LOG_INTERVAL_MS = 5 * 60_000;
const DEFAULT_API_RETRY_MS = 5_000;
const MAX_API_RETRY_MS = 30_000;
const MAX_PROGRESS_EVENTS = 10_000;
const MAX_PROGRESS_LINE_LENGTH = 32 * 1024;
const MAX_DIAGNOSTIC_STDERR_LINES = 20;

const SCAN_PROGRESS_TYPES = new Set<RunnerProgressEvent["type"]>([
  "phase.started",
  "phase.completed",
  "lint.completed",
  "publish.completed",
  "invocation.failed",
]);

/** Terminal outcome of {@link runRunnerJob} for serve-loop status logging. */
export type RunnerJobRunResult =
  | { kind: "succeeded"; prUrl?: string; durationMs?: number }
  | {
    kind: "failed" | "cancelled" | "interrupted";
    message: string;
    exitCode?: number;
    durationMs?: number;
  };

/** Minimal API surface required by the local runner loop. */
export interface RunnerWorkerClient {
  /** Reports current device readiness and receives pending task-sync work. */
  heartbeat(heartbeat: RunnerHeartbeat): Promise<RunnerHeartbeatResponse>;
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
  /** Uploads a plan artifact after a plan-only kickstart. */
  uploadPlan?(
    jobId: string,
    input: { path: string; markdown: string },
  ): Promise<void>;
  /**
   * Installs a replacement bearer after Denoise rotates the runner credential
   * on heartbeat. Optional so tests can omit it.
   */
  setCredential?(credential: string): void;
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
  /** Receives scan-layer status lines while the job runs. */
  status?: (message: string) => void;
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
  /** Receives timestamped loop status lines (defaults to console.log). */
  log?: (line: string) => void;
  /** Clock override for deterministic status timestamps in tests. */
  now?: () => Date;
  /** Delay after an empty claim before polling again (defaults to 2.5s). */
  idleWaitMs?: number;
  /** Minimum time between idle status lines (defaults to 5 minutes). */
  idleLogIntervalMs?: number;
  /** Initial delay before retrying a transient heartbeat or claim.
   * Defaults to 5 seconds. */
  apiRetryMs?: number;
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
      "--sandbox",
      "none",
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
  if (job.operation.type === "land") {
    return {
      argv: [
        ...commandPrefix,
        "--unattended",
        "--agent",
        job.operation.agent,
        "land",
        ...(job.operation.plan_file != null ? [job.operation.plan_file] : []),
      ],
    };
  }
  if (job.operation.type === "sync") {
    return {
      argv: [
        ...commandPrefix,
        "--unattended",
        "sync",
      ],
    };
  }
  if (job.operation.type === "loop") {
    return {
      argv: [
        ...commandPrefix,
        "--unattended",
        "--agent",
        job.operation.agent,
        "loop",
        "--publish",
        job.operation.publish,
        ...(job.operation.plan_file != null
          ? ["--plan-file", job.operation.plan_file]
          : []),
        ...allowCrossRepoArgs(job.operation.issue_url, job.repository),
        job.operation.issue_url,
      ],
    };
  }
  return {
    argv: [
      ...commandPrefix,
      "--unattended",
      "--agent",
      job.operation.agent,
      "kickstart",
      "--sandbox",
      "none",
      "--publish",
      job.operation.publish,
      ...(job.operation.pause_after === "plan" ? ["--plan-only"] : []),
      ...(job.operation.skip_plan === true ? ["--skip-plan"] : []),
      ...allowCrossRepoArgs(job.operation.issue_url, job.repository),
      job.operation.issue_url,
    ],
  };
}

function allowCrossRepoArgs(issueUrl: string, repository: string): string[] {
  const issueRepository = repositoryFromIssueUrl(issueUrl);
  if (issueRepository.toLowerCase() !== repository.toLowerCase()) {
    return ["--allow-cross-repo"];
  }
  return [];
}

/**
 * Builds the human-readable failJob message from exit code plus kickstart detail.
 *
 * Prefers the last `invocation.failed` progress message, then trailing non-progress
 * stderr lines, so the UI shows why kickstart exited rather than only the code.
 */
export function formatRunnerJobFailureMessage(
  exitCode: number | undefined,
  options: {
    invocationFailedMessage?: string;
    diagnosticLines?: string[];
  } = {},
): string {
  const exitPart = exitCode === undefined
    ? "dn kickstart failed."
    : `dn kickstart exited with code ${exitCode}.`;
  const fromProgress = options.invocationFailedMessage?.trim();
  const fromStderr = (options.diagnosticLines ?? [])
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .slice(-5)
    .join("\n");
  const detail = fromProgress || fromStderr;
  if (!detail) return exitPart;
  const summarized = formatAgentFailureOutput(detail, { truncate: true });
  if (!summarized) return exitPart;
  return `${exitPart} ${summarized}`;
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

/**
 * Formats one outbound serve-loop status line with an ISO-8601 timestamp.
 *
 * @param message - Human-readable status after the timestamp prefix
 * @param now - Instant used for the timestamp (defaults to the current time)
 */
export function formatRunnerServeLog(
  message: string,
  now: Date = new Date(),
): string {
  return `[${now.toISOString()}] ${message}`;
}

/**
 * Formats the first ready line after a successful heartbeat.
 *
 * @param runnerId - Opaque paired runner identifier
 * @param capabilities - Locally detected harnesses and Docker
 * @param repositoryCount - Number of registered checkouts
 */
export function formatRunnerReadyLog(
  runnerId: string,
  capabilities: Pick<RunnerCapabilities, "harnesses" | "docker">,
  repositoryCount: number,
): string {
  const harnesses = capabilities.harnesses.length > 0
    ? capabilities.harnesses.join(", ")
    : "no harnesses";
  const docker = capabilities.docker ? "docker" : "no docker";
  const repos = repositoryCount === 1 ? "1 repo" : `${repositoryCount} repos`;
  return `Runner ready; accepting work as ${runnerId} (${harnesses}; ${docker}; ${repos})`;
}

function issueShorthand(issueUrl: string): string {
  try {
    const slug = repositoryFromIssueUrl(issueUrl);
    const match = issueUrl.match(/\/issues\/(\d+)/);
    return match ? `${slug}#${match[1]}` : slug;
  } catch {
    return issueUrl;
  }
}

function formatRunnerJobTarget(job: RunnerJob): string {
  const operation = job.operation;
  if (operation.type === "kickstart") {
    return issueShorthand(operation.issue_url);
  }
  if (operation.type === "denoise-task") {
    return `${operation.task_document.id} "${operation.task_document.title}"`;
  }
  if (operation.type === "land") {
    const issue = issueShorthand(operation.issue_url);
    return operation.plan_file ? `${issue} ${operation.plan_file}` : issue;
  }
  if (operation.type === "loop") {
    const issue = issueShorthand(operation.issue_url);
    return operation.plan_file ? `${issue} ${operation.plan_file}` : issue;
  }
  return issueShorthand(operation.issue_url);
}

/**
 * Formats the serve-loop claim line with operation, agent, publish, and target.
 *
 * @param job - Claimed runner job
 */
export function formatRunnerJobClaimLog(job: RunnerJob): string {
  const operation = job.operation;
  const details: string[] = [operation.type];
  if (operation.type !== "sync") details.push(operation.agent);
  if (
    operation.type === "kickstart" || operation.type === "denoise-task" ||
    operation.type === "loop"
  ) {
    details.push(`publish=${operation.publish}`);
  }
  if (operation.type === "kickstart" && operation.pause_after === "plan") {
    details.push("pause_after=plan");
  }
  return `Claimed job ${job.id} (${details.join(", ")}) ${
    formatRunnerJobTarget(job)
  }`;
}

function formatRunnerCommand(command: string[]): string {
  if (command.length === 0) return "";
  const bin = command[0].split(/[/\\]/).pop() ?? command[0];
  return [bin, ...command.slice(1)].join(" ");
}

function formatRunnerSpawnLog(
  jobId: string,
  cwd: string,
  command: string[],
): string {
  return `Starting job ${jobId} in ${cwd}: ${formatRunnerCommand(command)}`;
}

/**
 * Formats a high-signal progress event for the serve-loop scan layer.
 *
 * Returns null for types that would duplicate child stdout or flood the
 * terminal (`step.*`, `agent.line`, invocation queued/running/succeeded).
 *
 * @param jobId - Claimed job identifier
 * @param event - Parsed kickstart progress event
 */
export function formatRunnerProgressLog(
  jobId: string,
  event: RunnerProgressEvent,
): string | null {
  if (!SCAN_PROGRESS_TYPES.has(event.type)) return null;
  if (event.type === "phase.started" || event.type === "phase.completed") {
    const label = event.phase ?? "phase";
    const verb = event.type === "phase.started" ? "started" : "completed";
    return `Job ${jobId} ${label} ${verb}: ${event.message}`;
  }
  if (event.type === "lint.completed") {
    return `Job ${jobId} lint completed: ${event.message}`;
  }
  if (event.type === "publish.completed") {
    const prUrl = typeof event.data?.pr_url === "string"
      ? ` (${event.data.pr_url})`
      : "";
    return `Job ${jobId} publish completed: ${event.message}${prUrl}`;
  }
  return `Job ${jobId} invocation failed: ${event.message}`;
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

function isPermanentRunnerApiError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /invalid or expired runner credential/i.test(message) ||
    message === "Runner is not paired.";
}

async function markRunnerLoopAlive(): Promise<void> {
  try {
    await recordRunnerLoopAlive();
  } catch {
    // Doctor uses this stamp; the serve loop must not die if it is unwritable.
  }
}

async function terminateChild(
  child: RunnerChildProcess,
  graceMs: number,
  onKill?: (signal: Deno.Signal) => void,
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
      onKill?.("SIGKILL");
    } catch {
      // The process may have exited between the grace timeout and this call.
    }
  }
}

function isRepoRelativePlanFile(value: string): boolean {
  return /^plans\/[^/]+\.plan\.md$/.test(value);
}

async function readPlanArtifact(
  checkoutPath: string,
  planPath: string,
): Promise<{ path: string; markdown: string } | null> {
  if (!isRepoRelativePlanFile(planPath)) return null;
  try {
    const markdown = await Deno.readTextFile(`${checkoutPath}/${planPath}`);
    if (markdown.trim() === "") return null;
    return { path: planPath, markdown };
  } catch {
    return null;
  }
}

async function findLatestPlanArtifact(
  checkoutPath: string,
): Promise<{ path: string; markdown: string } | null> {
  const plansDir = `${checkoutPath}/plans`;
  try {
    const entries: { name: string; mtime: number }[] = [];
    for await (const entry of Deno.readDir(plansDir)) {
      if (!entry.isFile || !entry.name.endsWith(".plan.md")) continue;
      const stat = await Deno.stat(`${plansDir}/${entry.name}`);
      entries.push({
        name: entry.name,
        mtime: stat.mtime?.getTime() ?? 0,
      });
    }
    entries.sort((left, right) => right.mtime - left.mtime);
    const latest = entries[0];
    if (!latest) return null;
    return await readPlanArtifact(checkoutPath, `plans/${latest.name}`);
  } catch {
    return null;
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
): Promise<RunnerJobRunResult> {
  validateRunnerJob(job, options.runnerId);
  const registration = options.config.repositories[job.repository];
  if (!registration) {
    const message =
      `Repository ${job.repository} is not registered on this device.`;
    await options.client.failJob(job.id, {
      failed_at: new Date().toISOString(),
      reason: "failed",
      message,
    });
    return { kind: "failed", message };
  }
  const { argv: command, cleanup } = await buildRunnerKickstartCommand(
    job,
    options.commandPrefix,
  );
  options.status?.(formatRunnerSpawnLog(job.id, registration.path, command));
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
  let didLogProgressDeliveryFailure = false;
  let prUrl: string | undefined;
  let invocationFailedMessage: string | undefined;
  let planPath: string | undefined;
  const diagnosticLines: string[] = [];
  const graceMs = options.cancellationGraceMs ?? DEFAULT_CANCELLATION_GRACE_MS;

  const recordDiagnostic = (line: string): void => {
    diagnosticLines.push(line);
    if (diagnosticLines.length > MAX_DIAGNOSTIC_STDERR_LINES) {
      diagnosticLines.shift();
    }
    options.stderr?.(line);
  };

  const requestStop = async (
    reason: "cancelled" | "interrupted",
  ): Promise<void> => {
    if (reason === "cancelled") {
      options.status?.(
        `Job ${job.id} cancel requested; sending SIGTERM`,
      );
    } else {
      options.status?.(
        `Job ${job.id} lease lost; interrupting to prevent duplicate work`,
      );
    }
    await terminateChild(child, graceMs, (signal) => {
      if (signal === "SIGKILL") {
        options.status?.(
          `Job ${job.id} still running after SIGTERM; sending SIGKILL`,
        );
      }
    });
  };

  const stdoutTask = consumeLines(
    child.stdout,
    (line) => options.stdout?.(line),
  );
  const stderrTask = consumeLines(child.stderr, async (line) => {
    const event = parseRunnerProgressLine(line, job.invocation_id);
    if (!event) {
      recordDiagnostic(line);
      return;
    }
    const progressEvent = job.operation.type === "denoise-task"
      ? {
        ...event,
        task_id: job.operation.task_document.id,
        data: {
          ...event.data,
          task_id: job.operation.task_document.id,
        },
      }
      : event;
    if (
      progressEvent.type === "publish.completed" &&
      typeof progressEvent.data?.pr_url === "string"
    ) {
      prUrl = progressEvent.data.pr_url;
    }
    if (progressEvent.type === "invocation.failed") {
      invocationFailedMessage = progressEvent.message;
    }
    if (
      progressEvent.type === "phase.completed" &&
      typeof progressEvent.data?.plan_path === "string"
    ) {
      planPath = progressEvent.data.plan_path;
    }
    const scanLine = formatRunnerProgressLog(job.id, progressEvent);
    if (scanLine) options.status?.(scanLine);
    if (progressCount >= MAX_PROGRESS_EVENTS) return;
    progressCount++;
    try {
      await options.client.sendProgress(job.id, progressEvent);
    } catch (error) {
      const message = `Progress delivery failed: ${
        error instanceof Error ? error.message : String(error)
      }`;
      recordDiagnostic(message);
      if (!didLogProgressDeliveryFailure) {
        didLogProgressDeliveryFailure = true;
        options.status?.(`Job ${job.id} ${message}`);
      }
    }
  });

  if (cancellationRequested) {
    await requestStop("cancelled");
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
        await markRunnerLoopAlive();
        if (response.lease.cancel_requested) {
          cancellationRequested = true;
          await requestStop("cancelled");
        }
      } catch (error) {
        interrupted = true;
        recordDiagnostic(
          `Lease renewal failed; interrupting job to prevent duplicate work: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
        await requestStop("interrupted");
      }
    }
  })();

  try {
    const status = await child.status;
    stopLeaseLoop.abort();
    await Promise.all([stdoutTask, stderrTask, leaseTask]);
    const durationMs = Math.max(0, Date.now() - startedAt);

    if (cancellationRequested || interrupted || !status.success) {
      const reason = cancellationRequested
        ? "cancelled"
        : interrupted
        ? "interrupted"
        : "failed";
      const message = reason === "cancelled"
        ? "Job cancelled by its owner."
        : reason === "interrupted"
        ? "Runner lost its job lease; explicit retry is required."
        : formatRunnerJobFailureMessage(status.code, {
          invocationFailedMessage,
          diagnosticLines,
        });
      const failure: RunnerJobFailure = {
        failed_at: new Date().toISOString(),
        reason,
        message,
        ...(status.code === undefined ? {} : { exit_code: status.code }),
      };
      await options.client.failJob(job.id, failure);
      return {
        kind: reason,
        message,
        durationMs,
        ...(status.code === undefined ? {} : { exitCode: status.code }),
      };
    }
    await options.client.completeJob(
      job.id,
      completionFrom(startedAt, prUrl),
    );
    const shouldUploadPlan = job.operation.type === "kickstart" &&
      job.operation.pause_after === "plan" &&
      options.client.uploadPlan != null;
    if (shouldUploadPlan && options.client.uploadPlan) {
      const artifact = (planPath
        ? await readPlanArtifact(registration.path, planPath)
        : null) ?? await findLatestPlanArtifact(registration.path);
      if (artifact) {
        try {
          await options.client.uploadPlan(job.id, artifact);
        } catch (error) {
          recordDiagnostic(
            `Plan artifact upload failed: ${
              error instanceof Error ? error.message : String(error)
            }`,
          );
        }
      }
    }
    return { kind: "succeeded", prUrl, durationMs };
  } finally {
    await cleanup?.();
  }
}

/** Formats a serve-loop status line for a job's terminal outcome. */
export function formatRunnerJobOutcomeLog(
  jobId: string,
  outcome: RunnerJobRunResult,
): string {
  const duration = outcome.durationMs === undefined
    ? undefined
    : formatElapsedTime(outcome.durationMs);
  if (outcome.kind === "succeeded") {
    const extras = [duration, outcome.prUrl].filter((item): item is string =>
      item !== undefined && item.length > 0
    );
    return extras.length > 0
      ? `Job ${jobId} succeeded (${extras.join(", ")})`
      : `Job ${jobId} succeeded`;
  }
  const durationPart = duration === undefined ? "" : ` (${duration})`;
  return `Job ${jobId} ${outcome.kind}${durationPart}: ${outcome.message}`;
}

/**
 * Persists a sliding expiry and optional replacement bearer from a heartbeat.
 * Disk write happens before the in-memory client switches, so a crash still
 * has a secret Denoise will accept (current or previous-grace).
 */
async function applyHeartbeatCredential(
  client: RunnerWorkerClient,
  response: RunnerHeartbeatResponse,
): Promise<void> {
  if (!response.credential && !response.credential_expires_at) return;
  const stored = await loadRunnerCredential();
  if (stored) {
    await saveRunnerCredential({
      ...stored,
      credential: response.credential ?? stored.credential,
      created_at: response.credential
        ? new Date().toISOString()
        : stored.created_at,
      expires_at: response.credential_expires_at ?? stored.expires_at,
    });
  }
  if (response.credential) {
    client.setCredential?.(response.credential);
  }
}

/** Runs the authenticated heartbeat/claim loop with one-job concurrency. */
export async function serveRunner(
  options: ServeRunnerOptions,
): Promise<void> {
  const log = options.log ?? console.log;
  const now = options.now ?? (() => new Date());
  const idleWaitMs = options.idleWaitMs ?? DEFAULT_IDLE_WAIT_MS;
  const idleLogIntervalMs = options.idleLogIntervalMs ??
    DEFAULT_IDLE_LOG_INTERVAL_MS;
  const apiRetryMs = options.apiRetryMs ?? DEFAULT_API_RETRY_MS;
  const status = (message: string): void => {
    log(formatRunnerServeLog(message, now()));
  };
  const retryApi = async <T>(
    label: string,
    fn: () => Promise<T>,
  ): Promise<T> => {
    let delay = apiRetryMs;
    while (true) {
      if (options.signal?.aborted) {
        throw new DOMException("The operation was aborted.", "AbortError");
      }
      try {
        return await fn();
      } catch (error) {
        if (isAbortError(error) || options.signal?.aborted) throw error;
        if (isPermanentRunnerApiError(error)) throw error;
        const message = error instanceof Error ? error.message : String(error);
        status(
          `${label} failed: ${message}; retrying in ${
            formatElapsedTime(delay)
          }`,
        );
        await waitFor(delay, options.signal);
        delay = Math.min(delay * 2, MAX_API_RETRY_MS);
      }
    }
  };
  const capabilities = await detectRunnerCapabilities();
  let announcedReady = false;
  let announcedIdle = false;
  let lastIdleLogAt = 0;
  let pendingAcks: string[] = [];
  let pendingTaskList: RunnerHeartbeat["task_list"] | undefined;
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
      accepts_credential_rotation: true,
      ...(pendingAcks.length > 0 ? { task_sync_acks: pendingAcks } : {}),
      ...(pendingTaskList ? { task_list: pendingTaskList } : {}),
    };
    let heartbeatResponse: RunnerHeartbeatResponse;
    try {
      heartbeatResponse = await retryApi(
        "Heartbeat",
        () => options.client.heartbeat(heartbeat),
      );
      await applyHeartbeatCredential(options.client, heartbeatResponse);
    } catch (error) {
      if (isAbortError(error) || options.signal?.aborted) return;
      throw error;
    }
    await markRunnerLoopAlive();
    pendingAcks = [];
    pendingTaskList = undefined;

    const pendingOps = heartbeatResponse?.pending_task_ops ?? [];
    if (pendingOps.length > 0) {
      for (const envelope of pendingOps) {
        try {
          await applyTaskSyncOp({
            op: envelope.op,
            task_id: envelope.task_id,
            task_document: envelope.task_document,
          });
          pendingAcks.push(envelope.id);
        } catch (error) {
          status(
            `Task sync ${envelope.id} failed: ${
              error instanceof Error ? error.message : String(error)
            }`,
          );
        }
      }
      if (pendingAcks.length > 0) {
        status(`Applied ${pendingAcks.length} local task sync op(s)`);
      }
    }
    if (heartbeatResponse?.list_tasks_requested) {
      pendingTaskList = await listTasks();
      status(`Prepared local task list (${pendingTaskList.length})`);
    }

    if (config.paused) {
      announcedReady = false;
      announcedIdle = false;
      status("Runner paused; not claiming jobs");
      if (options.once) return;
      await waitFor(15_000, options.signal);
      continue;
    }
    if (!announcedReady) {
      status(
        formatRunnerReadyLog(
          options.runnerId,
          capabilities,
          repositories.length,
        ),
      );
      announcedReady = true;
    }
    let job: RunnerJob | null;
    try {
      const claimed = await options.client.claimJob(25, options.signal);
      job = claimed.job;
    } catch (error) {
      if (isAbortError(error) || options.signal?.aborted) return;
      if (isPermanentRunnerApiError(error)) throw error;
      const message = error instanceof Error ? error.message : String(error);
      status(
        `Claim failed: ${message}; retrying after the next heartbeat`,
      );
      await waitFor(apiRetryMs, options.signal);
      continue;
    }
    await markRunnerLoopAlive();
    if (job) {
      announcedIdle = false;
      status(formatRunnerJobClaimLog(job));
      try {
        await retryApi("Heartbeat", async () => {
          const busyResponse = await options.client.heartbeat({
            ...heartbeat,
            state: "busy",
            ...(pendingAcks.length > 0 ? { task_sync_acks: pendingAcks } : {}),
            ...(pendingTaskList ? { task_list: pendingTaskList } : {}),
          });
          await applyHeartbeatCredential(options.client, busyResponse);
        });
      } catch (error) {
        if (isAbortError(error) || options.signal?.aborted) return;
        throw error;
      }
      await markRunnerLoopAlive();
      pendingAcks = [];
      pendingTaskList = undefined;
      let outcome: RunnerJobRunResult;
      try {
        outcome = await runRunnerJob(job, {
          runnerId: options.runnerId,
          commandPrefix: options.commandPrefix,
          config,
          client: options.client,
          stdout: console.log,
          stderr: console.error,
          status,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        try {
          await options.client.failJob(job.id, {
            failed_at: new Date().toISOString(),
            reason: "failed",
            message,
          });
        } catch {
          // Terminal reporting is best-effort after an unexpected local failure.
        }
        outcome = { kind: "failed", message };
      }
      status(formatRunnerJobOutcomeLog(job.id, outcome));
      announcedReady = false;
    } else {
      const idleAt = now().getTime();
      if (!announcedIdle) {
        status("No work available; waiting for jobs");
        announcedIdle = true;
        lastIdleLogAt = idleAt;
      } else if (idleAt - lastIdleLogAt >= idleLogIntervalMs) {
        status("Still waiting for jobs");
        lastIdleLogAt = idleAt;
      }
      if (options.once) return;
      await waitFor(idleWaitMs, options.signal);
      continue;
    }
    if (options.once) return;
  } while (!options.signal?.aborted);
}
