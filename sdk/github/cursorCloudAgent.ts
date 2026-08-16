// Copyright 2026 Chesapeake Computing
// SPDX-License-Identifier: Apache-2.0

import { createProgressReporter, type ProgressReporter } from "./progress.ts";
import { githubServerUrl, parseConfiguredIssueUrl } from "./endpoints.ts";

/** A repository cloned into a Cursor Cloud Agent VM. */
export interface CursorCloudRepository {
  /** HTTPS URL of the Git repository to clone. */
  url: string;
  /** Ref from which Cursor creates the agent workspace. */
  startingRef: string;
}

/** Options for starting a durable Cursor Cloud Agent run. */
export interface StartCursorCloudAgentOptions {
  /** Prompt delivered to the cloud agent. */
  prompt: string;
  /** Cursor API key. Defaults to `CURSOR_API_KEY`. */
  apiKey?: string;
  /** Repository to clone in the cloud VM. */
  repository: CursorCloudRepository;
  /** Create a pull request when the run completes. */
  autoCreatePr: boolean;
}

/** Minimal SDK boundary, kept injectable so tests never make cloud calls. */
export interface CursorCloudSdk {
  create(options: {
    apiKey: string;
    model: { id: "auto" };
    cloud: {
      repos: CursorCloudRepository[];
      autoCreatePR: boolean;
    };
  }): Promise<CursorCloudAgent>;
}

/** A durable Cursor cloud agent. */
export interface CursorCloudAgent {
  send(prompt: string): Promise<CursorCloudRun>;
  close?(): void;
}

/** Terminal status returned by `CursorCloudRun.wait()`. */
export type CursorCloudRunResultStatus = "finished" | "error" | "cancelled";

/** Git metadata returned when a cloud run finishes. */
export interface CursorCloudRunGitInfo {
  branches: Array<{
    repoUrl: string;
    branch?: string;
    prUrl?: string;
  }>;
}

/** Result of waiting for a Cursor cloud run to finish. */
export interface CursorCloudRunResult {
  id: string;
  status: CursorCloudRunResultStatus;
  error?: { message: string; code?: string };
  git?: CursorCloudRunGitInfo;
}

/** A cloud run returned immediately after it is queued. */
export interface CursorCloudRun {
  /** Durable run identifier. */
  id: string;
  /** Durable agent identifier. */
  agentId: string;
  /** Wait for the durable cloud run to reach a terminal status. */
  wait(): Promise<CursorCloudRunResult>;
}

/** Result of queuing a Cursor Cloud Agent run. */
export interface CursorCloudDispatchResult {
  /** Durable run identifier. */
  runId: string;
  /** Durable agent identifier. */
  agentId: string;
}

/** Outcome of a tracked Cursor Cloud Agent run (wait + progress path). */
export interface CursorCloudTrackedResult extends CursorCloudDispatchResult {
  /** Whether dn waited for the cloud run to finish. */
  waited: boolean;
  /** Terminal status when waited; absent for fire-and-forget. */
  status?: CursorCloudRunResultStatus;
  /** First PR URL discovered from run git metadata, when present. */
  prUrl?: string;
}

/** Default remote ref used when a cloud dispatch does not select one. */
export const DEFAULT_CURSOR_CLOUD_REF = "main";

/** Returns a repository URL when the input is a full GitHub issue URL. */
export function cursorCloudRepositoryUrlFromIssue(
  issueUrl: string | null,
): string | null {
  if (!issueUrl) return null;
  const issue = parseConfiguredIssueUrl(issueUrl);
  return issue ? githubServerUrl(`/${issue.owner}/${issue.repo}.git`) : null;
}

/** Validates and returns an explicitly selected Cursor cloud starting ref. */
export function parseCursorCloudRef(value: string | undefined): string {
  const ref = value?.trim();
  if (!ref || ref.startsWith("-") || /\s/.test(ref)) {
    throw new Error("--ref requires a non-empty Git ref without whitespace.");
  }
  return ref;
}

