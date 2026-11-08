// Copyright 2026 Chesapeake Computing
// SPDX-License-Identifier: Apache-2.0

import { type DenoiseApiClientOptions, denoiseApiRequest } from "./client.ts";

export interface DenoiseMilestone {
  id: string;
  name: string;
  description?: string;
  participants: string[];
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  archived: boolean;
  dueDate?: string;
  organizationId?: string;
}

export interface CreateDenoiseMilestoneInput {
  name: string;
  description?: string;
  dueDate?: string;
  organizationId?: string;
  participants?: string[];
}

export interface UpdateDenoiseMilestoneInput {
  name?: string;
  description?: string;
  dueDate?: string;
  archived?: boolean;
  participants?: string[];
}

export async function listDenoiseMilestones(
  options: DenoiseApiClientOptions,
): Promise<DenoiseMilestone[]> {
  const body = await denoiseApiRequest<{ milestones: DenoiseMilestone[] }>(
    "GET",
    "/api/milestones",
    options,
  );
  return body.milestones ?? [];
}

export async function getDenoiseMilestone(
  milestoneId: string,
  options: DenoiseApiClientOptions,
): Promise<DenoiseMilestone> {
  const body = await denoiseApiRequest<{ milestone: DenoiseMilestone }>(
    "GET",
    `/api/milestones/${encodeURIComponent(milestoneId)}`,
    options,
  );
  return body.milestone;
}

export async function createDenoiseMilestone(
  input: CreateDenoiseMilestoneInput,
  options: DenoiseApiClientOptions,
): Promise<DenoiseMilestone> {
  const body = await denoiseApiRequest<{ milestone: DenoiseMilestone }>(
    "POST",
    "/api/milestones",
    options,
    {
      name: input.name,
      ...(input.description !== undefined
        ? { description: input.description }
        : {}),
      ...(input.dueDate !== undefined ? { due_date: input.dueDate } : {}),
      ...(input.organizationId !== undefined
        ? { organization_id: input.organizationId }
        : {}),
      ...(input.participants !== undefined
        ? { participants: input.participants }
        : {}),
    },
  );
  return body.milestone;
}

export async function updateDenoiseMilestone(
  milestoneId: string,
  input: UpdateDenoiseMilestoneInput,
  options: DenoiseApiClientOptions,
): Promise<DenoiseMilestone> {
  const body = await denoiseApiRequest<{ milestone: DenoiseMilestone }>(
    "PATCH",
    `/api/milestones/${encodeURIComponent(milestoneId)}`,
    options,
    {
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.description !== undefined
        ? { description: input.description }
        : {}),
      ...(input.dueDate !== undefined ? { due_date: input.dueDate } : {}),
      ...(input.archived !== undefined ? { archived: input.archived } : {}),
      ...(input.participants !== undefined
        ? { participants: input.participants }
        : {}),
    },
  );
  return body.milestone;
}
