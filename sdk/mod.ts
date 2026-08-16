// Copyright 2026 Chesapeake Computing
// SPDX-License-Identifier: Apache-2.0

/**
 * @chesapeake/dn - Unified SDK for the dn monorepo
 *
 * This package combines authentication utilities, GitHub/VCS utilities,
 * archive utilities, and meld utilities into a single SDK.
 *
 * @module
 */

// ============================================================================
// Auth - Authentication utilities for OAuth and session management
// ============================================================================

// Auth Types
export type {
  AuthConfig,
  ChatMessage,
  GitHubCallbackResult,
  GitHubOAuthConfig,
  GoogleOAuthConfig,
  OAuthProvider,
  OAuthState,
  Session,
  User,
  UserInfo,
} from "./auth/types.ts";

// Tiered dn configuration
export {
  checkStrictRfcCorpus,
  DN_LEGACY_CONFIG_PATH,
  DN_REPOSITORY_CONFIG_PATH,
  enforceStrictRfcCorpus,
  isStrictRfcRequired,
  parseDnConfig,
  resolveDnConfig,
  resolveLocalAgentHarness,
  toActionsProjectionDocument,
  toDnActionsConfig,
  writeActionsConfigProjection,
} from "./config/mod.ts";
export type {
  DnActionsConfig,
  DnActionsProjectionDocument,
  DnConfigLayer,
  DnConfigSource,
  DnRfcConfig,
  DnRuntimeOverrides,
  DnStrictConfig,
  DnUserDefaults,
  DnUserRepoOverride,
  ResolvedDnConfig,
  ResolveDnConfigOptions,
  ResolveLocalAgentHarnessOptions,
  StrictRfcCheckResult,
  WriteActionsConfigProjectionOptions,
  WriteActionsConfigProjectionResult,
} from "./config/mod.ts";

// Session management
export {
  createSessionCookie,
  deleteSession,
  extractSessionId,
  getSessionFromCookie,
  storeSession,
} from "./auth/session.ts";

// GitHub OAuth
export {
  exchangeCodeForGitHubToken,
  getGitHubUser,
  handleGitHubAuth,
  handleGitHubCallback,
  handleGitHubSetup,
  initiateGitHubAuth,
  validateGitHubCallback,
} from "./auth/github.ts";
export type { InitiateGitHubAuthOptions } from "./auth/github.ts";

// Google OAuth
export {
  exchangeCodeForGoogleToken,
  getGoogleUser,
  handleGoogleAuth,
  handleGoogleCallback,
} from "./auth/google.ts";

// User management
export {
  createOrGetUser,
  handleGetUser,
  handleLogout,
  userHandler,
} from "./auth/user.ts";

// Chat
export { chatHandler } from "./auth/chat.ts";

// KV utilities
export { handleKvOperation } from "./auth/kv.ts";

// Auth handler class
import type { AuthConfig as _AuthConfig } from "./auth/types.ts";
import {
  handleGitHubAuth as _handleGitHubAuth,
  handleGitHubCallback as _handleGitHubCallback,
  handleGitHubSetup as _handleGitHubSetup,
} from "./auth/github.ts";
import {
  handleGoogleAuth as _handleGoogleAuth,
  handleGoogleCallback as _handleGoogleCallback,
} from "./auth/google.ts";
import {
  handleGetUser as _handleGetUser,
  handleLogout as _handleLogout,
} from "./auth/user.ts";

/**
 * Auth handler providing stable OAuth and session-backed endpoints.
 *
 * This class is the primary public entrypoint for authentication.
 * Method behavior and request/response shapes are stable across minor versions.
 */
export class AuthHandler {
  constructor(
    private kv: Deno.Kv,
    private config: _AuthConfig,
  ) {}

  /**
   * Initiates the GitHub OAuth flow.
   *
   * Guarantees:
   * - Returns an HTTP redirect response on success.
   * - Returns a JSON error response if GitHub OAuth is not configured.
   */
  handleGitHubAuth(req: Request): Promise<Response> {
    if (!this.config.github) {
      return Promise.resolve(
        new Response(JSON.stringify({ error: "GitHub OAuth not configured" }), {
          status: 500,
          headers: { "Content-Type": "application/json" },
        }),
      );
    }
    return _handleGitHubAuth(req, this.kv, this.config.github, this.config);
  }

  /**
   * Handles the GitHub OAuth callback.
   *
   * Guarantees:
   * - Establishes a user session on success.
   * - Returns a JSON error response if GitHub OAuth is not configured or fails.
   */
  handleGitHubCallback(req: Request): Promise<Response> {
    if (!this.config.github) {
      return Promise.resolve(
        new Response(JSON.stringify({ error: "GitHub OAuth not configured" }), {
          status: 500,
          headers: { "Content-Type": "application/json" },
        }),
      );
    }
    return _handleGitHubCallback(req, this.kv, this.config.github, this.config);
  }

