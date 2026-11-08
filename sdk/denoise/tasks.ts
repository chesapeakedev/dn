// Copyright 2026 Chesapeake Computing
// SPDX-License-Identifier: Apache-2.0

import { type DenoiseApiClientOptions, denoiseApiRequest } from "./client.ts";

export interface DenoiseWorkspaceTask {
  id: string;
  text: string;
  description?: string;
  completed: boolean;
  tags: string[];
  order: number;
  owner: string;
  createdAt: string;
  updatedAt: string;
}

export interface CreateDenoiseTaskInput {
  milestoneId: string;
  title?: string;
  titles?: string[];
  description?: string;
  tags?: string[];
  count?: number;
  titlePrefix?: string;
  titleStartIndex?: number;
}

export interface UpdateDenoiseTaskInput {
  title?: string;
  description?: string;
  tags?: string[];
  completed?: boolean;
  status?: string;
}

export interface CreateDenoiseTaskResult {
  milestone_id: string;
  task_ids: string[];
  tasks: Array<{
    task_id: string;
    canonical_url?: string;
    task_path?: string;
    task: DenoiseWorkspaceTask;
  }>;
}

export async function listDenoiseTasks(
  milestoneId: string,
  options: DenoiseApiClientOptions,
): Promise<DenoiseWorkspaceTask[]> {
  const body = await denoiseApiRequest<{
    tasks: DenoiseWorkspaceTask[];
  }>(
    "GET",
    `/api/milestones/${encodeURIComponent(milestoneId)}/tasks`,
    options,
  );
  return body.tasks ?? [];
}

export async function createDenoiseTasks(
  input: CreateDenoiseTaskInput,
  options: DenoiseApiClientOptions,
): Promise<CreateDenoiseTaskResult> {
  return await denoiseApiRequest<CreateDenoiseTaskResult>(
    "POST",
    `/api/milestones/${encodeURIComponent(input.milestoneId)}/tasks`,
    options,
    {
      ...(input.title !== undefined ? { title: input.title } : {}),
      ...(input.titles !== undefined ? { titles: input.titles } : {}),
      ...(input.description !== undefined
        ? { description: input.description }
        : {}),
      ...(input.tags !== undefined ? { tags: input.tags } : {}),
      ...(input.count !== undefined ? { count: input.count } : {}),
      ...(input.titlePrefix !== undefined
        ? { title_prefix: input.titlePrefix }
        : {}),
      ...(input.titleStartIndex !== undefined
        ? { title_start_index: input.titleStartIndex }
        : {}),
    },
  );
}

export async function updateDenoiseTask(
  milestoneId: string,
  taskId: string,
  input: UpdateDenoiseTaskInput,
  options: DenoiseApiClientOptions,
): Promise<DenoiseWorkspaceTask> {
  const body = await denoiseApiRequest<{ task: DenoiseWorkspaceTask }>(
    "PATCH",
    `/api/milestones/${encodeURIComponent(milestoneId)}/tasks/${
      encodeURIComponent(taskId)
    }`,
    options,
    {
      ...(input.title !== undefined ? { title: input.title } : {}),
      ...(input.description !== undefined
        ? { description: input.description }
        : {}),
      ...(input.tags !== undefined ? { tags: input.tags } : {}),
      ...(input.completed !== undefined ? { completed: input.completed } : {}),
      ...(input.status !== undefined ? { status: input.status } : {}),
    },
  );
  return body.task;
}

export async function closeDenoiseTask(
  taskId: string,
  options: DenoiseApiClientOptions,
): Promise<DenoiseWorkspaceTask> {
  const body = await denoiseApiRequest<{
    task: DenoiseWorkspaceTask;
    milestone_id: string;
  }>(
    "POST",
    `/api/tasks/${encodeURIComponent(taskId)}/close`,
    options,
  );
  return body.task;
}

export async function reopenDenoiseTask(
  taskId: string,
  options: DenoiseApiClientOptions,
): Promise<DenoiseWorkspaceTask> {
  const body = await denoiseApiRequest<{
    task: DenoiseWorkspaceTask;
    milestone_id: string;
  }>(
    "POST",
    `/api/tasks/${encodeURIComponent(taskId)}/reopen`,
    options,
  );
  return body.task;
}
