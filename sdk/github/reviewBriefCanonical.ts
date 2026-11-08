// Copyright 2026 Chesapeake Computing
// SPDX-License-Identifier: Apache-2.0

import type { PullRequestReviewData } from "./github-gql.ts";

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