  /**
   * Handles the GitHub App **Setup URL** redirect after installation.
   *
   * Register the route serving this handler as the GitHub App's *Setup URL*.
   * After the user installs the app, GitHub redirects here; the handler
   * validates the OAuth state and continues to the standard authorize URL.
   *
   * Guarantees:
   * - Returns an HTTP redirect to the OAuth authorize URL on success.
   * - Returns a 400 JSON error when the state is missing, invalid, or expired.
   * - Returns a 500 JSON error when GitHub OAuth is not configured.
   */
  handleGitHubSetup(req: Request): Promise<Response> {
    if (!this.config.github) {
      return Promise.resolve(
        new Response(JSON.stringify({ error: "GitHub OAuth not configured" }), {
          status: 500,
          headers: { "Content-Type": "application/json" },
        }),
      );
    }
    return _handleGitHubSetup(req, this.kv, this.config.github);
  }

  /**
   * Initiates the Google OAuth flow.
   *
   * Guarantees:
   * - Returns an HTTP redirect response on success.
   * - Returns a JSON error response if Google OAuth is not configured.
   */
  handleGoogleAuth(req: Request): Promise<Response> {
    if (!this.config.google) {
      return Promise.resolve(
        new Response(JSON.stringify({ error: "Google OAuth not configured" }), {
          status: 500,
          headers: { "Content-Type": "application/json" },
        }),
      );
    }
    return _handleGoogleAuth(req, this.kv, this.config.google, this.config);
  }

  /**
   * Handles the Google OAuth callback.
   *
   * Guarantees:
   * - Establishes a user session on success.
   * - Returns a JSON error response if Google OAuth is not configured or fails.
   */
  handleGoogleCallback(req: Request): Promise<Response> {
    if (!this.config.google) {
      return Promise.resolve(
        new Response(JSON.stringify({ error: "Google OAuth not configured" }), {
          status: 500,
          headers: { "Content-Type": "application/json" },
        }),
      );
    }
    return _handleGoogleCallback(req, this.kv, this.config.google, this.config);
  }

  /**
   * Returns the currently authenticated user.
   *
   * Guarantees:
   * - Returns user information when a valid session exists.
   * - Returns an unauthenticated response when no session is present.
   */
  handleGetUser(req: Request): Promise<Response> {
    return _handleGetUser(req, this.kv);
  }

  /**
   * Terminates the current user session.
   *
   * Guarantees:
   * - Session data is cleared.
   * - Response is always successful even if no session exists.
   */
  handleLogout(req: Request): Promise<Response> {
    return _handleLogout(req, this.kv);
  }
}

/**
 * Create an auth handler instance
 */
export function createAuthHandler(
  kv: Deno.Kv,
  config: _AuthConfig,
): AuthHandler {
  return new AuthHandler(kv, config);
}

// ============================================================================
// GitHub - GitHub API and VCS utilities
// ============================================================================

// Shared types
export type { Commit, Issue } from "./github/types.ts";
export type { AgentHarness } from "./github/agentHarness.ts";

// Issue CRUD types
export type {
  CommentResult,
  CreateIssueOptions,
  IssueComment,
  IssueListItem,
  IssueResult,
  IssueWithComments,
  ListIssuesOptions,
  UpdateIssueOptions,
} from "./github/types.ts";

// GitHub GraphQL API client
export {
  fetchCommits,
  fetchIssueFromUrl,
  fetchIssuesClosed,
  fetchIssuesOpened,
  getCurrentRepoFromRemote,
  getDefaultBranch,
  getIssueIdentifiers,
} from "./github/github-gql.ts";

// Issue CRUD operations
export {
  addIssueComment,
  closeIssue,
  createIssue,
  getIssueWithComments,
  listIssues,
  reopenIssue,
  updateIssue,
} from "./github/github-gql.ts";

// Issue relationship REST operations
export {
  addIssueBlockedBy,
  addSubIssue,
  removeIssueBlockedBy,
  removeSubIssue,
  reprioritizeSubIssue,
} from "./github/issueRelationships.ts";
export type {
  AddSubIssueOptions,
  ReprioritizeSubIssueOptions,
} from "./github/issueRelationships.ts";

// GitHub Actions workflow dispatch (REST)
export {
  dispatchRepositoryEvent,
  dispatchWorkflow,
  getWorkflow,
  getWorkflowFileContent,
  listWorkflowRuns,
  listWorkflows,
  parseWorkflowFields,
  parseWorkflowTriggers,
  resolveWorkflow,
  waitForRepositoryDispatchRun,
  workflowBase,
} from "./github/workflow.ts";
export type {
  DispatchWorkflowOptions,
  RepositoryDispatchResult,
  WorkflowDispatchInputs,
  WorkflowDispatchResult,
  WorkflowRunSummary,
  WorkflowState,
  WorkflowSummary,
  WorkflowTriggerInfo,
} from "./github/workflow.ts";

