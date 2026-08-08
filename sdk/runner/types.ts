// Copyright 2026 Chesapeake Computing
// SPDX-License-Identifier: Apache-2.0

import type { AgentHarness } from "../github/agentHarness.ts";
import type { PublishMode } from "../github/publish.ts";

/** Current version of the Denoise device-runner protocol. */
export const RUNNER_PROTOCOL_VERSION = "1.0" as const;

/** Oldest device-runner protocol this release of dn can speak. */
export const MINIMUM_RUNNER_PROTOCOL_VERSION = "1.0" as const;

/** Version identifiers accepted by this release of dn. */
export type RunnerProtocolVersion = typeof RUNNER_PROTOCOL_VERSION;

/** Sources from which Denoise can execute a Kickstart invocation. */
export type KickstartInvocationSource =
  | "github_actions"
  | "cursor_cloud"
  | "cloud_vm"
  | "local"
  | "device_runner";

/** A concrete runtime selected for a Kickstart invocation. */
export interface KickstartRuntimeChoice {
  /** Execution environment selected for the invocation. */
  source: KickstartInvocationSource;
  /** Required opaque device identifier when source is `device_runner`. */
  runner_id?: string;
}

/** State presented for an enrolled developer device. */
export type RunnerState =
  | "ready"
  | "busy"
  | "offline"
  | "paused"
  | "unsupported";

/** Readiness reported for one explicitly registered repository. */
export interface RunnerRepositoryReadiness {
  /** GitHub `owner/repo` slug; never a local path. */
  repository: string;
  /** Whether the checkout can currently accept jobs. */
  ready: boolean;
  /** Actionable explanation when the checkout is not ready. */
  reason?: string;
}

/** Capabilities detected on a developer device. */
export interface RunnerCapabilities {
  /** Typed operations accepted by this protocol version. */
  operations: readonly ["kickstart", "denoise-task"];
  /** Agent harnesses found on the device. */
  harnesses: AgentHarness[];
  /** Whether the local Docker daemon is available. */
  docker: boolean;
}

/**
 * Public metadata for an enrolled developer device.
 *
 * Repository entries are GitHub `owner/repo` slugs. Local checkout paths are
 * deliberately absent from this server-facing contract.
 */
export interface RunnerRegistration {
  /** Opaque runner identifier. */
  id: string;
  /** Opaque identifier of the owning denoise user. */
  owner_id: string;
  /** Owner-selected device name. */
  display_name: string;
  /** Supported host operating system. */
  platform: "darwin" | "linux";
  /** Host architecture reported by Deno. */
  architecture: string;
  /** Installed dn semantic version. */
  dn_version: string;
  /** Negotiated runner protocol version. */
  protocol_version: RunnerProtocolVersion;
  /** Current device capabilities. */
  capabilities: RunnerCapabilities;
  /** Registered GitHub slugs without local paths. */
  repositories: string[];
  /** Current server-derived device state. */
  state: RunnerState;
  /** ISO-8601 time of the most recent accepted heartbeat. */
  last_seen_at: string;
}

/** Lifecycle status for a portable denoise task (not GitHub issue state). */
export type DenoiseTaskStatus =
  | "open"
  | "in_progress"
  | "done"
  | "cancelled";

/**
 * Portable Denoise Task document (schema v1).
 *
 * Matches the Spec (#422) JSON encoding without GitHub correlation fields —
 * free Void tasks must not require issue linkage.
 */
export interface DenoiseTaskDocument {
  /** Schema version for forward compatibility. */
  schema_version: "1.0";
  /** Stable task id for progress round-trip (Void ↔ runner ↔ UI). */
  id: string;
  /** Short title (maps to H1 in materialized markdown). */
  title: string;
  /** Spec / description the agent uses as primary context. */
  body: string;
  /** Task lifecycle status. */
  status: DenoiseTaskStatus;
  /** ISO-8601 time of the last local edit. */
  updated_at: string;
  /** Optional acceptance criteria the agent must honor. */
  acceptance_criteria?: string[];
  /** Portable tags (not GitHub labels). */
  tags?: string[];
  /**
   * Optional `owner/repo` slug for the runner's registered checkout map.
   * Never a local filesystem path on the wire.
   */
  repo_hint?: string;
  /** Last/current kickstart invocation id for progress correlation. */
  invocation_id?: string;
  /** Last/current device-runner job id. */
  runner_job_id?: string;
  /** ISO-8601 creation time. */
  created_at?: string;
}

