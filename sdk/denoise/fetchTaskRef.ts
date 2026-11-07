// Copyright 2026 Chesapeake Computing
// SPDX-License-Identifier: Apache-2.0

/**
 * Denoise HTTP client for milestone task refs.
 *
 * Used by `dn kickstart <denoise-task-url>` after {@link parseDenoiseTaskUrl}.
 * Requires a GitHub token (`resolveGitHubToken`) mapped to a Denoise account.
 */

import { DEFAULT_DENOISE_API_URL } from "../runner/client.ts";
import type { ParsedDenoiseTaskUrl } from "./taskUrl.ts";

/** GitHub issue linked to the task; kickstart should use this URL when present. */
export interface DenoiseTaskRefGitHubIssue {
  owner: string;
  repo: string;
  number: number;
  url: string;
}

/** JSON body from Denoise task ref GET routes. */
export interface DenoiseTaskRefResponse {
  milestone_id: string;
  task_id: string;
  canonical_url: string;
  short_code?: string;
  task_path?: string;
  legacy_path?: string;
  task_document: {
    schema_version: "1.0";
    id: string;
    title: string;
    body: string;
    status: "open" | "in_progress" | "done" | "cancelled";
    updated_at: string;
    created_at?: string;
    tags?: string[];
    repo_hint?: string;
  };
  github_issue?: DenoiseTaskRefGitHubIssue;
  /** Canonical issue URL (`meta.github_url`) when linked. */
  github_url?: string;
  repo_hint?: string;
}

export interface FetchDenoiseTaskRefOptions {
  githubToken: string;
  /** Injectable for tests. */
  fetch?: typeof fetch;
  /**
   * When set, sent as `If-None-Match` (e.g. prior `ETag` from this API).
   * A 304 response returns the provided cached ref instead of parsing JSON.
   */
  ifNoneMatch?: string;
  /** Required when `ifNoneMatch` is set and the server responds 304. */
  cachedRef?: DenoiseTaskRefResponse;
}

function taskRefApiPath(parsed: ParsedDenoiseTaskUrl): string {
  if (parsed.kind === "milestone") {
    return `/api/milestones/${encodeURIComponent(parsed.milestoneId!)}/tasks/${
      encodeURIComponent(parsed.taskId!)
    }`;
  }
  if (parsed.kind === "task_id") {
    return `/api/tasks/${encodeURIComponent(parsed.taskId!)}`;
  }
  return `/api/t/${encodeURIComponent(parsed.shortCode!)}`;
}

async function fetchTaskRefAtPath(
  origin: string,
  apiPath: string,
  options: FetchDenoiseTaskRefOptions,
): Promise<DenoiseTaskRefResponse> {
  const base = origin.trim() || DEFAULT_DENOISE_API_URL;
  const url = new URL(apiPath, base.endsWith("/") ? base : `${base}/`);
  const fetchImpl = options.fetch ?? fetch;
  const headers: Record<string, string> = {
    Accept: "application/json",
    Authorization: `Bearer ${options.githubToken}`,
  };
  if (options.ifNoneMatch?.trim()) {
    headers["If-None-Match"] = options.ifNoneMatch.trim();
  }
  const res = await fetchImpl(url, { headers });
  if (res.status === 304) {
    if (options.cachedRef) return options.cachedRef;
    throw new Error("Denoise task fetch failed (304 without cached ref)");
  }
  const body = (await res.json().catch(() => ({}))) as { error?: string };
  if (!res.ok) {
    throw new Error(
      body.error ?? `Denoise task fetch failed (${res.status})`,
    );
  }
  return body as DenoiseTaskRefResponse;
}

/**
 * Load a task ref using a parsed Denoise task page URL.
 */
export async function fetchDenoiseTaskRefFromParsed(
  parsed: ParsedDenoiseTaskUrl,
  options: FetchDenoiseTaskRefOptions,
): Promise<DenoiseTaskRefResponse> {
  return await fetchTaskRefAtPath(
    parsed.origin,
    taskRefApiPath(parsed),
    options,
  );
}

/**
 * Load a milestone task ref from the Denoise API (nested milestone path).
 *
 * @param origin - API origin (e.g. `https://denoise.cloud`); defaults via caller.
 * @throws When HTTP status is not OK or the body is not a task ref.
 */
export async function fetchDenoiseTaskRef(
  origin: string,
  milestoneId: string,
  taskId: string,
  options: FetchDenoiseTaskRefOptions,
): Promise<DenoiseTaskRefResponse> {
  return await fetchDenoiseTaskRefFromParsed(
    { origin, kind: "milestone", milestoneId, taskId },
    options,
  );
}