// Token resolution
export { resolveGitHubToken } from "./github/token.ts";

// GitHub REST API utilities
export { createPR } from "./github/github.ts";

// Issue utilities
export type {
  IssueData,
  IssueRelationshipReference,
  IssueRelationships,
  IssueRelationshipSummary,
  IssueStateValue,
} from "./github/issue.ts";
export {
  emptyIssueRelationships,
  fetchIssueFromUrl as fetchIssue,
  parseIssueFromFile,
  resolveIssueUrlInput,
  summarizeIssueForDisplay,
  writeIssueContext,
} from "./github/issue.ts";

// VCS utilities
export type { GitContext } from "./github/vcs.ts";
export type {
  PublishMode,
  PublishResult,
  StackMode,
} from "./github/publish.ts";
export {
  commitAndPush,
  commitStackArtifacts,
  detectVcs,
  prepareVcsForPublish,
  publishChanges,
  publishStackProgressUpdate,
} from "./github/vcs.ts";
export {
  assertPublishAllowedInCi,
  parsePublishMode,
  parseStackMode,
  resolveInitStackPublishMode,
  resolveKickstartPublishMode,
  resolveStackMode,
  writeGithubActionVcsOutputs,
} from "./github/publish.ts";

// Kickstart progress reporting
export type {
  AgentOutputStream,
  AgentStreamOptions,
  KickstartProgressEvent,
  KickstartProgressEventType,
  KickstartProgressSchemaVersion,
  ProgressEventInput,
  ProgressReporter,
} from "./github/progress.ts";
export {
  AGENT_FAILURE_TRUNCATE_CHARS,
  createProgressReporter,
  formatAgentFailureOutput,
  HttpReporter,
  NdjsonReporter,
  NullReporter,
  redactAgentOutput,
  streamAgentOutput,
} from "./github/progress.ts";

// OpenCode execution
export type { OpenCodeResult } from "./github/opencode.ts";
export { runOpenCode } from "./github/opencode.ts";

// ============================================================================
// Archive - Commit message derivation and VCS commit helpers (used by land)
// ============================================================================

export { commitStaged, commitWorkspace } from "./archive/commit.ts";
export { deriveCommitMessage } from "./archive/derive.ts";
export {
  formatCommitMessage,
  formatSummary,
  wrapBody,
} from "./archive/format.ts";
export type { CommitMessage } from "./archive/derive.ts";

// ============================================================================
// Land - Post-implementation commit phase
// ============================================================================

export { discoverPlanFile, discoverTestPlanFile } from "./land/discover.ts";
export { commitFiles, executeCommitPlan } from "./land/commit.ts";
export {
  extractLandJson,
  formatCommitPlanPreview,
  formatLandJsonParseError,
  LAND_JSON_PARSE_RECOVERY,
  parseCommitPlan,
} from "./land/parse.ts";
export { runLandPhase } from "./land/run.ts";
export { runLandSingle } from "./land/single.ts";
export type { LandCommitGroup, LandCommitPlan } from "./land/types.ts";

// ============================================================================
// Test plan - Compact ## Test Plan generation for GitHub issues (used by land)
// ============================================================================

export {
  normalizeTestPlanSection,
  upsertTestPlanSection,
} from "./testplan/section.ts";
export { resolveIssueRefFromPlan } from "./testplan/resolveIssue.ts";
export { runIssueTestPlan, runIssueTestPlanFromPlan } from "./testplan/run.ts";
export type {
  RunIssueTestPlanFromPlanOptions,
  RunIssueTestPlanOptions,
  RunIssueTestPlanResult,
} from "./testplan/run.ts";

// ============================================================================
// Meld - Meld utilities
// ============================================================================

export { deduplicateBlocks } from "./meld/deduplicate.ts";
export { ensureAcceptanceCriteriaSection } from "./meld/acceptance.ts";
export type { MeldMode } from "./meld/acceptance.ts";
export { mergeMarkdown } from "./meld/merge.ts";
export { normalizeMarkdown } from "./meld/normalize.ts";
export { isGitHubIssueUrl, resolveSource } from "./meld/resolve.ts";

// ============================================================================
// Workflows - Canonical GitHub Actions template utilities
// ============================================================================

