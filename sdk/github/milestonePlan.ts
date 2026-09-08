// Copyright 2026 Chesapeake Computing
// SPDX-License-Identifier: Apache-2.0

import { addIssueBlockedBy } from "./issueRelationships.ts";
import { createMilestone, type MilestoneSummary } from "./milestone.ts";
import {
  createIssue,
  getCurrentRepoFromRemote,
  type IssueResult,
} from "./github-gql.ts";

/** A version 1.0 milestone plan that can be published to GitHub. */
export interface MilestonePlan {
  schema_version: "1.0";
  repo?: string;
  milestone: MilestonePlanMilestone;
  issues: MilestonePlanIssue[];
}

/** Milestone fields accepted by a version 1.0 plan. */
export interface MilestonePlanMilestone {
  title: string;
  description?: string;
  due_on?: string;
}

/** Issue fields accepted by a version 1.0 plan. */
export interface MilestonePlanIssue {
  id?: string;
  title: string;
  body: string;
  labels?: string[];
  blocked_by?: string[];
}

/** Repository coordinates used while publishing a plan. */
export interface MilestonePlanRepository {
  owner: string;
  repo: string;
}

/** A created dependency returned as part of a publish result. */
export interface MilestonePlanRelationship {
  issue: number;
  blocked_by: number;
  issue_id: string;
  blocked_by_id: string;
}

/** Result returned after publishing a milestone plan. */
export interface MilestonePlanPublishResult {
  repo: MilestonePlanRepository;
  milestone: MilestoneSummary;
  issues: IssueResult[];
  relationships: MilestonePlanRelationship[];
}

/** Preview returned when a plan is validated with `dryRun: true`. */
export interface MilestonePlanDryRunResult {
  dry_run: true;
  repo: MilestonePlanRepository;
  milestone: MilestonePlanMilestone;
  issues: MilestonePlanIssue[];
  relationships: Array<{ issue_id: string; blocked_by_id: string }>;
}

/** Options controlling milestone plan publication. */
export interface PublishMilestonePlanOptions {
  repo?: string;
  dryRun?: boolean;
}

/** Parse and validate an unknown JSON value as a version 1.0 milestone plan. */
export function parseMilestonePlan(value: unknown): MilestonePlan {
  if (!isRecord(value) || value.schema_version !== "1.0") {
    throw new Error('Milestone plan schema_version must be "1.0"');
  }
  if (value.repo !== undefined && !isNonEmptyString(value.repo)) {
    throw new Error("Milestone plan repo must be owner/repo");
  }
  if (!isRecord(value.milestone)) {
    throw new Error("Milestone plan milestone is required");
  }
  const milestone = parseMilestone(value.milestone);
  if (!Array.isArray(value.issues)) {
    throw new Error("Milestone plan issues must be an array");
  }

  const issues = value.issues.map((issue, index) => parseIssue(issue, index));
  const ids = new Set<string>();
  for (const issue of issues) {
    if (issue.id) {
      if (ids.has(issue.id)) throw new Error(`Duplicate issue id: ${issue.id}`);
      ids.add(issue.id);
    }
  }
  for (const issue of issues) {
    if (issue.blocked_by && issue.blocked_by.length > 0 && !issue.id) {
      throw new Error("Issue id is required when blocked_by is provided");
    }
    for (const blocker of issue.blocked_by ?? []) {
      if (!ids.has(blocker)) {
        throw new Error(`Unknown blocked_by issue id: ${blocker}`);
      }
      if (blocker === issue.id) {
        throw new Error(`Issue cannot be blocked by itself: ${blocker}`);
      }
    }
  }

  return {
    schema_version: "1.0",
    ...(value.repo !== undefined && { repo: value.repo }),
    milestone,
    issues,
  };
}