/** Builds the durable one-shot prompt for a full plan-and-implement workflow. */
export function buildCursorCloudKickstartPrompt(
  context: string,
  autoCreatePr: boolean,
  steeringPrompt?: string,
  contextFileSections?: string,
): string {
  const prInstruction = autoCreatePr
    ? "Create a pull request with the completed work."
    : "Do not create a pull request automatically; leave the completed work in the cloud agent workspace.";
  const includedSection = contextFileSections ?? "";
  const steeringSection = steeringPrompt === undefined
    ? ""
    : `\n\n---\n\n# Steering Prompt\n${steeringPrompt}`;
  return `You are running a dn kickstart task in a durable Cursor Cloud Agent. Work directly in the cloned repository and complete both phases below in this single run.

Phase 1 — Plan:
1. Read the repository's agent instructions and the task context.
2. Inspect the relevant code, tests, and documentation.
3. Form a concrete implementation and verification plan before editing files.

Phase 2 — Implement:
1. Execute the plan completely; do not stop after the planning phase.
2. Add or update tests for changed behavior.
3. Run the repository's required formatting, lint, typecheck, and test commands.
4. Review the final diff against the task context. ${prInstruction}

Task context:

${context}${includedSection}${steeringSection}`;
}

/** Builds the durable implementation prompt for an existing dn plan. */
export function buildCursorCloudLoopPrompt(
  plan: string,
  steeringPrompt?: string,
  contextFileSections?: string,
): string {
  const includedSection = contextFileSections ?? "";
  const steeringSection = steeringPrompt === undefined
    ? ""
    : `\n\n---\n\n# Steering Prompt\n${steeringPrompt}`;
  return `You are running the implementation phase of a dn loop task in a durable Cursor Cloud Agent. Work directly in the cloned repository. Review the plan, implement it completely, update tests and documentation as needed, run the repository's required checks, review the final diff against the plan, and create a pull request with the completed work.

Plan:

${plan}${includedSection}${steeringSection}`;
}

/**
 * Returns true when denoise-managed progress env is configured so dn should
 * wait for the Cursor cloud run and emit progress events.
 */
export function isCursorCloudProgressWaitEnabled(
  env: Record<string, string | undefined> = Deno.env.toObject(),
): boolean {
  if (!env.DN_DISPATCH_ID?.trim()) return false;
  if (env.DN_PROGRESS === "ndjson") return true;
  return env.DN_PROGRESS === "http" &&
    Boolean(env.DN_PROGRESS_URL?.trim()) &&
    Boolean(env.DN_PROGRESS_TOKEN?.trim());
}

/** Extracts the first PR URL from Cursor run git metadata. */
export function prUrlFromCursorCloudRunResult(
  result: CursorCloudRunResult,
): string | undefined {
  for (const branch of result.git?.branches ?? []) {
    const prUrl = branch.prUrl?.trim();
    if (prUrl) return prUrl;
  }
  return undefined;
}

async function loadCursorCloudSdk(): Promise<CursorCloudSdk> {
  const { Agent } = await import("@cursor/sdk");
  return {
    create: async (options) => {
      const agent = await Agent.create(options);
      return {
        send: (prompt) => agent.send(prompt),
        close: () => agent.close(),
      };
    },
  };
}

/** Returns the Cursor API key or raises a clear command-line error. */
export function requireCursorApiKey(
  apiKey = Deno.env.get("CURSOR_API_KEY"),
): string {
  if (!apiKey) {
    throw new Error(
      "CURSOR_API_KEY is required for --cursor-cloud. Create an API key in Cursor and set it in the environment.",
    );
  }
  return apiKey;
}

async function createCursorCloudRun(
  options: StartCursorCloudAgentOptions,
  sdk?: CursorCloudSdk,
): Promise<{ agent: CursorCloudAgent; run: CursorCloudRun }> {
  const apiKey = requireCursorApiKey(options.apiKey);
  if (!options.autoCreatePr) {
    throw new Error(
      "Cursor Cloud runs require PR publishing; non-PR cloud work is not durable in GitHub.",
    );
  }
  const resolvedSdk = sdk ?? await loadCursorCloudSdk();
  const agent = await resolvedSdk.create({
    apiKey,
    model: { id: "auto" },
    cloud: {
      repos: [options.repository],
      autoCreatePR: options.autoCreatePr,
    },
  });
  const run = await agent.send(options.prompt);
  return { agent, run };
}

