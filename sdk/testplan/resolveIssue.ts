// Copyright 2026 Chesapeake Computing
// SPDX-License-Identifier: Apache-2.0

/**
 * Resolves a GitHub issue reference from a local plan file's content and path.
 */

const GITHUB_ISSUE_URL =
  /https?:\/\/github\.com\/([^/\s)#]+)\/([^/\s)#]+)\/issues\/(\d+)/i;
const ISSUE_FILENAME = /(?:^|[/\\])issue-(\d+)(?:[./]|$)/i;
const ISSUE_HASH_IN_BODY = /(?:^|[^A-Za-z0-9_])#(\d+)\b/;
const ISSUE_LABEL = /Issue\s+#(\d+)/i;

/**
 * Finds a GitHub issue URL or number reference in plan markdown / path.
 *
 * Resolution order:
 * 1. First full `https://github.com/.../issues/N` URL in the plan body
 * 2. Filename pattern `issue-N` (e.g. `plans/issue-123.plan.md`)
 * 3. `Issue #N` or bare `#N` in the plan body
 *
 * @param planContent - Full plan markdown
 * @param planFilePath - Plan path used for filename heuristics
 * @returns Full issue URL, or `#N` / `N` suitable for `resolveIssueUrlInput`
 * @throws Error when no issue reference can be found
 */
export function resolveIssueRefFromPlan(
  planContent: string,
  planFilePath: string,
): string {
  const urlMatch = planContent.match(GITHUB_ISSUE_URL);
  if (urlMatch) {
    return urlMatch[0];
  }

  const fileMatch = planFilePath.match(ISSUE_FILENAME);
  if (fileMatch) {
    return fileMatch[1];
  }

  const labeled = planContent.match(ISSUE_LABEL);
  if (labeled) {
    return labeled[1];
  }

  const hashMatch = planContent.match(ISSUE_HASH_IN_BODY);
  if (hashMatch) {
    return hashMatch[1];
  }

  throw new Error(
    `Could not resolve a GitHub issue from plan "${planFilePath}". ` +
      `Include a full issue URL, name the file issue-N.plan.md, or cite #N in the plan body.`,
  );
}