const DENOISE_TASK_STATUSES: readonly DenoiseTaskStatus[] = [
  "open",
  "in_progress",
  "done",
  "cancelled",
];

/** Returns true when value is a valid {@link DenoiseTaskStatus}. */
export function isDenoiseTaskStatus(
  value: unknown,
): value is DenoiseTaskStatus {
  return typeof value === "string" &&
    (DENOISE_TASK_STATUSES as readonly string[]).includes(value);
}

/**
 * Validates a denoise task document against schema v1 required fields.
 *
 * @throws Error when the document is incomplete or malformed
 */
export function validateDenoiseTaskDocument(
  value: unknown,
): DenoiseTaskDocument {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("Denoise task document must be a JSON object.");
  }
  const task = value as Record<string, unknown>;
  if (task.schema_version !== "1.0") {
    throw new Error(
      'Denoise task document requires schema_version "1.0".',
    );
  }
  if (typeof task.id !== "string" || task.id.trim() === "") {
    throw new Error("Denoise task document must include a non-empty id.");
  }
  if (typeof task.title !== "string" || task.title.trim() === "") {
    throw new Error("Denoise task document must include a non-empty title.");
  }
  if (typeof task.body !== "string") {
    throw new Error("Denoise task document must include a body string.");
  }
  if (!isDenoiseTaskStatus(task.status)) {
    throw new Error(
      'Denoise task document status must be "open", "in_progress", "done", or "cancelled".',
    );
  }
  if (
    typeof task.updated_at !== "string" ||
    !Number.isFinite(Date.parse(task.updated_at))
  ) {
    throw new Error(
      "Denoise task document must include a valid updated_at timestamp.",
    );
  }
  if (
    task.acceptance_criteria !== undefined &&
    (!Array.isArray(task.acceptance_criteria) ||
      !task.acceptance_criteria.every((item) => typeof item === "string"))
  ) {
    throw new Error(
      "Denoise task acceptance_criteria must be an array of strings when present.",
    );
  }
  if (
    task.tags !== undefined &&
    (!Array.isArray(task.tags) ||
      !task.tags.every((item) => typeof item === "string"))
  ) {
    throw new Error(
      "Denoise task tags must be an array of strings when present.",
    );
  }
  if (task.repo_hint !== undefined && typeof task.repo_hint !== "string") {
    throw new Error("Denoise task repo_hint must be a string when present.");
  }
  if (
    task.invocation_id !== undefined && typeof task.invocation_id !== "string"
  ) {
    throw new Error(
      "Denoise task invocation_id must be a string when present.",
    );
  }
  if (
    task.runner_job_id !== undefined && typeof task.runner_job_id !== "string"
  ) {
    throw new Error(
      "Denoise task runner_job_id must be a string when present.",
    );
  }
  if (
    task.created_at !== undefined &&
    (typeof task.created_at !== "string" ||
      !Number.isFinite(Date.parse(task.created_at)))
  ) {
    throw new Error(
      "Denoise task created_at must be a valid timestamp when present.",
    );
  }
  return task as unknown as DenoiseTaskDocument;
}

/** Kickstart is the only remotely dispatchable operation in protocol v1. */
export interface RunnerKickstartOperation {
  /** Discriminator that prevents generic remote execution. */
  type: "kickstart";
  /** Canonical GitHub issue URL within the registered repository. */
  issue_url: string;
  /** Local publish behavior requested for kickstart. */
  publish: PublishMode;
  /** Installed local agent harness selected for the job. */
  agent: AgentHarness;
}

/** A denoise-task operation dispatched to a device runner. */
export interface RunnerDenoiseTaskOperation {
  /** Discriminator for denoise-task operations. */
  type: "denoise-task";
  /** Inline task document with no GitHub issue dependency. */
  task_document: DenoiseTaskDocument;
  /** Local publish behavior requested. */
  publish: PublishMode;
  /** Installed local agent harness selected for the job. */
  agent: AgentHarness;
}

