// Copyright 2026 Chesapeake Computing
// SPDX-License-Identifier: Apache-2.0

import type {
  CreateIssueOptions,
  IssueResult,
  UpdateIssueOptions,
} from "./github-gql.ts";

/** The two issue records proposed by a split agent or entered manually. */
export interface IssueSplitProposal {
  original: { title: string; body: string };
  child: { title: string; body: string };
  rationale: string;
}

/** An agent may correctly conclude that splitting would make implementation harder. */
export interface IssueSplitRejection {
  split: false;
  rationale: string;
}

/** Structured agent decision: a useful split, or a principled rejection. */
export type IssueSplitDecision = IssueSplitProposal | IssueSplitRejection;

/** A complete, validated issue split mutation result. */
export interface IssueSplitResult {
  original: IssueResult;
  child: IssueResult;
  relationship: "attached" | "failed";
  relationshipError?: string;
}

/** Parse and validate the strict JSON shape returned by a split proposer. */
export function parseIssueSplitProposal(value: unknown): IssueSplitProposal {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("Split proposal must be an object");
  }
  const record = value as Record<string, unknown>;
  const original = parseIssueRecord(record.original, "original");
  const child = parseIssueRecord(record.child, "child");
  if (typeof record.rationale !== "string" || record.rationale.trim() === "") {
    throw new Error("Split proposal rationale is required");
  }
  return { original, child, rationale: record.rationale.trim() };
}

/** Parse an agent decision while allowing an explicit no-split recommendation. */
export function parseIssueSplitDecision(value: unknown): IssueSplitDecision {
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    const record = value as Record<string, unknown>;
    if (record.split === false) {
      if (
        typeof record.rationale !== "string" || record.rationale.trim() === ""
      ) {
        throw new Error("Split rejection rationale is required");
      }
      return { split: false, rationale: record.rationale.trim() };
    }
  }
  return parseIssueSplitProposal(value);
}

function parseIssueRecord(
  value: unknown,
  name: string,
): { title: string; body: string } {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`Split proposal ${name} issue is required`);
  }
  const record = value as Record<string, unknown>;
  if (typeof record.title !== "string" || record.title.trim() === "") {
    throw new Error(`Split proposal ${name} title is required`);
  }
  if (typeof record.body !== "string") {
    throw new Error(`Split proposal ${name} body must be a string`);
  }
  return { title: record.title.trim(), body: record.body };
}

/** Dependencies used by applyIssueSplit, kept injectable for deterministic tests. */
export interface IssueSplitOperations {
  createIssue: (options: CreateIssueOptions) => Promise<IssueResult>;
  updateIssue: (options: UpdateIssueOptions) => Promise<IssueResult>;
  addSubIssue: (childNumber: number) => Promise<void>;
}

/**
 * Apply a confirmed split in the safe order: child, original, relationship.
 * If relationship attachment fails, the created and updated issues are returned
 * with an explicit failed status so retrying attachment is safe.
 */
export async function applyIssueSplit(
  proposal: IssueSplitProposal,
  options: { labels?: string[]; milestoneId?: string },
  operations: IssueSplitOperations,
): Promise<IssueSplitResult> {
  const child = await operations.createIssue({
    title: proposal.child.title,
    body: proposal.child.body,
    labels: options.labels,
    milestoneId: options.milestoneId,
  });
  const original = await operations.updateIssue({
    title: proposal.original.title,
    body: proposal.original.body,
  });
  try {
    await operations.addSubIssue(child.number);
    return { original, child, relationship: "attached" };
  } catch (error) {
    return {
      original,
      child,
      relationship: "failed",
      relationshipError: error instanceof Error ? error.message : String(error),
    };
  }
}
