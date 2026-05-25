// Copyright 2026 Chesapeake Computing
// SPDX-License-Identifier: Apache-2.0

/**
 * GitHub REST helpers for Actions workflow dispatch.
 *
 * Workflow listing and dispatch use the REST API; repository resolution and
 * default branch lookup remain in {@link github-gql.ts}.
 */

import { resolveGitHubToken } from "./token.ts";
import type { RepositoryDispatchClientPayload } from "../workflows/dispatch.ts";

export type { RepositoryDispatchClientPayload };

const GITHUB_API_BASE = "https://api.github.com";

/** Workflow state returned by the GitHub Actions API. */
export type WorkflowState =
  | "active"
  | "deleted"
  | "disabled_fork"
  | "disabled_inactivity"
  | "disabled_manually";

/**
 * Summary of a workflow in a repository.
 */
export interface WorkflowSummary {
  /** Numeric workflow ID used for dispatch. */
  id: number;
  /** Display name from the workflow file. */
  name: string;
  /** Path in the repository (e.g. `.github/workflows/ci.yml`). */
  path: string;
  /** Whether the workflow is active and can be dispatched. */
  state: WorkflowState;
}

/**
 * String key/value inputs for a `workflow_dispatch` event.
 */
export type WorkflowDispatchInputs = Record<string, string>;

/**
 * Result of creating a `repository_dispatch` event (204 No Content).
 */
export interface RepositoryDispatchResult {
  /** Event type sent to the dispatches API. */
  eventType: string;
  /** Correlation id from client_payload when present. */
  dispatchId?: string;
}

/**
 * Summary of a workflow run from the Actions API.
 */
export interface WorkflowRunSummary {
  /** Numeric run id. */
  id: number;
  /** Browser URL for the run. */
  htmlUrl: string;
  /** ISO 8601 creation timestamp. */
  createdAt: string;
  /** Workflow display name. */
  name: string;
  /** Event that triggered the run. */
  event: string;
}

/**
 * Parsed trigger declarations from a workflow file.
 */
export interface WorkflowTriggerInfo {
  /** Whether the workflow declares `on.workflow_dispatch`. */
  workflow_dispatch: boolean;
  /** `repository_dispatch` event type names. */
  repository_dispatch: string[];
}

/**
 * Result of triggering a workflow dispatch when run details are returned.
 */
export interface WorkflowDispatchResult {
  /** Database ID of the created workflow run, when available. */
  workflowRunId?: number;
  /** API URL for the workflow run. */
  runUrl?: string;
  /** Browser URL for the workflow run. */
  htmlUrl?: string;
}

/**
 * Options for {@link dispatchWorkflow}.
 */
export interface DispatchWorkflowOptions {
  /** Branch or tag containing the workflow file version to run. */
  ref: string;
  /** Inputs defined in the workflow's `workflow_dispatch` block. */
  inputs?: WorkflowDispatchInputs;
}

interface WorkflowsPayload {
  total_count: number;
  workflows: WorkflowSummary[];
}

interface DispatchResponseBody {
  workflow_run_id?: number;
  run_url?: string;
  html_url?: string;
}

interface WorkflowRunsPayload {
  total_count: number;
  workflow_runs: Array<{
    id: number;
    html_url: string;
    created_at: string;
    name: string;
    event: string;
  }>;
}

interface ContentsPayload {
  content?: string;
  encoding?: string;
}

function buildHeaders(token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "Content-Type": "application/json",
    "X-GitHub-Api-Version": "2022-11-28",
  };
}

async function request<T>(
  path: string,
  options: {
    method?: "GET" | "POST";
    body?: unknown;
  } = {},
): Promise<{ data: T; status: number }> {
  const token = await resolveGitHubToken();
  const response = await fetch(`${GITHUB_API_BASE}${path}`, {
    method: options.method ?? "GET",
    headers: buildHeaders(token),
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });

  if (!response.ok) {
    const errorBody = await response.text().catch(() => "");
    throw new Error(
      `GitHub API request failed (${response.status} ${response.statusText}): ${errorBody}`,
    );
  }

  if (response.status === 204) {
    return { data: undefined as T, status: 204 };
  }

  const text = await response.text();
  if (!text) {
    return { data: undefined as T, status: response.status };
  }

  return { data: JSON.parse(text) as T, status: response.status };
}

/**
 * Returns the basename of a workflow path (e.g. `ci.yml` from `.github/workflows/ci.yml`).
 */
export function workflowBase(path: string): string {
  const parts = path.split("/");
  return parts[parts.length - 1] ?? path;
}

function isWorkflowFile(selector: string): boolean {
  const lower = selector.toLowerCase();
  return lower.endsWith(".yml") || lower.endsWith(".yaml");
}

