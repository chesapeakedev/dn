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
 * Canonical issue state values returned by GitHub issue APIs.
 */
export type IssueStateValue = "OPEN" | "CLOSED";

/**
 * Minimal related-issue payload surfaced in issue relationship context.
 */
export interface IssueRelationshipReference {
  /** The related issue number */
  number: number;
  /** The related issue title */
  title: string;
  /** The related issue state */
  state: IssueStateValue;
  /** The related issue URL */
  url: string;
  /** Repository owner for the related issue */
  owner: string;
  /** Repository name for the related issue */
  repo: string;
}

/**
 * Summary counts for a relationship group.
 */
export interface IssueRelationshipSummary {
  /** Total number of related issues in this group */
  totalCount: number;
  /** Number of open issues in this group */
  openCount: number;
  /** Number of closed issues in this group */
  closedCount: number;
}

/**
 * Relationship metadata attached to a GitHub issue.
 */
export interface IssueRelationships {
  /** Parent issue when this issue is a sub-issue */
  parent: IssueRelationshipReference | null;
  /** Child sub-issues */
  subIssues: IssueRelationshipReference[];
  /** Summary counts for sub-issues */
  subIssuesSummary: IssueRelationshipSummary;
  /** Issues currently blocking this issue */
  blockedBy: IssueRelationshipReference[];
  /** Summary counts for blockers */
  blockedBySummary: IssueRelationshipSummary;
  /** Issues currently blocked by this issue */
  blocking: IssueRelationshipReference[];
  /** Summary counts for blocked issues */
  blockingSummary: IssueRelationshipSummary;
  /** Canonical issue when this issue is marked as a duplicate */
  duplicateOf: IssueRelationshipReference | null;
}

/**
 * Create an empty relationship payload for contexts without GitHub data.
 */
export function emptyIssueRelationships(): IssueRelationships {
  return {
    parent: null,
    subIssues: [],
    subIssuesSummary: {
      totalCount: 0,
      openCount: 0,
      closedCount: 0,
    },
    blockedBy: [],
    blockedBySummary: {
      totalCount: 0,
      openCount: 0,
      closedCount: 0,
    },
    blocking: [],
    blockingSummary: {
      totalCount: 0,
      openCount: 0,
      closedCount: 0,
    },
    duplicateOf: null,
  };
}

/**
 * Represents GitHub issue data fetched from the API or parsed from a file.
 */
export interface IssueData {
  /** Database identifier used by REST issue relationship endpoints */
  databaseId: number | null;
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
  /** Relationship metadata that helps agents reason about issue dependencies */
  relationships: IssueRelationships;
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
        databaseId: null,
        number: parseInt(match[1], 10),
        title: match[2],
        body: content,
        labels: [],
        repo: "",
        owner: "",
        relationships: emptyIssueRelationships(),
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

  content += "\n## Relationships\n";
  content += formatSingleRelationship("Parent", issueData.relationships.parent);
  content += formatRelationshipGroup(
    "Sub-issues",
    issueData.relationships.subIssues,
    issueData.relationships.subIssuesSummary,
  );
  content += formatRelationshipGroup(
    "Blocked By",
    issueData.relationships.blockedBy,
    issueData.relationships.blockedBySummary,
  );
  content += formatRelationshipGroup(
    "Blocking",
    issueData.relationships.blocking,
    issueData.relationships.blockingSummary,
  );
  content += formatSingleRelationship(
    "Duplicate Of",
    issueData.relationships.duplicateOf,
  );

  await Deno.writeTextFile(filePath, content);
}

function formatSingleRelationship(
  title: string,
  relationship: IssueRelationshipReference | null,
): string {
  const section = `\n### ${title}\n`;
  if (!relationship) {
    return section + "(none)\n";
  }
  return section + `${formatRelationshipReference(relationship)}\n`;
}

function formatRelationshipGroup(
  title: string,
  relationships: IssueRelationshipReference[],
  summary: IssueRelationshipSummary,
): string {
  let section = `\n### ${title}\n`;
  if (summary.totalCount === 0) {
    return section + "(none)\n";
  }

  section += `- ${summary.totalCount} total`;
  if (summary.openCount > 0 || summary.closedCount > 0) {
    section += ` (${summary.openCount} open, ${summary.closedCount} closed)`;
  }
  section += "\n";

  if (relationships.length === 0) {
    return section + "- Detailed issue refs omitted from context\n";
  }

  for (const relationship of relationships) {
    section += `${formatRelationshipReference(relationship)}\n`;
  }

  if (relationships.length < summary.totalCount) {
    section += `- ${
      summary.totalCount - relationships.length
    } more not shown\n`;
  }

  return section;
}

function formatRelationshipReference(
  relationship: IssueRelationshipReference,
): string {
  const repoPrefix = relationship.repo
    ? `${relationship.owner}/${relationship.repo}`
    : "";
  const state = relationship.state.toLowerCase();
  return `- ${repoPrefix}#${relationship.number} ${relationship.title} (${state})`;
}