/** Typed operation union reserved for future protocol additions. */
export type RunnerOperation =
  | RunnerKickstartOperation
  | RunnerDenoiseTaskOperation;

/** State of the renewable lease held by a device runner. */
export interface RunnerJobLease {
  /** Opaque lease identifier required for renewal. */
  id: string;
  /** ISO-8601 deadline after which the lease is lost. */
  expires_at: string;
  /** Whether the owner has requested cancellation. */
  cancel_requested: boolean;
}

/**
 * One server-created job offered to a device runner.
 *
 * Jobs contain typed fields only and can never carry argv, shell, environment,
 * or workflow definitions.
 */
export interface RunnerJob {
  /** Protocol version used to encode this job. */
  protocol_version: RunnerProtocolVersion;
  /** Opaque job identifier. */
  id: string;
  /** Existing kickstart progress/SSE correlation identifier. */
  invocation_id: string;
  /** Opaque target runner identifier. */
  runner_id: string;
  /** GitHub `owner/repo` slug for the registered checkout. */
  repository: string;
  /** Typed operation; kickstart only in protocol v1. */
  operation: RunnerOperation;
  /** ISO-8601 time at which the job was queued. */
  created_at: string;
  /** ISO-8601 offline queue expiration. */
  queued_until: string;
  /** ISO-8601 time at which the runner claimed the job. */
  claimed_at?: string;
  /** Renewable single-runner claim. */
  lease: RunnerJobLease;
}

/** Completion metadata sent after a local Kickstart process exits cleanly. */
export interface RunnerJobCompletion {
  /** ISO-8601 completion time. */
  completed_at: string;
  /** Wall-clock execution duration in milliseconds. */
  duration_ms: number;
  /** Rounded-up local execution minutes. */
  local_compute_minutes: number;
  /** Counted receipt for the local job. */
  hosted_runs_avoided: 1;
  /** Pull request created by publish mode, when available. */
  pr_url?: string;
}

/** Failure metadata sent after a claimed runner job stops. */
export interface RunnerJobFailure {
  /** ISO-8601 failure time. */
  failed_at: string;
  /** Terminal category controlling retry presentation. */
  reason: "failed" | "cancelled" | "interrupted";
  /** Safe human-readable failure summary. */
  message: string;
  /** Local process exit code, when a process started. */
  exit_code?: number;
}

/** Heartbeat body sent by the outbound-only runner loop. */
export interface RunnerHeartbeat {
  /** Protocol version spoken by the device. */
  protocol_version: RunnerProtocolVersion;
  /** Installed dn version. */
  dn_version: string;
  /** Capabilities detected without reading credentials. */
  capabilities: RunnerCapabilities;
  /** Slug-only readiness for explicitly trusted checkouts. */
  repositories: RunnerRepositoryReadiness[];
  /** Current local availability. */
  state: "ready" | "busy" | "paused";
}

/** Response returned when renewing a claimed job lease. */
export interface RunnerLeaseResponse {
  /** Renewed lease including current cancellation state. */
  lease: RunnerJobLease;
}

/** Response returned when creating a browser-approved pairing request. */
export interface RunnerPairingRequest {
  /** Opaque short-lived pairing identifier. */
  id: string;
  /** Browser URL at which the signed-in owner approves the device. */
  approval_url: string;
  /** ISO-8601 pairing expiration. */
  expires_at: string;
  /** Secret used only to poll this pairing request. */
  poll_token: string;
}

/** State returned while waiting for browser pairing approval. */
export interface RunnerPairingStatus {
  /** Current browser-approval state. */
  state: "pending" | "approved" | "expired" | "denied";
  /** One-time secret returned only after approval. */
  exchange_token?: string;
}

/** Credential returned exactly once after pairing approval. */
export interface RunnerPairingExchange {
  /** Newly enrolled runner metadata. */
  runner: RunnerRegistration;
  /** Plaintext runner credential returned exactly once. */
  credential: string;
  /** ISO-8601 credential expiration. */
  credential_expires_at: string;
}

/** New runner credential returned after authenticated rotation. */
export interface RunnerCredentialRotation {
  /** Replacement plaintext credential returned exactly once. */
  credential: string;
  /** ISO-8601 replacement credential expiration. */
  credential_expires_at: string;
}

