// Copyright 2026 Chesapeake Computing
// SPDX-License-Identifier: Apache-2.0

import { rejectBareGitHubNumber } from "./githubReferencePolicy.ts";

/**
 * Normalizes a user-supplied GitHub pull request URL.
 *
 * Bare issue/PR numbers are intentionally rejected so runners and agents do not
 * depend on the checkout's `origin` remote (use full URLs from Denoise instead).
 */
export function normalizePullRequestUrl(reference: string): string {
  const trimmed = reference.trim();
  rejectBareGitHubNumber(trimmed);
  if (
    !/^https?:\/\/github\.com\/[^/]+\/[^/]+\/pull\/\d+(?:[/?#].*)?$/i.test(
      trimmed,
    )
  ) {
    throw new Error(
      "Expected a GitHub pull request URL like https://github.com/owner/repo/pull/123",
    );
  }
  const match = trimmed.match(
    /^https?:\/\/github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)/i,
  );
  if (!match) {
    throw new Error(`Invalid pull request reference: ${reference}`);
  }
  return `https://github.com/${match[1]}/${match[2]}/pull/${match[3]}`;
}
