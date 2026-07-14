// Copyright 2026 Chesapeake Computing
// SPDX-License-Identifier: Apache-2.0

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
}

/** A cloud run returned immediately after it is queued. */
export interface CursorCloudRun {
  /** Durable run identifier. */
  id: string;
  /** Durable agent identifier. */
  agentId: string;
}

/** Result of queuing a Cursor Cloud Agent run. */
export interface CursorCloudDispatchResult {
  /** Durable run identifier. */
  runId: string;
  /** Durable agent identifier. */
  agentId: string;
}

async function loadCursorCloudSdk(): Promise<CursorCloudSdk> {
  const { Agent } = await import("@cursor/sdk");
  return { create: (options) => Agent.create(options) };
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
  const apiKey = requireCursorApiKey(options.apiKey);

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
  return { runId: run.id, agentId: run.agentId };
}