function isNumericId(selector: string): boolean {
  return /^\d+$/.test(selector);
}

/**
 * List workflows in a repository, optionally limited to a maximum count.
 *
 * @param owner - Repository owner
 * @param repo - Repository name
 * @param limit - Maximum workflows to return; `0` means all pages
 */
export async function listWorkflows(
  owner: string,
  repo: string,
  limit = 0,
): Promise<WorkflowSummary[]> {
  const workflows: WorkflowSummary[] = [];
  let page = 1;
  const perPage = limit > 0 && limit <= 100 ? limit : 100;

  while (true) {
    if (limit > 0 && workflows.length >= limit) {
      break;
    }

    const { data } = await request<WorkflowsPayload>(
      `/repos/${owner}/${repo}/actions/workflows?per_page=${perPage}&page=${page}`,
    );

    for (const workflow of data.workflows) {
      workflows.push(workflow);
      if (limit > 0 && workflows.length >= limit) {
        return workflows;
      }
    }

    if (data.workflows.length < perPage) {
      break;
    }
    page++;
  }

  return workflows;
}

/**
 * Fetch a single workflow by numeric ID or workflow file name/path.
 *
 * @param owner - Repository owner
 * @param repo - Repository name
 * @param workflowId - Numeric ID or filename (e.g. `release.yml`)
 */
export async function getWorkflow(
  owner: string,
  repo: string,
  workflowId: string | number,
): Promise<WorkflowSummary> {
  const id = encodeURIComponent(String(workflowId));
  const { data } = await request<WorkflowSummary>(
    `/repos/${owner}/${repo}/actions/workflows/${id}`,
  );
  return data;
}

/**
 * Resolve a workflow selector to exactly one active workflow.
 *
 * Accepts a numeric ID, workflow filename (`.yml`/`.yaml`), or display name.
 * Only workflows in the `active` state are considered when matching by name.
 *
 * @throws Error when no workflow matches or multiple workflows share the name
 */
export async function resolveWorkflow(
  owner: string,
  repo: string,
  selector: string,
): Promise<WorkflowSummary> {
  if (!selector) {
    throw new Error("empty workflow selector");
  }

  if (isNumericId(selector) || isWorkflowFile(selector)) {
    try {
      return await getWorkflow(owner, repo, selector);
    } catch (error) {
      if (error instanceof Error && error.message.includes("404")) {
        throw new Error(
          `workflow ${selector} not found on the default branch`,
        );
      }
      throw error;
    }
  }

  const workflows = await listWorkflows(owner, repo, 0);
  const matches = workflows.filter(
    (w) =>
      w.state === "active" && w.name.toLowerCase() === selector.toLowerCase(),
  );

  if (matches.length === 0) {
    throw new Error(`could not find any workflows named ${selector}`);
  }

  if (matches.length === 1) {
    return matches[0];
  }

  const names = matches.map((w) => workflowBase(w.path)).join(" ");
  throw new Error(
    `could not resolve to a unique workflow; found:${names}`,
  );
}

/**
 * Trigger a `workflow_dispatch` event for a workflow.
 *
 * @param owner - Repository owner
 * @param repo - Repository name
 * @param workflowId - Numeric workflow ID from {@link WorkflowSummary.id}
 * @param options - Ref and optional inputs
 */
/**
 * Parse supported triggers from a workflow YAML file.
 */
export function parseWorkflowTriggers(content: string): WorkflowTriggerInfo {
  const workflow_dispatch = /\bworkflow_dispatch\s*:/m.test(content);
  const repository_dispatch: string[] = [];

  const typesBlock = content.match(
    /repository_dispatch:\s*\n\s+types:\s*\[([^\]]*)\]/m,
  );
  if (typesBlock) {
    const inner = typesBlock[1];
    for (const segment of inner.split(",")) {
      const trimmed = segment.trim();
      const quoted = trimmed.match(/^["']([^"']+)["']$/);
      if (quoted) {
        repository_dispatch.push(quoted[1]);
        continue;
      }
      if (/^[\w.-]+$/.test(trimmed)) {
        repository_dispatch.push(trimmed);
      }
    }
  }

  return { workflow_dispatch, repository_dispatch };
}

/**
 * Fetch a workflow file from a repository at a given ref.
 */
export async function getWorkflowFileContent(
  owner: string,
  repo: string,
  path: string,
  ref: string,
): Promise<string> {
  const encodedPath = path.split("/").map(encodeURIComponent).join("/");
  const { data } = await request<ContentsPayload>(
    `/repos/${owner}/${repo}/contents/${encodedPath}?ref=${
      encodeURIComponent(ref)
    }`,
  );

  if (!data.content || data.encoding !== "base64") {
    throw new Error(`could not read workflow file ${path} at ${ref}`);
  }

  const bytes = Uint8Array.from(
    atob(data.content.replace(/\n/g, "")),
    (c) => c.charCodeAt(0),
  );
  return new TextDecoder().decode(bytes);
}

