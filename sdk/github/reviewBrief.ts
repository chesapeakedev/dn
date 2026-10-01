// Copyright 2026 Chesapeake Computing
// SPDX-License-Identifier: Apache-2.0

import {
  fetchPullRequestReviewData,
  parsePullRequestUrl,
  type PullRequestReviewData,
} from "./github-gql.ts";

/** A normalized pull request identity used for cache invalidation. */
export interface ReviewPullRequestIdentity {
  owner: string;
  repo: string;
  number: number;
  url: string;
  headSha: string | null;
  baseRef: string | null;
  headRef: string | null;
}

/** A fact collected from GitHub, kept separate from agent judgment. */
export interface ReviewFact {
  source: string;
  value: string | number | boolean | null;
  complete: boolean;
}

/** Structured limitations encountered while collecting review evidence. */
export interface ReviewWarning {
  code: "incomplete-data" | "unavailable-data" | "truncated-data";
  message: string;
}

/** The two conclusions produced by a review brief. */
export interface ReviewConclusions {
  change: string;
  mergeOutlook: string;
}

/** Machine-readable, versioned output of `dn read`. */
export interface ReviewBrief {
  schemaVersion: "1.0";
  identity: ReviewPullRequestIdentity;
  canonicalInput: string;
  digest: string;
  facts: ReviewFact[];
  conclusions: ReviewConclusions;
  warnings: ReviewWarning[];
}

/** Returns the stable serialized evidence used as the cache input. */
export function canonicalizeReviewData(data: PullRequestReviewData): string {
  return JSON.stringify({
    identity: {
      owner: data.owner,
      repo: data.repo,
      number: data.number,
      url: `https://github.com/${data.owner}/${data.repo}/pull/${data.number}`,
      headSha: data.headRefOid,
      baseRef: data.baseRefName,
      headRef: data.headRefName,
    },
    title: data.title,
    body: data.body,
    state: data.state,
    isDraft: data.isDraft,
    mergeable: data.mergeable,
    mergeStateStatus: data.mergeStateStatus,
    reviewDecision: data.reviewDecision,
    commits: [...data.commits].sort((a, b) => a.oid.localeCompare(b.oid)),
    files: [...data.files].sort((a, b) => a.path.localeCompare(b.path)),
    comments: [...data.comments].sort((a, b) =>
      `${a.createdAt}:${a.author}`.localeCompare(`${b.createdAt}:${b.author}`)
    ),
    reviews: [...data.reviews].sort((a, b) =>
      `${a.submittedAt}:${a.author}`.localeCompare(
        `${b.submittedAt}:${b.author}`,
      )
    ),
    reviewThreads: [...data.reviewThreads].sort((a, b) =>
      Number(a.isResolved) - Number(b.isResolved)
    ),
    checks: [...data.checks].sort((a, b) => a.name.localeCompare(b.name)),
  });
}

/** Computes the SHA-256 cache identity for canonical review input. */
export async function computeReviewDigest(value: string): Promise<string> {
  const bytes = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return [...new Uint8Array(bytes)].map((byte) =>
    byte.toString(16).padStart(2, "0")
  ).join("");
}

function makeConclusions(data: PullRequestReviewData): ReviewConclusions {
  const fileCount = data.files.length;
  const additions = data.files.reduce((sum, file) => sum + file.additions, 0);
  const deletions = data.files.reduce((sum, file) => sum + file.deletions, 0);
  const pendingChanges =
    data.reviewThreads.filter((thread) =>
      !thread.isResolved && !thread.isOutdated
    ).length;
  const failingChecks =
    data.checks.filter((check) =>
      ["FAILURE", "ERROR", "CANCELLED"].includes(
        (check.conclusion ?? check.state ?? "").toUpperCase(),
      )
    ).length;
  const mergeReasons: string[] = [];
  if (data.isDraft) mergeReasons.push("the pull request is a draft");
  if (data.mergeable === "CONFLICTING") {
    mergeReasons.push("GitHub reports merge conflicts");
  }
  if (failingChecks > 0) {
    mergeReasons.push(`${failingChecks} check(s) are failing`);
  }
  if (data.reviewDecision === "CHANGES_REQUESTED") {
    mergeReasons.push("changes have been requested");
  }
  if (pendingChanges > 0) {
    mergeReasons.push(`${pendingChanges} unresolved review thread(s) remain`);
  }
  const mergeOutlook = mergeReasons.length === 0
    ? "Likely mergeable based on the available GitHub signals, though this is not a guarantee."
    : `Unlikely to merge yet because ${mergeReasons.join(", ")}.`;
  return {
    change:
      `${data.title} changes ${fileCount} file(s), with ${additions} addition(s) and ${deletions} deletion(s).`,
    mergeOutlook,
  };
}

/** Builds a deterministic read-only review brief from GitHub PR evidence. */
export async function createReviewBrief(prUrl: string): Promise<ReviewBrief> {
  const parsed = parsePullRequestUrl(prUrl);
  if (!parsed) throw new Error(`Invalid PR URL: ${prUrl}`);
  const data = await fetchPullRequestReviewData(prUrl);
  const canonicalInput = canonicalizeReviewData(data);
  const warnings: ReviewWarning[] = data.warnings.map((message) => ({
    code: message.includes("unavailable")
      ? "unavailable-data"
      : "truncated-data",
    message,
  }));
  if (!data.headRefOid) {
    warnings.push({
      code: "incomplete-data",
      message: "The pull request head SHA is unavailable.",
    });
  }
  const facts: ReviewFact[] = [
    { source: "github.state", value: data.state, complete: true },
    { source: "github.draft", value: data.isDraft, complete: true },
    { source: "github.mergeable", value: data.mergeable, complete: true },
    {
      source: "github.mergeStateStatus",
      value: data.mergeStateStatus,
      complete: data.mergeStateStatus !== null,
    },
    {
      source: "github.reviewDecision",
      value: data.reviewDecision,
      complete: data.reviewDecision !== null,
    },
    {
      source: "github.checkCount",
      value: data.checks.length,
      complete: !data.warnings.some((warning) => warning.includes("Checks")),
    },
    {
      source: "github.unresolvedReviewThreads",
      value: data.reviewThreads.filter((thread) => !thread.isResolved).length,
      complete: true,
    },
  ];
  return {
    schemaVersion: "1.0",
    identity: {
      ...parsed,
      url:
        `https://github.com/${parsed.owner}/${parsed.repo}/pull/${parsed.number}`,
      headSha: data.headRefOid,
      baseRef: data.baseRefName,
      headRef: data.headRefName,
    },
    canonicalInput,
    digest: await computeReviewDigest(canonicalInput),
    facts,
    conclusions: makeConclusions(data),
    warnings,
  };
}
