// Copyright 2026 Chesapeake Computing
// SPDX-License-Identifier: Apache-2.0

/**
 * SDLC "Done" closeout for local queue, Denoise cloud tasks, and GitHub issues.
 */

import type { DenoiseApiClientOptions } from "../denoise/client.ts";
import { closeDenoiseTask } from "../denoise/tasks.ts";
import { fetchDenoiseTaskRefFromParsed } from "../denoise/fetchTaskRef.ts";
import { parseDenoiseTaskUrl } from "../denoise/taskUrl.ts";
import {
  completeGitHubIssueForRef,
  markDone,
  markQueueItemDoneIfPresent,
  resolveGitHubRef,
} from "./queue.ts";

export interface CloseoutOptions {
  closeComment?: string;
  updated?: string;
}

export interface CloseoutDenoiseResult {
  taskId: string;
  closedGitHubIssue: boolean;
}

export interface CloseoutGitHubResult {
  closedIssue: boolean;
  markedQueue: boolean;
}

/** Local ~/.dn/todo.md queue (existing behavior). */
export async function closeoutTodo(
  ref: string,
  options?: CloseoutOptions,
): Promise<{ closedIssue: boolean }> {
  return await markDone(ref, options);
}

/** Denoise native task (+ linked GitHub issue when present on task ref). */
export async function closeoutDenoise(
  ref: string,
  client: DenoiseApiClientOptions,
  options?: CloseoutOptions,
): Promise<CloseoutDenoiseResult> {
  const parsed = parseDenoiseTaskUrl(ref) ??
    parseDenoiseTaskUrl(
      new URL(`/task/${ref}`, client.apiUrl ?? "https://denoise.cloud").href,
    );
  if (!parsed) {
    throw new Error(`Not a Denoise task reference: ${ref}`);
  }
  const taskRef = await fetchDenoiseTaskRefFromParsed(parsed, {
    githubToken: client.githubToken,
    fetch: client.fetch ?? fetch,
  });
  const taskId = taskRef.task_id;
  await closeDenoiseTask(taskId, client);
  let closedGitHubIssue = false;
  const gh = taskRef.github_issue;
  if (gh) {
    await completeGitHubIssueForRef(gh, options);
    closedGitHubIssue = true;
  }
  await markQueueItemDoneIfPresent(ref, {
    updated: options?.updated,
  });
  if (taskRef.canonical_url) {
    await markQueueItemDoneIfPresent(taskRef.canonical_url, {
      updated: options?.updated,
    });
  }
  return { taskId, closedGitHubIssue };
}

/** GitHub issue close; optionally checks off a matching queue line. */
export async function closeoutGitHub(
  ref: string,
  options?: CloseoutOptions,
): Promise<CloseoutGitHubResult> {
  const gh = await resolveGitHubRef(ref);
  if (!gh) {
    throw new Error(`Not a GitHub issue reference: ${ref}`);
  }
  await completeGitHubIssueForRef(gh, options);
  const markedQueue = await markQueueItemDoneIfPresent(ref, {
    updated: options?.updated,
  });
  return { closedIssue: true, markedQueue };
}
