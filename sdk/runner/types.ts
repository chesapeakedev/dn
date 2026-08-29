// Copyright 2026 Chesapeake Computing
// SPDX-License-Identifier: Apache-2.0

/**
 * Agent harness identifiers accepted on the runner wire.
 * Keep in sync with {@link AgentHarness} in `sdk/github/agentHarness.ts`.
 */
export type RunnerWireAgentHarness =
  | "opencode"
  | "cursor"
  | "claude"
  | "codex"
  | "copilot";

/**
 * Publish modes accepted on the runner wire.
 * Keep in sync with {@link PublishMode} in `sdk/github/publish.ts`.
 */
export type RunnerWirePublishMode = "none" | "pr" | "direct";

/** @deprecated Prefer {@link RunnerWireAgentHarness}; alias for local dn imports. */
export type AgentHarness = RunnerWireAgentHarness;

/** @deprecated Prefer {@link RunnerWirePublishMode}; alias for local dn imports. */
export type PublishMode = RunnerWirePublishMode;

/** Current version of the Denoise device-runner protocol. */
export const RUNNER_PROTOCOL_VERSION = "1.0" as const;

/** Oldest device-runner protocol this release of dn can speak. */
export const MINIMUM_RUNNER_PROTOCOL_VERSION = "1.0" as const;

/** Version identifiers accepted by this release of dn. */
export type RunnerProtocolVersion = typeof RUNNER_PROTOCOL_VERSION;

/**
 * How a denoise runner realizes “harness + dn against a repo somewhere.”
 *
 * Omitted `provider` on protocol 1.0 device registrations means {@link DEFAULT_RUNNER_PROVIDER}.
 */
export type RunnerProviderId = "device" | "github_actions" | "exe.dev";

/** Device protocol default when `provider` is omitted. */
export const DEFAULT_RUNNER_PROVIDER: RunnerProviderId = "device";

const RUNNER_PROVIDER_IDS: readonly RunnerProviderId[] = [
  "device",
  "github_actions",
  "exe.dev",
];

/** Sources from which Denoise can execute a Kickstart invocation. */
export type KickstartInvocationSource =
  | "github_actions"
  | "cursor_cloud"
  | "cloud_vm"
  | "local"
  | "device_runner"
  | "exe_dev";

/** A concrete runtime selected for a Kickstart invocation. */
export interface KickstartRuntimeChoice {
  /** Execution environment selected for the invocation. */
  source: KickstartInvocationSource;
  /**
   * Opaque runner identifier. Required for `device_runner` and `exe_dev`.
   * GitHub Actions uses a synthetic id `github_actions:{owner}/{repo}`.
   */
  runner_id?: string;
  /** Runner provider when the client already resolved it from the catalog. */
  provider?: RunnerProviderId;
}

/** State presented for an enrolled runner. */
export type RunnerState =
  | "ready"
  | "busy"
  | "offline"
  | "paused"
  | "unsupported"
  | "needs_setup";

/** Readiness reported for one explicitly registered repository. */
export interface RunnerRepositoryReadiness {
  /** GitHub `owner/repo` slug; never a local path. */
  repository: string;
  /** Whether the checkout can currently accept jobs. */
  ready: boolean;
  /** Actionable explanation when the checkout is not ready. */
  reason?: string;
}

/** Typed capability tokens advertised by a device runner. */
export type RunnerCapabilityOperation =
  | "kickstart"
  | "denoise-task"
  | "task-sync"
  | "land"
  | "sync"
  | "plan"
  | "loop";

