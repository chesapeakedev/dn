// Copyright 2026 Chesapeake Computing
// SPDX-License-Identifier: Apache-2.0

/**
 * GitHub REST helpers for Actions workflow dispatch.
 *
 * Workflow listing and dispatch use the REST API; repository resolution and
 * default branch lookup remain in {@link github-gql.ts}.
 */

import { resolveGitHubToken } from "./token.ts";

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