/**
 * Queues a durable Cursor Cloud Agent run without waiting for it to finish.
 *
 * The cloud VM owns the repository clone, so this function intentionally does
 * not attempt to mirror remote file changes into the local dn workspace.
 */
export async function startCursorCloudAgent(
  options: StartCursorCloudAgentOptions,
  sdk?: CursorCloudSdk,
): Promise<CursorCloudDispatchResult> {
  const { agent, run } = await createCursorCloudRun(options, sdk);
  try {
    return { runId: run.id, agentId: run.agentId };
  } finally {
    agent.close?.();
  }
}

/**
 * Queues a Cursor Cloud Agent run and, when progress reporting is configured,
 * waits for completion while emitting denoise progress events.
 *
 * Without `DN_DISPATCH_ID` + `DN_PROGRESS`, behavior matches
 * {@link startCursorCloudAgent} (fire-and-forget).
 */
export async function runCursorCloudAgentTracked(
  options: StartCursorCloudAgentOptions,
  sdk?: CursorCloudSdk,
  env: Record<string, string | undefined> = Deno.env.toObject(),
  reporter: ProgressReporter = createProgressReporter(env),
): Promise<CursorCloudTrackedResult> {
  if (!isCursorCloudProgressWaitEnabled(env)) {
    const queued = await startCursorCloudAgent(options, sdk);
    return { ...queued, waited: false };
  }

  await reporter.report({
    type: "invocation.queued",
    message: "Cursor Cloud Agent kickstart queued",
  });
  await reporter.report({
    type: "invocation.running",
    message: "Cursor Cloud Agent kickstart running",
  });
  await reporter.report({
    type: "phase.started",
    phase: "implement",
    message: "Starting Cursor Cloud Agent",
  });

  let agent: CursorCloudAgent | undefined;
  let didReportFailure = false;
  try {
    const created = await createCursorCloudRun(options, sdk);
    agent = created.agent;
    const run = created.run;
    const dispatch: CursorCloudDispatchResult = {
      runId: run.id,
      agentId: run.agentId,
    };

    await reporter.report({
      type: "step.started",
      step: 1,
      message: `Waiting for Cursor Cloud Agent run ${run.id}`,
      data: {
        agent_id: run.agentId,
        run_id: run.id,
      },
    });

    const result = await run.wait();
    const prUrl = prUrlFromCursorCloudRunResult(result);

    await reporter.report({
      type: "step.completed",
      step: 1,
      message: `Cursor Cloud Agent run ${result.status}`,
      data: {
        agent_id: run.agentId,
        run_id: run.id,
        status: result.status,
        ...(prUrl === undefined ? {} : { pr_url: prUrl }),
      },
    });
    await reporter.report({
      type: "phase.completed",
      phase: "implement",
      message: "Cursor Cloud Agent finished",
    });

    if (result.status === "finished") {
      if (!prUrl) {
        throw new Error(
          "Cursor Cloud Agent finished without a pull request URL; verify automatic PR creation and repository permissions.",
        );
      }
      await reporter.report({
        type: "publish.completed",
        phase: "publish",
        message: "Cursor Cloud Agent published a pull request",
        data: { pr_url: prUrl },
      });
      await reporter.report({
        type: "invocation.succeeded",
        message: "Cursor Cloud Agent kickstart succeeded",
        data: {
          agent_id: run.agentId,
          run_id: run.id,
          pr_url: prUrl,
        },
      });
      return {
        ...dispatch,
        waited: true,
        status: result.status,
        prUrl,
      };
    }

    const failureMessage = result.error?.message ??
      `Cursor Cloud Agent run ${result.status}`;
    didReportFailure = true;
    await reporter.report({
      type: "invocation.failed",
      message: failureMessage,
      data: {
        agent_id: run.agentId,
        run_id: run.id,
        status: result.status,
      },
    });
    throw new Error(failureMessage);
  } catch (error) {
    if (!didReportFailure) {
      await reporter.report({
        type: "invocation.failed",
        message: error instanceof Error ? error.message : String(error),
      });
    }
    throw error;
  } finally {
    agent?.close?.();
  }
}
