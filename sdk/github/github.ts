// Copyright 2026 Chesapeake Computing
// SPDX-License-Identifier: Apache-2.0

import { ObsidianClient } from "@chesapeake/obsidian-gql";
import type { IssueData } from "./issue.ts";
import { getCurrentRepoFromRemote, getDefaultBranch } from "./github-gql.ts";
import { resolveGitHubToken } from "./token.ts";

const GET_REPOSITORY_ID_QUERY = `
  query GetRepositoryId($owner: String!, $name: String!) {
    repository(owner: $owner, name: $name) {
      id
    }
  }
`;

const CREATE_PULL_REQUEST_MUTATION = `
  mutation CreatePullRequest($input: CreatePullRequestInput!) {
    createPullRequest(input: $input) {
      pullRequest {
        id
        number
        url
        isDraft
      }
    }
  }
`;

/**
 * Plan summary for enhanced PR descriptions.
 */
export interface PRPlanSummary {
  /** The overview/description of the plan */
  overview: string;
  /** All acceptance criteria items */
  acceptanceCriteria: string[];
}

/**
 * Creates a pull request using the GitHub GraphQL API.
 * PR title format: `#{issueNumber} {issueTitle}`
 * PR body: If planSummary is provided, includes Summary and Changes sections.
 *          Otherwise, just `Closes #{issueNumber}`
 *
 * Works with both git and sapling repositories.
 *
 * @param issueData - Issue data used to generate PR title and body
 * @param branchName - Name of the branch to create the PR from
 * @param vcs - Version control system ("git" or "sapling")
 * @param planSummary - Optional plan summary for enhanced PR description
 * @returns Promise resolving to the URL of the created PR, or null if skipped
 * @throws Error if GraphQL API fails to create the PR
 */
export async function createPR(
  issueData: IssueData,
  branchName: string,
  _vcs: "git" | "sapling",
  planSummary?: PRPlanSummary,
): Promise<string | null> {
  const token = await resolveGitHubToken();
  const repo = await getCurrentRepoFromRemote();
  const defaultBranch = await getDefaultBranch(repo.owner, repo.repo);

  const prTitle = `#${issueData.number} ${issueData.title}`;

  // Generate PR body - use plan summary if available
  let prBody: string;
  if (planSummary) {
    let body = "";

    // Summary section
    body += "## Summary\n\n";
    if (planSummary.overview) {
      body += planSummary.overview + "\n\n";
    }

    // Changes section (list of acceptance criteria)
    if (planSummary.acceptanceCriteria.length > 0) {
      body += "## Changes\n\n";
      for (const criterion of planSummary.acceptanceCriteria) {
        body += `- ${criterion}\n`;
      }
      body += "\n";
    }

    // Closes link
    body += `Closes #${issueData.number}`;
    prBody = body;
  } else {
    prBody = `Closes #${issueData.number}`;
  }

  const client = new ObsidianClient({
    endpoint: "https://api.github.com/graphql",
    headers: {
      Authorization: `Bearer ${token}`,
      "User-Agent": "dn-github-graphql",
    },
    useCache: false,
  });

  // Get repository ID first (required for createPullRequest mutation)
  const repoResult = await client.query(GET_REPOSITORY_ID_QUERY, {
    variables: {
      owner: repo.owner,
      name: repo.repo,
    },
    cacheRead: false,
    cacheWrite: false,
  });

  if (repoResult.errors && repoResult.errors.length > 0) {
    const errorMessages = repoResult.errors.map((e) =>
      e.message ?? "Unknown error"
    ).join("; ");
    throw new Error(`Failed to get repository ID: ${errorMessages}`);
  }

  if (!repoResult.data) {
    throw new Error("Failed to get repository ID: No data returned");
  }

  const repoData = repoResult.data as {
    repository?: {
      id: string;
    } | null;
  };

  if (!repoData.repository?.id) {
    throw new Error(
      `Repository ${repo.owner}/${repo.repo} not found or access denied`,
    );
  }

  // Create the PR (initially as non-draft since GraphQL doesn't support draft in createPullRequest)
  // GitHub GraphQL CreatePullRequestInput uses headRefName/baseRefName, not head/base
  const createResult = await client.mutate(CREATE_PULL_REQUEST_MUTATION, {
    variables: {
      input: {
        repositoryId: repoData.repository.id,
        title: prTitle,
        body: prBody,
        headRefName: branchName,
        baseRefName: defaultBranch,
        clientMutationId: `create-pr-${Date.now()}`,
      },
    },
  });

  if (createResult.errors && createResult.errors.length > 0) {
    const errorMessages = createResult.errors.map((e) =>
      e.message ?? "Unknown error"
    ).join("; ");
    throw new Error(`Failed to create PR: ${errorMessages}`);
  }

  if (!createResult.data) {
    throw new Error("Failed to create PR: No data returned");
  }

  const createData = createResult.data as {
    createPullRequest?: {
      pullRequest?: {
        id: string;
        number: number;
        url: string;
        isDraft: boolean;
      };
    };
  };

  const pullRequest = createData.createPullRequest?.pullRequest;
  if (!pullRequest) {
    throw new Error("Failed to create PR: No pull request returned");
  }

  return pullRequest.url || null;
}
