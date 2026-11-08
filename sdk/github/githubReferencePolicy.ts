// Copyright 2026 Chesapeake Computing
// SPDX-License-Identifier: Apache-2.0

/** Matches `#123` or `123` style GitHub issue/PR references. */
export const BARE_GITHUB_NUMBER_PATTERN = /^#?\d+$/;

/**
 * User-facing guidance when a command requires a full GitHub URL on shared runners.
 */
export function bareGitHubNumberPolicyMessage(): string {
  return "Expected a full GitHub issue or pull request URL (for example https://github.com/owner/repo/issues/123). Bare numbers are only supported by dn kickstart.";
}

/** Throws when {@link ref} is a bare issue/PR number. */
export function rejectBareGitHubNumber(ref: string): void {
  if (BARE_GITHUB_NUMBER_PATTERN.test(ref.trim())) {
    throw new Error(bareGitHubNumberPolicyMessage());
  }
}
