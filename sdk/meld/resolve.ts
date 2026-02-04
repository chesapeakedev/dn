// Copyright 2026 Chesapeake Computing
// SPDX-License-Identifier: Apache-2.0

import { fetchIssueFromUrl } from "../github/issue.ts";

const GITHUB_ISSUE_URL =
  /^https:\/\/github\.com\/[^/]+\/[^/]+\/issues\/\d+(?:\?.*)?$/i;

/**
 * Returns true if the source string looks like a GitHub issue URL.
 */
export function isGitHubIssueUrl(source: string): boolean {
  return GITHUB_ISSUE_URL.test(source.trim());
}

/**
 * Resolves a meld source to markdown content.
 * - GitHub issue URL: fetches issue and returns "# {title}\n\n{body}".
 * - Local path: reads file and returns contents.
 *
 * @param source - GitHub issue URL or path to a markdown file
 * @returns Markdown content for the source
 * @throws Error if URL fetch fails or file cannot be read
 */
export async function resolveSource(source: string): Promise<string> {
  const trimmed = source.trim();
  if (trimmed === "") {
    return "";
  }
  if (isGitHubIssueUrl(trimmed)) {
    const issue = await fetchIssueFromUrl(trimmed);
    return `# ${issue.title}\n\n${issue.body ?? ""}`.trim();
  }
  return await Deno.readTextFile(trimmed);
}