/**
 * Create a `repository_dispatch` event for a repository.
 */
export async function dispatchRepositoryEvent(
  owner: string,
  repo: string,
  eventType: string,
  clientPayload: RepositoryDispatchClientPayload,
): Promise<RepositoryDispatchResult> {
  await request<undefined>(
    `/repos/${owner}/${repo}/dispatches`,
    {
      method: "POST",
      body: {
        event_type: eventType,
        client_payload: clientPayload,
      },
    },
  );

  const dispatchId = typeof clientPayload.dispatch_id === "string"
    ? clientPayload.dispatch_id
    : clientPayload.dispatch_id !== undefined
    ? String(clientPayload.dispatch_id)
    : undefined;

  return { eventType, dispatchId };
}

/**
 * List recent workflow runs, optionally filtered by event name.
 */
export async function listWorkflowRuns(
  owner: string,
  repo: string,
  options: { event?: string; perPage?: number } = {},
): Promise<WorkflowRunSummary[]> {
  const perPage = options.perPage ?? 10;
  let path = `/repos/${owner}/${repo}/actions/runs?per_page=${perPage}`;
  if (options.event) {
    path += `&event=${encodeURIComponent(options.event)}`;
  }

  const { data } = await request<WorkflowRunsPayload>(path);
  return data.workflow_runs.map((run) => ({
    id: run.id,
    htmlUrl: run.html_url,
    createdAt: run.created_at,
    name: run.name,
    event: run.event,
  }));
}

/**
 * Poll until a workflow run appears after a repository dispatch.
 *
 * Returns the newest run created at or after `notBefore`, when one exists.
 */
export async function waitForRepositoryDispatchRun(
  owner: string,
  repo: string,
  notBefore: Date,
  options: { timeoutMs?: number; intervalMs?: number } = {},
): Promise<WorkflowRunSummary | undefined> {
  const timeoutMs = options.timeoutMs ?? 120_000;
  const intervalMs = options.intervalMs ?? 3_000;
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const runs = await listWorkflowRuns(owner, repo, {
      event: "repository_dispatch",
      perPage: 5,
    });
    const match = runs.find((run) =>
      new Date(run.createdAt).getTime() >= notBefore.getTime()
    );
    if (match) {
      return match;
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }

  return undefined;
}

export async function dispatchWorkflow(
  owner: string,
  repo: string,
  workflowId: number,
  options: DispatchWorkflowOptions,
): Promise<WorkflowDispatchResult> {
  const { data, status } = await request<DispatchResponseBody>(
    `/repos/${owner}/${repo}/actions/workflows/${workflowId}/dispatches`,
    {
      method: "POST",
      body: {
        ref: options.ref,
        inputs: options.inputs ?? {},
        return_run_details: true,
      },
    },
  );

  if (status === 204 || !data) {
    return {};
  }

  return {
    workflowRunId: data.workflow_run_id,
    runUrl: data.run_url,
    htmlUrl: data.html_url,
  };
}

/**
 * Parse `key=value` field flags into a map of workflow inputs.
 *
 * @param rawFields - Values from `-f` / `--raw-field` (used as-is)
 * @param magicFields - Values from `-F` / `--field` (`@path` reads file contents)
 * @param readFile - Called when a magic field value starts with `@`
 */
export function parseWorkflowFields(
  rawFields: string[],
  magicFields: string[],
  readFile: (path: string) => Promise<string>,
): Promise<WorkflowDispatchInputs> {
  return parseFieldsInternal(rawFields, magicFields, readFile);
}

async function parseFieldsInternal(
  rawFields: string[],
  magicFields: string[],
  readFile: (path: string) => Promise<string>,
): Promise<WorkflowDispatchInputs> {
  const params: WorkflowDispatchInputs = {};

  for (const f of rawFields) {
    const { key, value } = parseField(f);
    params[key] = value;
  }

  for (const f of magicFields) {
    const { key, value: rawValue } = parseField(f);
    params[key] = await expandMagicFieldValue(rawValue, readFile);
  }

  return params;
}

function parseField(f: string): { key: string; value: string } {
  const idx = f.indexOf("=");
  if (idx === -1) {
    throw new Error(
      `field ${JSON.stringify(f)} requires a value separated by an '=' sign`,
    );
  }
  return { key: f.slice(0, idx), value: f.slice(idx + 1) };
}

async function expandMagicFieldValue(
  value: string,
  readFile: (path: string) => Promise<string>,
): Promise<string> {
  if (value.startsWith("@")) {
    return await readFile(value.slice(1));
  }
  return value;
}