export {
  computeSha256,
  extractDispatchPayloadError,
  installWorkflowTemplates,
  listWorkflowStatuses,
  loadWorkflowManifest,
  readWorkflowTemplate,
  removeRetiredTodoLoopWorkflow,
  repositoryDispatchEventType,
  resolveManifestTemplate,
  RETIRED_TODO_LOOP_WORKFLOW_REL_PATH,
  updateWorkflowTemplates,
  validateDispatchPayload,
  validateWorkflowInstallation,
  validateWorkflowManifest,
} from "./workflows/mod.ts";
export type {
  RepositoryDispatchClientPayload,
  WorkflowDispatchMode,
  WorkflowInstallStatus,
  WorkflowManifest,
  WorkflowPayloadContract,
  WorkflowPermission,
  WorkflowTemplateManifestEntry,
  WorkflowTemplateStatus,
  WorkflowTriggerContract,
  WorkflowValidationResult,
  WorkflowValidationWarning,
  WorkflowWriteResult,
} from "./workflows/mod.ts";

// ============================================================================
// Device runner - Denoise-native developer machine protocol and worker
// ============================================================================

export {
  buildRunnerDenoiseTaskCommand,
  buildRunnerKickstartCommand,
  checkRunnerRepositories,
  DEFAULT_DENOISE_API_URL,
  deleteRunnerCredential,
  denoiseTaskToMarkdown,
  detectRunnerCapabilities,
  doctorRunner,
  formatRunnerJobFailureMessage,
  formatRunnerJobOutcomeLog,
  formatRunnerServeLog,
  generateLaunchdService,
  generateRunnerService,
  generateSystemdService,
  getRunnerConfigPaths,
  inspectRunnerRepository,
  installRunnerService,
  isSupportedRunnerProtocol,
  loadRunnerConfig,
  loadRunnerCredential,
  MINIMUM_RUNNER_PROTOCOL_VERSION,
  parseRepositorySlug,
  parseRunnerProgressLine,
  registerRunnerRepository,
  repositoryFromDenoiseTask,
  repositoryFromIssueUrl,
  repositorySlugFromRemote,
  RUNNER_CONFIG_SCHEMA_VERSION,
  RUNNER_PROTOCOL_VERSION,
  RunnerApiClient,
  saveRunnerConfig,
  saveRunnerCredential,
  serveRunner,
  setRunnerPaused,
  stopRunnerService,
  uninstallRunnerService,
  unregisterRunnerRepository,
  validateDenoiseTaskDocument,
  validateRunnerJob,
} from "./runner/mod.ts";
export type {
  DenoiseTaskDocument,
  DenoiseTaskStatus,
  KickstartInvocationSource,
  KickstartRuntimeChoice,
  LocalRunnerConfig,
  LocalRunnerRepository,
  RunnerApiClientOptions,
  RunnerCapabilities,
  RunnerCommandProbe,
  RunnerConfigPaths,
  RunnerCredentialRotation,
  RunnerDenoiseTaskOperation,
  RunnerDenoiseTaskRequest,
  RunnerDoctorCheck,
  RunnerDoctorCredential,
  RunnerDoctorResult,
  RunnerHeartbeat,
  RunnerJob,
  RunnerJobCompletion,
  RunnerJobFailure,
  RunnerJobLease,
  RunnerJobRunResult,
  RunnerJobsResponse,
  RunnerJobSummary,
  RunnerKickstartOperation,
  RunnerKickstartRequest,
  RunnerKickstartResponse,
  RunnerLeaseResponse,
  RunnerOperation,
  RunnerPairingDevice,
  RunnerPairingExchange,
  RunnerPairingRequest,
  RunnerPairingStatus,
  RunnerProgressEvent,
  RunnerProtocolVersion,
  RunnerRegistration,
  RunnerRepositoryReadiness,
  RunnerServiceDefinition,
  RunnerServicePlatform,
  RunnerState,
  RunnerStatusResponse,
  RunnerWorkerClient,
  RunRunnerJobOptions,
  ServeRunnerOptions,
  StoredRunnerCredential,
} from "./runner/mod.ts";

// ============================================================================
// RFC - Request for Comments management
// ============================================================================

export {
  computeContentHash,
  createRfcContent,
  parseRfcMetadata,
  readRfc,
  readRfcIfExists,
  updateRfcContent,
  writeRfc,
} from "./rfc/parser.ts";
export {
  findRfc,
  getRfcDir,
  getStatePath,
  listRfcsFromState,
  loadState,
  readConfig,
  removeRfcFromState,
  saveState,
  updateRfcInState,
} from "./rfc/state.ts";
export {
  generateRfcFilename,
  isRfcStatus,
  isValidStatusTransition,
  parseRfcIdFromFilename,
  parseRfcSlugFromFilename,
  RFC_STATUSES,
} from "./rfc/types.ts";
export type { Rfc, RfcMetadata, RfcState, RfcStatus } from "./rfc/types.ts";
export type { RfcConfig, RfcRepoOptions } from "./rfc/state.ts";
