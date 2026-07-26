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
  operations: readonly ["kickstart"];
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

/** Typed operation union reserved for future protocol additions. */
export type RunnerOperation = RunnerKickstartOperation;

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
  if (job.operation.type !== "kickstart") {
    throw new Error("Runner protocol v1 only permits kickstart jobs.");
  }
  if (job.operation.publish !== "pr") {
    throw new Error("Runner jobs require PR publishing.");
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
  if (
    !Number.isFinite(Date.parse(job.created_at)) ||
    !Number.isFinite(Date.parse(job.queued_until)) ||
    !Number.isFinite(Date.parse(job.lease.expires_at))
  ) {
    throw new Error("Runner job contains an invalid timestamp.");
  }
  return job;
}