/** Capabilities detected on a developer device. */
export interface RunnerCapabilities {
  /**
   * Typed operations accepted by this protocol version.
   * `task-sync` enables Void ↔ ~/.dn/tasks/ relay via heartbeat.
   */
  operations: readonly RunnerCapabilityOperation[];
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
  /**
   * How this runner executes jobs. Omitted values mean {@link DEFAULT_RUNNER_PROVIDER}.
   */
  provider?: RunnerProviderId;
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

/** Kickstart job dispatched to a device runner. */
export interface RunnerKickstartOperation {
  /** Discriminator that prevents generic remote execution. */
  type: "kickstart";
  /** Canonical GitHub issue URL within the registered repository. */
  issue_url: string;
  /** Local publish behavior requested for kickstart. */
  publish: PublishMode;
  /** Installed local agent harness selected for the job. */
  agent: AgentHarness;
  /** Stop after the plan phase so Denoise can collect a reviewable artifact. */
  pause_after?: "plan";
  /** Skip plan generation and implement from an existing plan. */
  skip_plan?: boolean;
}

/** Implement an already-reviewed plan with `dn loop`. */
export interface RunnerLoopOperation {
  /** Discriminator for loop (implement) operations. */
  type: "loop";
  /** Canonical GitHub issue URL used to correlate the plan. */
  issue_url: string;
  /** Installed local agent harness selected for the job. */
  agent: AgentHarness;
  /** Local publish behavior requested for implement. */
  publish: PublishMode;
  /** Optional repo-relative plan path (`plans/*.plan.md`). Never a local filesystem path. */
  plan_file?: string;
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

/** Close out a completed kickstart on the paired checkout with `dn land`. */
export interface RunnerLandOperation {
  /** Discriminator for land operations. */
  type: "land";
  /** Canonical GitHub issue URL used to correlate the plan. */
  issue_url: string;
  /** Installed local agent harness selected for the job. */
  agent: AgentHarness;
  /** Optional repo-relative plan path (`plans/*.plan.md`). Never a local filesystem path. */
  plan_file?: string;
}

/** Publish landed commits on the paired checkout with `dn sync`. */
export interface RunnerSyncOperation {
  /** Discriminator for sync operations. */
  type: "sync";
  /** Canonical GitHub issue URL used to correlate the landed work. */
  issue_url: string;
}

/** Typed operation union reserved for future protocol additions. */
export type RunnerOperation =
  | RunnerKickstartOperation
  | RunnerDenoiseTaskOperation
  | RunnerLandOperation
  | RunnerSyncOperation
  | RunnerLoopOperation;

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
  /** Typed operation (kickstart, plan/loop, land, sync, or denoise-task). */
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

/** One pending task CRUD envelope relayed Void → denoise → device. */
export interface RunnerTaskSyncOp {
  /** Opaque envelope id; ACK this after applying locally. */
  id: string;
  /** Mutation kind. */
  op: "upsert" | "delete";
  /** Stable Denoise task id. */
  task_id: string;
  /** Required for upsert; omitted for delete. */
  task_document?: DenoiseTaskDocument;
  /** ISO-8601 enqueue time on denoise. */
  created_at: string;
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
  /** Envelope ids successfully applied since the previous heartbeat. */
  task_sync_acks?: string[];
  /**
   * Local task snapshot when fulfilling an owner list request
   * (`list_tasks_requested` on the previous heartbeat response).
   */
  task_list?: DenoiseTaskDocument[];
  /**
   * When true, Denoise may return a replacement bearer on this heartbeat.
   * Older clients omit the field and keep sliding expiry without rotation.
   */
  accepts_credential_rotation?: boolean;
}

/** Server response body for runner heartbeats (task-sync channel). */
export interface RunnerHeartbeatResponse {
  /** Pending CRUD envelopes for ~/.dn/tasks/ (empty when none). */
  pending_task_ops: RunnerTaskSyncOp[];
  /** When true, include `task_list` on the next heartbeat. */
  list_tasks_requested: boolean;
  /**
   * Current idle expiry after this heartbeat. Persist so local doctor/state
   * matches the sliding server TTL.
   */
  credential_expires_at?: string;
  /**
   * Replacement plaintext bearer when Denoise rotated the secret. Persist and
   * use on subsequent requests. Omitted when the current secret is still fresh.
   */
  credential?: string;
}

/** Owner session request to push or delete a local task on a paired runner. */
export interface RunnerOwnerTaskMutationRequest {
  /** Opaque paired runner id. */
  runner_id: string;
  /** Mutation kind. */
  op: "upsert" | "delete";
  /** Required for delete; also validated against document.id on upsert. */
  task_id?: string;
  /** Required for upsert. */
  task_document?: DenoiseTaskDocument;
}

/** Owner session response after enqueueing a task mutation. */
export interface RunnerOwnerTaskMutationResponse {
  /** Pending envelope id. */
  envelope_id: string;
  /** ISO-8601 expiration of the pending envelope. */
  expires_at: string;
}

/** Owner session response for a device task list pull. */
export interface RunnerOwnerTaskListResponse {
  /** Tasks reported by the paired device. */
  tasks: DenoiseTaskDocument[];
  /** ISO-8601 time the device snapshot was received. */
  synced_at: string;
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

/** Returns true when a value is a known {@link RunnerProviderId}. */
export function isRunnerProviderId(
  value: string,
): value is RunnerProviderId {
  return (RUNNER_PROVIDER_IDS as readonly string[]).includes(value);
}

/**
 * Resolves a runner provider, defaulting omitted or unknown values to
 * {@link DEFAULT_RUNNER_PROVIDER}.
 */
export function resolveRunnerProvider(
  value?: string | null,
): RunnerProviderId {
  if (value != null && isRunnerProviderId(value)) return value;
  return DEFAULT_RUNNER_PROVIDER;
}

/**
 * Maps a runner provider to the kickstart invocation source stored on progress
 * records. `cloud_vm` remains a historical alias for exe.dev.
 */
export function kickstartSourceFromProvider(
  provider: RunnerProviderId,
): KickstartInvocationSource {
  if (provider === "github_actions") return "github_actions";
  if (provider === "exe.dev") return "exe_dev";
  return "device_runner";
}

/**
 * Maps a kickstart invocation source to a runner provider.
 * Historical `cloud_vm` maps to exe.dev. `local` and `cursor_cloud` have no
 * runner provider.
 */
export function runnerProviderFromSource(
  source: KickstartInvocationSource,
): RunnerProviderId | null {
  if (source === "github_actions") return "github_actions";
  if (source === "exe_dev" || source === "cloud_vm") return "exe.dev";
  if (source === "device_runner") return "device";
  return null;
}

/** Synthetic runner id for GitHub Actions on a planning repository. */
export function githubActionsRunnerId(owner: string, repo: string): string {
  return `github_actions:${owner}/${repo}`;
}

/**
 * Parses a synthetic GitHub Actions runner id.
 *
 * @returns owner and repo when `runnerId` is `github_actions:{owner}/{repo}`
 */
export function parseGithubActionsRunnerId(
  runnerId: string,
): { owner: string; repo: string } | null {
  const prefix = "github_actions:";
  if (!runnerId.startsWith(prefix)) return null;
  const slug = runnerId.slice(prefix.length);
  try {
    const normalized = parseRepositorySlug(slug);
    const slash = normalized.indexOf("/");
    return {
      owner: normalized.slice(0, slash),
      repo: normalized.slice(slash + 1),
    };
  } catch {
    return null;
  }
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

function assertIssueUrlMatchesRepository(
  issueUrl: string,
  repository: string,
): void {
  const issueRepository = repositoryFromIssueUrl(issueUrl);
  if (issueRepository.toLowerCase() !== repository.toLowerCase()) {
    throw new Error(
      `Runner job issue belongs to ${issueRepository}, not ${repository}.`,
    );
  }
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
    if (
      job.operation.pause_after != null && job.operation.pause_after !== "plan"
    ) {
      throw new Error('Kickstart jobs require pause_after "plan" when set.');
    }
    if (
      job.operation.skip_plan === true && job.operation.pause_after === "plan"
    ) {
      throw new Error(
        "Kickstart jobs cannot combine skip_plan with pause_after.",
      );
    }
    repositoryFromIssueUrl(job.operation.issue_url);
    assertIssueUrlMatchesRepository(job.operation.issue_url, repository);
  } else if (job.operation.type === "loop") {
    if (
      job.operation.publish !== "none" &&
      job.operation.publish !== "pr" &&
      job.operation.publish !== "direct"
    ) {
      throw new Error(
        'Loop jobs require publish "none", "pr", or "direct".',
      );
    }
    if (
      !["opencode", "cursor", "claude", "codex", "copilot"].includes(
        job.operation.agent,
      )
    ) {
      throw new Error("Runner job has an unsupported agent harness.");
    }
    repositoryFromIssueUrl(job.operation.issue_url);
    assertIssueUrlMatchesRepository(job.operation.issue_url, repository);
    if (
      job.operation.plan_file != null &&
      !/^plans\/[^/]+\.plan\.md$/.test(job.operation.plan_file)
    ) {
      throw new Error(
        "Loop jobs require a repo-relative plans/*.plan.md path when plan_file is set.",
      );
    }
  } else if (job.operation.type === "land") {
    if (
      !["opencode", "cursor", "claude", "codex", "copilot"].includes(
        job.operation.agent,
      )
    ) {
      throw new Error("Runner job has an unsupported agent harness.");
    }
    repositoryFromIssueUrl(job.operation.issue_url);
    assertIssueUrlMatchesRepository(job.operation.issue_url, repository);
    if (
      job.operation.plan_file != null &&
      !/^plans\/[^/]+\.plan\.md$/.test(job.operation.plan_file)
    ) {
      throw new Error(
        "Land jobs require a repo-relative plans/*.plan.md path when plan_file is set.",
      );
    }
  } else if (job.operation.type === "sync") {
    repositoryFromIssueUrl(job.operation.issue_url);
    assertIssueUrlMatchesRepository(job.operation.issue_url, repository);
  } else {
    throw new Error(
      "Runner protocol v1 only permits kickstart, loop, denoise-task, land, or sync jobs.",
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