/** One recent job shown by `dn runner jobs`. */
export interface RunnerJobSummary {
  /** Opaque job identifier. */
  id: string;
  /** Invocation correlation identifier. */
  invocation_id: string;
  /** GitHub repository slug. */
  repository: string;
  /** Typed operation requested by the owner. */
  operation: RunnerOperation;
  /** Current queue or terminal state. */
  state:
    | "queued"
    | "claimed"
    | "running"
    | "succeeded"
    | "failed"
    | "cancelled"
    | "interrupted";
  /** ISO-8601 queue time. */
  created_at: string;
  /** ISO-8601 execution start, when claimed. */
  started_at?: string;
  /** ISO-8601 terminal time, when finished. */
  completed_at?: string;
  /** Published pull request, when available. */
  pr_url?: string;
}

/** Server response for `dn runner status`. */
export interface RunnerStatusResponse {
  /** Owner-visible device metadata and state. */
  runner: RunnerRegistration;
  /** Currently claimed job, when busy. */
  active_job?: RunnerJobSummary;
}

/** Server response for `dn runner jobs`. */
export interface RunnerJobsResponse {
  /** Recent owner-visible jobs in server-defined order. */
  jobs: RunnerJobSummary[];
}

/** Request body used by `dn runner kickstart`. */
export interface RunnerKickstartRequest {
  /** Opaque target device identifier. */
  runner_id: string;
  /** Explicitly registered GitHub repository slug. */
  repository: string;
  /** Canonical issue URL within the repository. */
  issue_url: string;
  /** Requested local publish behavior. */
  publish: PublishMode;
}

/** Request body used by `dn runner kickstart --denoise-task`. */
export interface RunnerDenoiseTaskRequest {
  /** Opaque target device identifier. */
  runner_id: string;
  /** Optional GitHub repository slug (derived from task document if absent). */
  repository?: string;
  /** Inline denoise task document. */
  task_document: DenoiseTaskDocument;
  /** Requested local publish behavior. */
  publish: PublishMode;
}

/** Response returned after queueing a Kickstart job. */
export interface RunnerKickstartResponse {
  /** Existing invocation/SSE correlation identifier. */
  invocation_id: string;
  /** Opaque queued job identifier. */
  job_id: string;
  /** Initial server state. */
  state: "queued";
  /** ISO-8601 offline queue expiration. */
  expires_at: string;
}

/** Existing versioned progress event forwarded through the runner API. */
export interface RunnerProgressEvent {
  /** Progress schema version. */
  schema_version: "1.0";
  /** Invocation correlation identifier. */
  invocation_id: string;
  /** Monotonically increasing event sequence. */
  seq: number;
  /** ISO-8601 event time. */
  ts: string;
  /** Existing kickstart progress event discriminator. */
  type:
    | "invocation.queued"
    | "invocation.running"
    | "step.started"
    | "step.completed"
    | "phase.started"
    | "phase.completed"
    | "lint.completed"
    | "publish.completed"
    | "agent.line"
    | "invocation.succeeded"
    | "invocation.failed";
  /** Kickstart phase, when the event belongs to one. */
  phase?: "plan" | "implement" | "lint" | "publish";
  /** One-based kickstart step, when applicable. */
  step?: number;
  /** Redacted human-readable progress summary. */
  message: string;
  /** Denoise task id when the job is a denoise-task operation. */
  task_id?: string;
  /** Optional structured event metadata. */
  data?: Record<string, unknown>;
}

/** Returns true when a value is a supported runner protocol version. */
export function isSupportedRunnerProtocol(
  value: string,
): value is RunnerProtocolVersion {
  return value === RUNNER_PROTOCOL_VERSION;
}

/** Parses and validates a GitHub `owner/repo` slug. */
export function parseRepositorySlug(value: string): string {
  const normalized = value.trim();
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(normalized)) {
    throw new Error(
      `Invalid repository "${value}". Expected a GitHub owner/repo slug.`,
    );
  }
  return normalized;
}

