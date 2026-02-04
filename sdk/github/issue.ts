// Copyright 2026 Chesapeake Computing
// SPDX-License-Identifier: Apache-2.0

import {
  fetchIssueFromUrl as fetchIssueFromUrlGql,
  getCurrentRepoFromRemote,
} from "./github-gql.ts";

const GITHUB_ISSUE_URL_PATTERN =
  /^https?:\/\/github\.com\/[^/]+\/[^/]+\/issues\/\d+(?:\?.*)?$/i;
const ISSUE_NUMBER_PATTERN = /^#?(\d+)$/;

/**
 * Represents GitHub issue data fetched from the API or parsed from a file.
 */
export interface IssueData {
  /** The issue number */
  number: number;
  /** The issue title */
  title: string;
  /** The issue body/description */
  body: string;
  /** Array of label names associated with the issue */
  labels: string[];
  /** Repository name (without owner) */
  repo: string;
  /** Repository owner/organization name */
  owner: string;
}

/**
 * Resolves user input to a full GitHub issue URL.
 * Accepts either a full GitHub issue URL or an issue number for the current repository.
 *
 * @param input - Full URL (e.g. https://github.com/owner/repo/issues/123) or issue number (e.g. 123 or #123)
 * @returns Promise resolving to the full GitHub issue URL
 * @throws Error if input is invalid or not in a git/sapling repo (when input is a number)
 */
export async function resolveIssueUrlInput(input: string): Promise<string> {
  const trimmed = input.trim();
  if (GITHUB_ISSUE_URL_PATTERN.test(trimmed)) {
    return trimmed;
  }
  const numMatch = trimmed.match(ISSUE_NUMBER_PATTERN);
  if (numMatch) {
    const { owner, repo } = await getCurrentRepoFromRemote();
    return `https://github.com/${owner}/${repo}/issues/${numMatch[1]}`;
  }
  throw new Error(
    `Invalid issue URL or number: ${input}. Provide a full URL (e.g. https://github.com/owner/repo/issues/123) or an issue number for the current repository.`,
  );
}

/**
 * Fetches GitHub issue data from a URL using the GraphQL API.
 *
 * @param issueUrl - GitHub issue URL in format `https://github.com/owner/repo/issues/123`
 * @returns Promise resolving to issue data including number, title, body, labels, repo, and owner
 * @throws Error if URL format is invalid or if GraphQL API fails to fetch the issue
 */
export async function fetchIssueFromUrl(
  issueUrl: string,
): Promise<IssueData> {
  return await fetchIssueFromUrlGql(issueUrl);
}

/**
 * Attempts to parse issue data from a markdown file.
 * Looks for a header in the format `# Issue #123: Title`.
 *
 * @param filePath - Path to the issue context markdown file
 * @returns Promise resolving to issue data if parsing succeeds, or `null` if the file
 *          doesn't match the expected format or cannot be read
 */
export async function parseIssueFromFile(
  filePath: string,
): Promise<IssueData | null> {
  try {
    const content = await Deno.readTextFile(filePath);
    const match = content.match(/^# Issue #(\d+): (.+)$/m);
    if (match) {
      return {
        number: parseInt(match[1], 10),
        title: match[2],
        body: content,
        labels: [],
        repo: "",
        owner: "",
      };
    }
  } catch {
    // Ignore parsing errors
  }
  return null;
}

/**
 * Writes issue context to a markdown file in a standardized format.
 * Includes issue number, title, body, and labels.
 *
 * @param issueData - The issue data to write
 * @param filePath - Path where the issue context file should be written
 */
export async function writeIssueContext(
  issueData: IssueData,
  filePath: string,
): Promise<void> {
  let content =
    `# Issue #${issueData.number}: ${issueData.title}\n\n${issueData.body}\n\n---\n\n## Labels\n`;
  if (issueData.labels.length > 0) {
    content += issueData.labels.map((l) => `- ${l}`).join("\n") + "\n";
  } else {
    content += "(none)\n";
  }

  await Deno.writeTextFile(filePath, content);
}