/** Publish a validated plan, or validate and preview it without mutations. */
export async function publishMilestonePlan(
  plan: MilestonePlan | unknown,
  options: PublishMilestonePlanOptions = {},
): Promise<MilestonePlanPublishResult | MilestonePlanDryRunResult> {
  const validated = parseMilestonePlan(plan);
  const repository = resolveRepository(validated.repo, options.repo);
  const repo = repository ?? await getCurrentRepoFromRemote();
  if (options.dryRun) {
    return {
      dry_run: true,
      repo,
      milestone: validated.milestone,
      issues: validated.issues,
      relationships: validated.issues.flatMap((issue) =>
        (issue.blocked_by ?? []).map((blockedBy) => ({
          issue_id: issue.id as string,
          blocked_by_id: blockedBy,
        }))
      ),
    };
  }

  const milestone = await createMilestone(repo.owner, repo.repo, {
    title: validated.milestone.title,
    ...(validated.milestone.description !== undefined && {
      description: validated.milestone.description,
    }),
    ...(validated.milestone.due_on !== undefined && {
      dueOn: validated.milestone.due_on,
    }),
  });
  const issues: IssueResult[] = [];
  const issueById = new Map<string, IssueResult>();
  for (const issue of validated.issues) {
    const created = await createIssue(repo.owner, repo.repo, {
      title: issue.title,
      body: issue.body,
      labels: issue.labels,
      milestoneId: milestone.id,
    });
    issues.push(created);
    if (issue.id) issueById.set(issue.id, created);
  }

  const relationships: MilestonePlanRelationship[] = [];
  for (const issue of validated.issues) {
    if (!issue.id) continue;
    const createdIssue = issueById.get(issue.id);
    if (!createdIssue) throw new Error(`Created issue missing id: ${issue.id}`);
    for (const blockerId of issue.blocked_by ?? []) {
      const blocker = issueById.get(blockerId);
      if (!blocker) throw new Error(`Created blocker missing id: ${blockerId}`);
      await addIssueBlockedBy(
        repo.owner,
        repo.repo,
        createdIssue.number,
        repo.owner,
        repo.repo,
        blocker.number,
      );
      relationships.push({
        issue: createdIssue.number,
        blocked_by: blocker.number,
        issue_id: issue.id,
        blocked_by_id: blockerId,
      });
    }
  }

  return { repo, milestone, issues, relationships };
}

function parseMilestone(
  value: Record<string, unknown>,
): MilestonePlanMilestone {
  if (!isNonEmptyString(value.title)) {
    throw new Error("Milestone title is required");
  }
  if (
    value.description !== undefined && typeof value.description !== "string"
  ) {
    throw new Error("Milestone description must be a string");
  }
  if (value.due_on !== undefined && typeof value.due_on !== "string") {
    throw new Error("Milestone due_on must be a string");
  }
  return {
    title: value.title,
    ...(value.description !== undefined && { description: value.description }),
    ...(value.due_on !== undefined && { due_on: value.due_on }),
  };
}

function parseIssue(value: unknown, index: number): MilestonePlanIssue {
  if (!isRecord(value)) throw new Error(`Issue ${index + 1} must be an object`);
  if (!isNonEmptyString(value.title)) {
    throw new Error(`Issue ${index + 1} title is required`);
  }
  if (typeof value.body !== "string") {
    throw new Error(`Issue ${index + 1} body is required`);
  }
  if (value.id !== undefined && !isNonEmptyString(value.id)) {
    throw new Error(`Issue ${index + 1} id must be a non-empty string`);
  }
  const labels = parseStringArray(value.labels, `Issue ${index + 1} labels`);
  const blockedBy = parseStringArray(
    value.blocked_by,
    `Issue ${index + 1} blocked_by`,
  );
  return {
    ...(value.id !== undefined && { id: value.id }),
    title: value.title,
    body: value.body,
    ...(labels !== undefined && { labels }),
    ...(blockedBy !== undefined && { blocked_by: blockedBy }),
  };
}

function parseStringArray(value: unknown, field: string): string[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.some((item) => !isNonEmptyString(item))) {
    throw new Error(`${field} must be an array of non-empty strings`);
  }
  return value;
}

function resolveRepository(
  planRepo: string | undefined,
  optionRepo: string | undefined,
): MilestonePlanRepository | undefined {
  const value = optionRepo ?? planRepo;
  if (value === undefined) return undefined;
  const parts = value.split("/");
  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    throw new Error(`Invalid repository: ${value}. Use owner/repo`);
  }
  return { owner: parts[0], repo: parts[1] };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}