/** Parses a GitHub issue URL and returns its normalized repository slug. */
export function repositoryFromIssueUrl(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`Invalid issue URL: ${value}`);
  }
  const match = url.pathname.match(
    /^\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)\/issues\/([1-9]\d*)\/?$/,
  );
  if (
    url.protocol !== "https:" || url.hostname !== "github.com" || !match
  ) {
    throw new Error(
      `Invalid issue URL "${value}". Expected https://github.com/owner/repo/issues/number.`,
    );
  }
  return `${match[1]}/${match[2]}`;
}

/** Extracts a repository slug from a denoise task document, or null if absent. */
export function repositoryFromDenoiseTask(
  task: DenoiseTaskDocument,
): string | null {
  const hint = task.repo_hint?.trim();
  return hint ? hint : null;
}

/** Materializes a denoise task document into plan-compatible markdown. */
export function denoiseTaskToMarkdown(task: DenoiseTaskDocument): string {
  const parts: string[] = [`# ${task.title}`, "", task.body];
  if (task.acceptance_criteria && task.acceptance_criteria.length > 0) {
    parts.push("", "## Acceptance Criteria", "");
    for (const criterion of task.acceptance_criteria) {
      parts.push(`- [ ] ${criterion}`);
    }
  }
  if (task.tags && task.tags.length > 0) {
    parts.push("", "## Tags", `\n${task.tags.join(", ")}`);
  }
  return parts.join("\n").trim();
}

/** Validates a claimed job before any local process is started. */
export function validateRunnerJob(
  job: RunnerJob,
  expectedRunnerId?: string,
): RunnerJob {
  if (!isSupportedRunnerProtocol(job.protocol_version)) {
    throw new Error(
      `Unsupported runner protocol "${job.protocol_version}". This dn supports ${RUNNER_PROTOCOL_VERSION}.`,
    );
  }
  if (!job.id || !job.invocation_id || !job.runner_id || !job.lease?.id) {
    throw new Error("Runner job is missing an opaque identifier or lease.");
  }
  if (expectedRunnerId && job.runner_id !== expectedRunnerId) {
    throw new Error("Runner job was issued to a different device.");
  }
  const repository = parseRepositorySlug(job.repository);
  if (job.operation.type === "denoise-task") {
    validateDenoiseTaskDocument(job.operation.task_document);
    if (
      job.operation.publish !== "none" &&
      job.operation.publish !== "pr" &&
      job.operation.publish !== "direct"
    ) {
      throw new Error(
        'Denoise-task jobs require publish "none", "pr", or "direct".',
      );
    }
    if (
      !["opencode", "cursor", "claude", "codex", "copilot"].includes(
        job.operation.agent,
      )
    ) {
      throw new Error("Runner job has an unsupported agent harness.");
    }
    const taskRepository = repositoryFromDenoiseTask(
      job.operation.task_document,
    );
    if (
      taskRepository &&
      taskRepository.toLowerCase() !== repository.toLowerCase()
    ) {
      throw new Error(
        `Runner job denoise-task belongs to ${taskRepository}, not ${repository}.`,
      );
    }
  } else if (job.operation.type === "kickstart") {
    if (
      job.operation.publish !== "none" &&
      job.operation.publish !== "pr" &&
      job.operation.publish !== "direct"
    ) {
      throw new Error(
        'Kickstart jobs require publish "none", "pr", or "direct".',
      );
    }
    if (
      !["opencode", "cursor", "claude", "codex", "copilot"].includes(
        job.operation.agent,
      )
    ) {
      throw new Error("Runner job has an unsupported agent harness.");
    }
    const issueRepository = repositoryFromIssueUrl(job.operation.issue_url);
    if (issueRepository.toLowerCase() !== repository.toLowerCase()) {
      throw new Error(
        `Runner job issue belongs to ${issueRepository}, not ${repository}.`,
      );
    }
  } else {
    throw new Error(
      "Runner protocol v1 only permits kickstart or denoise-task jobs.",
    );
  }
  if (
    !Number.isFinite(Date.parse(job.created_at)) ||
    !Number.isFinite(Date.parse(job.queued_until)) ||
    !Number.isFinite(Date.parse(job.lease.expires_at))
  ) {
    throw new Error("Runner job contains an invalid timestamp.");
  }
  return job;
}
