// Copyright 2026 Chesapeake Computing
// SPDX-License-Identifier: Apache-2.0

// GitHub GraphQL API client
//
// references
// https://docs.github.com/en/graphql/guides/forming-calls-with-graphql
import { $ } from "$dax";
import { ObsidianClient } from "@chesapeake/obsidian-gql";
import type { Commit, Issue } from "./types.ts";
import type { IssueData } from "./issue.ts";
import { resolveGitHubToken } from "./token.ts";

/**
 * Create a GitHub GraphQL client with authentication headers.
 */
function createGithubClient(token: string): ObsidianClient {
  return new ObsidianClient({
    endpoint: "https://api.github.com/graphql",
    headers: {
      Authorization: `Bearer ${token}`,
      "User-Agent": "dn-github-graphql",
    },
    useCache: false, // Always fetch fresh data for GitHub API
  });
}

/**
 * Get a GitHub GraphQL client using the central token resolver (env → gh → cached).
 */
async function getClient(): Promise<ObsidianClient> {
  const token = await resolveGitHubToken();
  return createGithubClient(token);
}

/**
 * Check if a GraphQL response indicates an authentication error.
 */
function isAuthError(result: {
  errors?: Array<{ message?: string; extensions?: { code?: string } }>;
}): boolean {
  if (!result.errors) return false;
  return result.errors.some((e) => {
    const message = e.message?.toLowerCase() || "";
    return (
      message.includes("bad credentials") ||
      message.includes("authentication") ||
      message.includes("unauthorized") ||
      message.includes("forbidden") ||
      message.includes("must have") ||
      message.includes("requires") ||
      e.extensions?.code === "UNAUTHENTICATED" ||
      e.extensions?.code === "FORBIDDEN"
    );
  });
}

/**
 * Handle GraphQL errors and throw user-friendly messages.
 */
function handleGraphQLErrors(
  result: {
    data?: unknown;
    errors?: Array<{ message?: string; extensions?: { code?: string } }>;
  },
  context: string,
  owner?: string,
  repo?: string,
): void {
  if (result.errors && result.errors.length > 0) {
    // Check for auth errors
    if (isAuthError(result)) {
      const hasSSOError = result.errors.some(
        (e) =>
          e.message?.toLowerCase().includes("sso") ||
          e.message?.toLowerCase().includes("organization"),
      );

      let errorMsg =
        `GitHub authentication error: Token is invalid or lacks required permissions.\n\n`;

      if (hasSSOError && owner) {
        errorMsg +=
          `⚠️  ORGANIZATION SSO REQUIRED: This repository belongs to an organization that requires SSO authorization.\n` +
          `Your token needs to be authorized for SSO. Steps:\n` +
          `1. Go to https://github.com/settings/tokens\n` +
          `2. Find your token and click "Configure SSO" or "Enable SSO"\n` +
          `3. Authorize the token for the "${owner}" organization\n` +
          `4. Try again\n\n`;
      }

      errorMsg += `Other possible causes:\n` +
        `1. The token is missing required scopes (needs 'repo' scope for private repos or 'public_repo' for public repos)\n` +
        `2. For fine-grained PATs: the token's resource owner doesn't match the repository owner, or the repository isn't in the token's allowed resources\n` +
        `3. The token has expired or been revoked\n` +
        `4. Organization-level IP allowlist restrictions\n` +
        `5. The token belongs to a different GitHub account than the one with repository access\n\n` +
        `Please check your token permissions at https://github.com/settings/tokens`;

      if (owner && repo) {
        errorMsg += ` and ensure it can access ${owner}/${repo}`;
      }

      throw new Error(errorMsg);
    }

    // Other GraphQL errors
    const errorMessages = result.errors
      .map((e) => e.message ?? "Unknown error")
      .join("; ");
    throw new Error(`${context}: ${errorMessages}`);
  }
}

// GraphQL Queries

const REPOSITORY_INFO_QUERY = `
  query GetRepositoryInfo($owner: String!, $name: String!) {
    repository(owner: $owner, name: $name) {
      name
      owner {
        login
      }
      defaultBranchRef {
        name
      }
    }
  }
`;

const ISSUES_QUERY = `
  query GetIssues(
    $owner: String!
    $name: String!
    $states: [IssueState!]
    $first: Int!
    $after: String
    $filterBy: IssueFilters
  ) {
    repository(owner: $owner, name: $name) {
      issues(
        states: $states
        first: $first
        after: $after
        filterBy: $filterBy
      ) {
        pageInfo {
          hasNextPage
          endCursor
        }
        nodes {
          number
          title
          state
          author {
            ... on User {
              login
            }
          }
          createdAt
          closedAt
          url
        }
      }
    }
  }
`;

const COMMITS_QUERY = `
  query GetCommits(
    $owner: String!
    $name: String!
    $since: GitTimestamp!
    $first: Int!
    $after: String
  ) {
    repository(owner: $owner, name: $name) {
      defaultBranchRef {
        target {
          ... on Commit {
            history(since: $since, first: $first, after: $after) {
              pageInfo {
                hasNextPage
                endCursor
              }
              nodes {
                oid
                message
                author {
                  name
                  date
                }
                url
              }
            }
          }
        }
      }
    }
  }
`;

const ISSUE_QUERY = `
  query GetIssue($owner: String!, $name: String!, $number: Int!) {
    repository(owner: $owner, name: $name) {
      issue(number: $number) {
        number
        title
        body
        labels(first: 100) {
          nodes {
            name
          }
        }
        url
      }
    }
  }
`;

const PULL_REQUEST_QUERY = `
  query GetPullRequest($owner: String!, $name: String!, $number: Int!) {
    repository(owner: $owner, name: $name) {
      pullRequest(number: $number) {
        number
        title
        body
        labels(first: 100) {
          nodes {
            name
          }
        }
        url
      }
    }
  }
`;

const PULL_REQUEST_WITH_COMMENTS_QUERY = `
  query GetPullRequestWithComments($owner: String!, $name: String!, $number: Int!) {
    repository(owner: $owner, name: $name) {
      pullRequest(number: $number) {
        number
        title
        body
        url
        headRefName
        labels(first: 100) {
          nodes {
            name
          }
        }
        comments(first: 100) {
          nodes {
            id
            body
            author {
              login
            }
            createdAt
            updatedAt
          }
        }
        reviews(first: 100) {
          nodes {
            id
            body
            state
            author {
              login
            }
            createdAt
            comments(first: 100) {
              nodes {
                id
                body
                path
                line
                author {
                  login
                }
                createdAt
              }
            }
          }
        }
      }
    }
  }
`;

// Type definitions for GraphQL responses

interface RepositoryInfoResponse {
  repository: {
    name: string;
    owner: {
      login: string;
    };
    defaultBranchRef: {
      name: string;
    } | null;
  } | null;
}

interface IssuesResponse {
  repository: {
    issues: {
      pageInfo: {
        hasNextPage: boolean;
        endCursor: string | null;
      };
      nodes: Array<{
        number: number;
        title: string;
        state: string;
        author: {
          login: string;
        } | null;
        createdAt: string;
        closedAt: string | null;
        url: string;
      }>;
    };
  } | null;
}

interface CommitsResponse {
  repository: {
    defaultBranchRef: {
      target: {
        history: {
          pageInfo: {
            hasNextPage: boolean;
            endCursor: string | null;
          };
          nodes: Array<{
            oid: string;
            message: string;
            author: {
              name: string;
              date: string;
            };
            url: string;
          }>;
        };
      };
    } | null;
  } | null;
}

interface IssueResponse {
  repository: {
    issue: {
      number: number;
      title: string;
      body: string;
      labels: {
        nodes: Array<{
          name: string;
        }>;
      };
      url: string;
    } | null;
  } | null;
}

interface PullRequestResponse {
  repository: {
    pullRequest: {
      number: number;
      title: string;
      body: string;
      labels: {
        nodes: Array<{
          name: string;
        }>;
      };
      url: string;
    } | null;
  } | null;
}

/**
 * Represents a comment on a PR (issue-style conversation comment).
 */
export interface PRComment {
  id: string;
  body: string;
  author: string;
  createdAt: string;
  updatedAt: string;
}

/**
 * Represents a review comment on a specific file/line.
 */
export interface PRReviewComment {
  id: string;
  body: string;
  path: string;
  line: number | null;
  author: string;
  createdAt: string;
}

/**
 * Represents a review on a PR.
 */
export interface PRReview {
  id: string;
  body: string;
  state: string;
  author: string;
  createdAt: string;
  comments: PRReviewComment[];
}

/**
 * Pull request data including all comments.
 */
export interface PullRequestData {
  number: number;
  title: string;
  body: string;
  url: string;
  headRefName: string;
  labels: string[];
  owner: string;
  repo: string;
  comments: PRComment[];
  reviews: PRReview[];
}

interface PullRequestWithCommentsResponse {
  repository: {
    pullRequest: {
      number: number;
      title: string;
      body: string;
      url: string;
      headRefName: string;
      labels: {
        nodes: Array<{
          name: string;
        }>;
      };
      comments: {
        nodes: Array<{
          id: string;
          body: string;
          author: {
            login: string;
          } | null;
          createdAt: string;
          updatedAt: string;
        }>;
      };
      reviews: {
        nodes: Array<{
          id: string;
          body: string;
          state: string;
          author: {
            login: string;
          } | null;
          createdAt: string;
          comments: {
            nodes: Array<{
              id: string;
              body: string;
              path: string;
              line: number | null;
              author: {
                login: string;
              } | null;
              createdAt: string;
            }>;
          };
        }>;
      };
    } | null;
  } | null;
}

/**
 * Parse owner and repo from a GitHub URL.
 */
function parseGitHubUrl(url: string): { owner: string; repo: string } | null {
  // Match patterns like:
  // - https://github.com/owner/repo
  // - https://github.com/owner/repo.git
  // - git@github.com:owner/repo.git
  const patterns = [
    /^https?:\/\/github\.com\/([^\/]+)\/([^\/]+?)(?:\.git)?(?:\/|$)/,
    /^git@github\.com:([^\/]+)\/([^\/]+?)(?:\.git)?$/,
  ];

  for (const pattern of patterns) {
    const match = url.match(pattern);
    if (match) {
      return { owner: match[1], repo: match[2] };
    }
  }

  return null;
}

/**
 * Get the current repository owner and name by parsing the remote URL.
 * Works with both git and sapling repositories.
 */
export async function getCurrentRepoFromRemote(): Promise<{
  owner: string;
  repo: string;
}> {
  // Try sapling first - only catch command execution errors, not GraphQL verification errors
  let saplingPath: string | null = null;
  try {
    saplingPath = await $`sl paths default`.text();
  } catch (_error) {
    // Not sapling, will try git below
    saplingPath = null;
  }

  // If sapling command succeeded, try to parse and verify
  if (saplingPath) {
    const parsed = parseGitHubUrl(saplingPath.trim());
    if (parsed) {
      // Verify with GraphQL API
      const client = await getClient();
      const result = await client.query(REPOSITORY_INFO_QUERY, {
        variables: {
          owner: parsed.owner,
          name: parsed.repo,
        },
        cacheRead: false,
        cacheWrite: false,
      });

      handleGraphQLErrors(
        result,
        "Failed to verify repository",
        parsed.owner,
        parsed.repo,
      );

      if (!result.data) {
        throw new Error(`Failed to verify repository: No data returned`);
      }

      const data = result.data as RepositoryInfoResponse;

      if (!data.repository) {
        // Check if we only got schema introspection (permissions issue)
        const hasOnlySchema = result.data &&
          typeof result.data === "object" &&
          Object.keys(result.data).length === 1 &&
          "__schema" in result.data;

        if (hasOnlySchema) {
          // Check for SSO or organization restrictions in errors
          const hasSSOError = result.errors?.some(
            (e) =>
              e.message?.toLowerCase().includes("sso") ||
              e.message?.toLowerCase().includes("organization"),
          ) || false;

          let errorMsg =
            `Repository ${parsed.owner}/${parsed.repo} access denied. Your GitHub token does not have permission to access this repository.\n\n`;

          if (hasSSOError) {
            errorMsg +=
              `⚠️  ORGANIZATION SSO REQUIRED: This repository belongs to an organization that requires SSO authorization.\n` +
              `Your token needs to be authorized for SSO. Steps:\n` +
              `1. Go to https://github.com/settings/tokens\n` +
              `2. Find your token and click "Configure SSO" or "Enable SSO"\n` +
              `3. Authorize the token for the "${parsed.owner}" organization\n` +
              `4. Try again\n\n`;
          }

          errorMsg += `Other possible causes:\n` +
            `1. The token is missing required scopes (needs 'repo' scope for private repos or 'public_repo' for public repos)\n` +
            `2. For fine-grained PATs: the token's resource owner doesn't match the repository owner, or the repository isn't in the token's allowed resources\n` +
            `3. The token has expired or been revoked\n` +
            `4. Organization-level IP allowlist restrictions\n` +
            `5. The token belongs to a different GitHub account than the one with repository access\n\n` +
            `Please check your token permissions at https://github.com/settings/tokens and ensure it can access ${parsed.owner}/${parsed.repo}`;

          throw new Error(errorMsg);
        }

        throw new Error(
          `Repository ${parsed.owner}/${parsed.repo} not found or access denied`,
        );
      }

      return {
        owner: data.repository.owner.login,
        repo: data.repository.name,
      };
    }
  }

  // Try git - only catch command execution errors, not GraphQL verification errors
  let gitRemote: string | null = null;
  try {
    gitRemote = await $`git remote get-url origin`.text();
  } catch (_error) {
    gitRemote = null;
  }

  // If git command succeeded, try to parse and verify
  if (gitRemote) {
    const parsed = parseGitHubUrl(gitRemote.trim());
    if (parsed) {
      // Verify with GraphQL API
      const client = await getClient();
      const result = await client.query(REPOSITORY_INFO_QUERY, {
        variables: {
          owner: parsed.owner,
          name: parsed.repo,
        },
        cacheRead: false,
        cacheWrite: false,
      });

      handleGraphQLErrors(
        result,
        "Failed to verify repository",
        parsed.owner,
        parsed.repo,
      );

      if (!result.data) {
        throw new Error(`Failed to verify repository: No data returned`);
      }

      const data = result.data as RepositoryInfoResponse;

      if (!data.repository) {
        // Check if we only got schema introspection (permissions issue)
        const hasOnlySchema = result.data &&
          typeof result.data === "object" &&
          Object.keys(result.data).length === 1 &&
          "__schema" in result.data;

        if (hasOnlySchema) {
          // Check for SSO or organization restrictions in errors
          const hasSSOError = result.errors?.some(
            (e) =>
              e.message?.toLowerCase().includes("sso") ||
              e.message?.toLowerCase().includes("organization"),
          ) || false;

          let errorMsg =
            `Repository ${parsed.owner}/${parsed.repo} access denied. Your GitHub token does not have permission to access this repository.\n\n`;

          if (hasSSOError) {
            errorMsg +=
              `⚠️  ORGANIZATION SSO REQUIRED: This repository belongs to an organization that requires SSO authorization.\n` +
              `Your token needs to be authorized for SSO. Steps:\n` +
              `1. Go to https://github.com/settings/tokens\n` +
              `2. Find your token and click "Configure SSO" or "Enable SSO"\n` +
              `3. Authorize the token for the "${parsed.owner}" organization\n` +
              `4. Try again\n\n`;
          }

          errorMsg += `Other possible causes:\n` +
            `1. The token is missing required scopes (needs 'repo' scope for private repos or 'public_repo' for public repos)\n` +
            `2. For fine-grained PATs: the token's resource owner doesn't match the repository owner, or the repository isn't in the token's allowed resources\n` +
            `3. The token has expired or been revoked\n` +
            `4. Organization-level IP allowlist restrictions\n` +
            `5. The token belongs to a different GitHub account than the one with repository access\n\n` +
            `Please check your token permissions at https://github.com/settings/tokens and ensure it can access ${parsed.owner}/${parsed.repo}`;

          throw new Error(errorMsg);
        }

        throw new Error(
          `Repository ${parsed.owner}/${parsed.repo} not found or access denied`,
        );
      }

      return {
        owner: data.repository.owner.login,
        repo: data.repository.name,
      };
    }
  }

  // Neither sapling nor git command succeeded
  if (!saplingPath && !gitRemote) {
    throw new Error(
      "Failed to get current repository. Make sure you're in a git or sapling repository with a GitHub remote.",
    );
  }

  // One of the commands succeeded but URL parsing or GraphQL verification failed
  throw new Error(
    "Could not determine repository from remote URL. Make sure you have a GitHub remote configured.",
  );
}

/**
 * Get the default branch name for a repository.
 */
export async function getDefaultBranch(
  owner: string,
  repo: string,
): Promise<string> {
  const client = await getClient();
  const result = await client.query(REPOSITORY_INFO_QUERY, {
    variables: {
      owner,
      name: repo,
    },
    cacheRead: false,
    cacheWrite: false,
  });

  handleGraphQLErrors(result, "Failed to get repository info", owner, repo);

  if (!result.data) {
    throw new Error(`Repository ${owner}/${repo} not found or access denied`);
  }

  const data = result.data as RepositoryInfoResponse;
  if (!data.repository) {
    throw new Error(`Repository ${owner}/${repo} not found or access denied`);
  }

  return data.repository.defaultBranchRef?.name || "main";
}

/**
 * Fetch all issues with pagination support.
 */
async function fetchAllIssues(
  owner: string,
  repo: string,
  states: ("OPEN" | "CLOSED")[],
  filterBy?: { since?: string },
): Promise<Issue[]> {
  const client = await getClient();
  const allIssues: Issue[] = [];
  let cursor: string | null = null;
  let hasNextPage = true;

  while (hasNextPage) {
    const result = await client.query(ISSUES_QUERY, {
      variables: {
        owner,
        name: repo,
        states,
        first: 100,
        after: cursor,
        filterBy: filterBy ? { since: filterBy.since } : undefined,
      },
      cacheRead: false,
      cacheWrite: false,
    });

    handleGraphQLErrors(result, "Failed to fetch issues", owner, repo);

    if (!result.data) {
      throw new Error(`Repository ${owner}/${repo} not found or access denied`);
    }

    const data = result.data as IssuesResponse;
    if (!data.repository) {
      throw new Error(`Repository ${owner}/${repo} not found or access denied`);
    }

    const issues = data.repository.issues.nodes;
    for (const issue of issues) {
      allIssues.push({
        number: issue.number,
        title: issue.title,
        state: issue.state.toLowerCase() as "open" | "closed",
        author: issue.author?.login || "unknown",
        createdAt: issue.createdAt,
        closedAt: issue.closedAt,
        url: issue.url,
      });
    }

    hasNextPage = data.repository.issues.pageInfo.hasNextPage;
    cursor = data.repository.issues.pageInfo.endCursor;
  }

  return allIssues;
}

/**
 * Fetch issues opened since a given date.
 */
export async function fetchIssuesOpened(
  owner: string,
  repo: string,
  since: Date,
): Promise<Issue[]> {
  const issues = await fetchAllIssues(owner, repo, ["OPEN", "CLOSED"], {
    since: since.toISOString(),
  });

  // Filter by created date
  return issues.filter((issue) => {
    const created = new Date(issue.createdAt);
    return created >= since;
  });
}

/**
 * Fetch issues closed since a given date.
 */
export async function fetchIssuesClosed(
  owner: string,
  repo: string,
  since: Date,
): Promise<Issue[]> {
  const issues = await fetchAllIssues(owner, repo, ["CLOSED"]);

  // Filter by closed date
  return issues.filter((issue) => {
    if (!issue.closedAt) return false;
    const closed = new Date(issue.closedAt);
    return closed >= since;
  });
}

/**
 * Fetch commits since a given date.
 */
export async function fetchCommits(
  owner: string,
  repo: string,
  since: Date,
): Promise<Commit[]> {
  const client = await getClient();
  const allCommits: Commit[] = [];
  let cursor: string | null = null;
  let hasNextPage = true;

  while (hasNextPage) {
    const result = await client.query(COMMITS_QUERY, {
      variables: {
        owner,
        name: repo,
        since: since.toISOString(),
        first: 100,
        after: cursor,
      },
      cacheRead: false,
      cacheWrite: false,
    });

    handleGraphQLErrors(result, "Failed to fetch commits", owner, repo);

    if (!result.data) {
      throw new Error(`Repository ${owner}/${repo} not found or access denied`);
    }

    const data = result.data as CommitsResponse;
    if (!data.repository?.defaultBranchRef?.target) {
      // No default branch or no commits
      break;
    }

    const commits = data.repository.defaultBranchRef.target.history.nodes;
    for (const commit of commits) {
      const commitDate = new Date(commit.author.date);
      if (commitDate >= since) {
        allCommits.push({
          sha: commit.oid.substring(0, 7),
          message: commit.message.split("\n")[0], // First line only
          author: commit.author.name,
          date: commit.author.date,
          url: commit.url,
        });
      }
    }

    hasNextPage =
      data.repository.defaultBranchRef.target.history.pageInfo.hasNextPage;
    cursor = data.repository.defaultBranchRef.target.history.pageInfo.endCursor;
  }

  return allCommits;
}

/**
 * Fetch a single issue by URL.
 */
export async function fetchIssueFromUrl(issueUrl: string): Promise<IssueData> {
  // Extract repo owner/name and issue number from URL
  const urlMatch = issueUrl.match(
    /https?:\/\/github\.com\/([^/]+)\/([^/]+)\/issues\/(\d+)/,
  );
  if (!urlMatch) {
    throw new Error(`Invalid issue URL format: ${issueUrl}`);
  }

  const [, owner, repo, issueNumStr] = urlMatch;
  const issueNum = parseInt(issueNumStr, 10);

  const client = await getClient();
  const result = await client.query(ISSUE_QUERY, {
    variables: {
      owner,
      name: repo,
      number: issueNum,
    },
    cacheRead: false,
    cacheWrite: false,
  });

  handleGraphQLErrors(result, "Failed to fetch issue", owner, repo);

  if (!result.data) {
    throw new Error(
      `Repository ${owner}/${repo} not found or access denied. Check token permissions and repository name.`,
    );
  }

  const data = result.data as IssueResponse;

  // Check if repository is null (access denied or doesn't exist)
  // Also check if result.data only contains __schema (query didn't execute)
  if (!data.repository) {
    const hasOnlySchema = result.data &&
      typeof result.data === "object" &&
      Object.keys(result.data).length === 1 &&
      "__schema" in result.data;

    // Provide a more helpful error message
    if (hasOnlySchema) {
      throw new Error(
        `Query to repository ${owner}/${repo} returned only introspection data (__schema), not the actual query result. This usually means:\n` +
          `1. The token does not have permission to access ${owner}/${repo}\n` +
          `2. The repository does not exist\n` +
          `3. The token's resource owner does not match the repository owner (for fine-grained PATs)\n` +
          `Please check your token permissions and ensure it can access this repository.`,
      );
    }

    throw new Error(
      `Repository ${owner}/${repo} not found or access denied. Check token permissions and repository name.`,
    );
  }

  // Try issue first
  if (data.repository.issue) {
    const issue = data.repository.issue;
    const labels = issue.labels.nodes.map((l) => l.name);

    return {
      number: issue.number,
      title: issue.title,
      body: issue.body,
      labels,
      repo,
      owner,
    };
  }

  // If issue is null, it might be a Pull Request - try querying as PR
  try {
    const prResult = await client.query(PULL_REQUEST_QUERY, {
      variables: {
        owner,
        name: repo,
        number: issueNum,
      },
      cacheRead: false,
      cacheWrite: false,
    });

    handleGraphQLErrors(prResult, "Failed to fetch as PR", owner, repo);

    if (!prResult.data) {
      throw new Error(`Failed to fetch as PR: No data returned`);
    }

    const prData = prResult.data as PullRequestResponse;
    if (prData.repository?.pullRequest) {
      const pr = prData.repository.pullRequest;
      const labels = pr.labels.nodes.map((l: { name: string }) => l.name);

      return {
        number: pr.number,
        title: pr.title,
        body: pr.body,
        labels,
        repo,
        owner,
      };
    }
  } catch {
    // Fall through to throw the original error
  }

  // Neither issue nor PR found
  throw new Error(
    `Issue/PR #${issueNum} not found in ${owner}/${repo}. It may not exist, or you may not have access. Check token permissions.`,
  );
}

/**
 * Parse a GitHub PR URL to extract owner, repo, and PR number.
 * Supports formats like:
 * - https://github.com/owner/repo/pull/123
 * - https://github.com/owner/repo/pull/123/files
 * - https://github.com/owner/repo/pull/123#issuecomment-456
 */
export function parsePullRequestUrl(
  prUrl: string,
): { owner: string; repo: string; number: number } | null {
  const urlMatch = prUrl.match(
    /https?:\/\/github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)/,
  );
  if (!urlMatch) {
    return null;
  }

  return {
    owner: urlMatch[1],
    repo: urlMatch[2],
    number: parseInt(urlMatch[3], 10),
  };
}

/**
 * Fetch a pull request with all comments (issue comments + review comments).
 */
export async function fetchPullRequestWithComments(
  prUrl: string,
): Promise<PullRequestData> {
  const parsed = parsePullRequestUrl(prUrl);
  if (!parsed) {
    throw new Error(
      `Invalid PR URL format: ${prUrl}. Expected format: https://github.com/owner/repo/pull/123`,
    );
  }

  const { owner, repo, number: prNum } = parsed;

  const client = await getClient();
  const result = await client.query(PULL_REQUEST_WITH_COMMENTS_QUERY, {
    variables: {
      owner,
      name: repo,
      number: prNum,
    },
    cacheRead: false,
    cacheWrite: false,
  });

  handleGraphQLErrors(result, "Failed to fetch pull request", owner, repo);

  if (!result.data) {
    throw new Error(
      `Repository ${owner}/${repo} not found or access denied. Check token permissions and repository name.`,
    );
  }

  const data = result.data as PullRequestWithCommentsResponse;

  if (!data.repository) {
    const hasOnlySchema = result.data &&
      typeof result.data === "object" &&
      Object.keys(result.data).length === 1 &&
      "__schema" in result.data;

    if (hasOnlySchema) {
      throw new Error(
        `Query to repository ${owner}/${repo} returned only introspection data. ` +
          `Please check your token permissions.`,
      );
    }

    throw new Error(
      `Repository ${owner}/${repo} not found or access denied. Check token permissions.`,
    );
  }

  if (!data.repository.pullRequest) {
    throw new Error(
      `Pull request #${prNum} not found in ${owner}/${repo}. It may not exist or you may not have access.`,
    );
  }

  const pr = data.repository.pullRequest;

  // Map issue-style comments
  const comments: PRComment[] = pr.comments.nodes.map((c) => ({
    id: c.id,
    body: c.body,
    author: c.author?.login || "unknown",
    createdAt: c.createdAt,
    updatedAt: c.updatedAt,
  }));

  // Map reviews and their comments
  const reviews: PRReview[] = pr.reviews.nodes.map((r) => ({
    id: r.id,
    body: r.body,
    state: r.state,
    author: r.author?.login || "unknown",
    createdAt: r.createdAt,
    comments: r.comments.nodes.map((rc) => ({
      id: rc.id,
      body: rc.body,
      path: rc.path,
      line: rc.line,
      author: rc.author?.login || "unknown",
      createdAt: rc.createdAt,
    })),
  }));

  return {
    number: pr.number,
    title: pr.title,
    body: pr.body,
    url: pr.url,
    headRefName: pr.headRefName,
    labels: pr.labels.nodes.map((l) => l.name),
    owner,
    repo,
    comments,
    reviews,
  };
}

// ============================================================================
// Issue CRUD Operations
// ============================================================================

const LIST_ISSUES_FILTERED_QUERY = `
  query ListIssues(
    $owner: String!
    $name: String!
    $states: [IssueState!]
    $labels: [String!]
    $first: Int!
    $after: String
  ) {
    repository(owner: $owner, name: $name) {
      issues(
        states: $states
        labels: $labels
        first: $first
        after: $after
        orderBy: { field: UPDATED_AT, direction: DESC }
      ) {
        pageInfo {
          hasNextPage
          endCursor
        }
        nodes {
          id
          number
          title
          state
          body
          author {
            login
          }
          assignees(first: 10) {
            nodes {
              login
            }
          }
          labels(first: 20) {
            nodes {
              name
            }
          }
          createdAt
          updatedAt
          closedAt
          url
        }
      }
    }
  }
`;

const GET_ISSUE_WITH_COMMENTS_QUERY = `
  query GetIssueWithComments($owner: String!, $name: String!, $number: Int!) {
    repository(owner: $owner, name: $name) {
      issue(number: $number) {
        id
        number
        title
        body
        state
        author {
          login
        }
        assignees(first: 10) {
          nodes {
            login
          }
        }
        labels(first: 20) {
          nodes {
            name
          }
        }
        comments(first: 100) {
          nodes {
            id
            body
            author {
              login
            }
            createdAt
          }
        }
        createdAt
        updatedAt
        closedAt
        url
      }
    }
  }
`;

const CREATE_ISSUE_MUTATION = `
  mutation CreateIssue($input: CreateIssueInput!) {
    createIssue(input: $input) {
      issue {
        id
        number
        title
        body
        url
        state
      }
    }
  }
`;

const UPDATE_ISSUE_MUTATION = `
  mutation UpdateIssue($input: UpdateIssueInput!) {
    updateIssue(input: $input) {
      issue {
        id
        number
        title
        body
        url
        state
      }
    }
  }
`;

const CLOSE_ISSUE_MUTATION = `
  mutation CloseIssue($input: CloseIssueInput!) {
    closeIssue(input: $input) {
      issue {
        id
        number
        state
        url
      }
    }
  }
`;

const REOPEN_ISSUE_MUTATION = `
  mutation ReopenIssue($input: ReopenIssueInput!) {
    reopenIssue(input: $input) {
      issue {
        id
        number
        state
        url
      }
    }
  }
`;

const ADD_ISSUE_COMMENT_MUTATION = `
  mutation AddIssueComment($input: AddCommentInput!) {
    addComment(input: $input) {
      commentEdge {
        node {
          id
          body
          author {
            login
          }
          createdAt
          url
        }
      }
    }
  }
`;

const GET_REPOSITORY_ID_AND_LABELS_QUERY = `
  query GetRepositoryIdAndLabels($owner: String!, $name: String!) {
    repository(owner: $owner, name: $name) {
      id
      labels(first: 100, query: "") {
        nodes {
          id
          name
        }
      }
    }
  }
`;

const GET_ISSUE_ID_QUERY = `
  query GetIssueId($owner: String!, $name: String!, $number: Int!) {
    repository(owner: $owner, name: $name) {
      issue(number: $number) {
        id
      }
    }
  }
`;

// Type definitions for Issue CRUD

/**
 * Extended issue data including comments.
 */
export interface IssueWithComments {
  id: string;
  number: number;
  title: string;
  body: string;
  state: "OPEN" | "CLOSED";
  author: string;
  assignees: string[];
  labels: string[];
  comments: IssueComment[];
  createdAt: string;
  updatedAt: string;
  closedAt: string | null;
  url: string;
}

/**
 * Issue comment data.
 */
export interface IssueComment {
  id: string;
  body: string;
  author: string;
  createdAt: string;
}

/**
 * Issue list item (less detail than full issue).
 */
export interface IssueListItem {
  id: string;
  number: number;
  title: string;
  state: "OPEN" | "CLOSED";
  author: string;
  assignees: string[];
  labels: string[];
  createdAt: string;
  updatedAt: string;
  closedAt: string | null;
  url: string;
}

/**
 * Options for listing issues.
 */
export interface ListIssuesOptions {
  state?: "open" | "closed" | "all";
  labels?: string[];
  limit?: number;
}

/**
 * Options for creating an issue.
 */
export interface CreateIssueOptions {
  title: string;
  body?: string;
  labels?: string[];
  assignees?: string[];
}

/**
 * Options for updating an issue.
 */
export interface UpdateIssueOptions {
  title?: string;
  body?: string;
  addLabels?: string[];
  removeLabels?: string[];
  assignees?: string[];
}

/**
 * Result of creating or updating an issue.
 */
export interface IssueResult {
  id: string;
  number: number;
  title: string;
  body: string;
  url: string;
  state: string;
}

/**
 * Result of adding a comment.
 */
export interface CommentResult {
  id: string;
  body: string;
  author: string;
  createdAt: string;
  url: string;
}

// Response types

interface ListIssuesResponse {
  repository: {
    issues: {
      pageInfo: {
        hasNextPage: boolean;
        endCursor: string | null;
      };
      nodes: Array<{
        id: string;
        number: number;
        title: string;
        state: "OPEN" | "CLOSED";
        body: string;
        author: { login: string } | null;
        assignees: { nodes: Array<{ login: string }> };
        labels: { nodes: Array<{ name: string }> };
        createdAt: string;
        updatedAt: string;
        closedAt: string | null;
        url: string;
      }>;
    };
  } | null;
}

interface IssueWithCommentsResponse {
  repository: {
    issue: {
      id: string;
      number: number;
      title: string;
      body: string;
      state: "OPEN" | "CLOSED";
      author: { login: string } | null;
      assignees: { nodes: Array<{ login: string }> };
      labels: { nodes: Array<{ name: string }> };
      comments: {
        nodes: Array<{
          id: string;
          body: string;
          author: { login: string } | null;
          createdAt: string;
        }>;
      };
      createdAt: string;
      updatedAt: string;
      closedAt: string | null;
      url: string;
    } | null;
  } | null;
}

interface RepositoryIdAndLabelsResponse {
  repository: {
    id: string;
    labels: {
      nodes: Array<{ id: string; name: string }>;
    };
  } | null;
}

interface IssueIdResponse {
  repository: {
    issue: {
      id: string;
    } | null;
  } | null;
}

interface CreateIssueResponse {
  createIssue: {
    issue: {
      id: string;
      number: number;
      title: string;
      body: string;
      url: string;
      state: string;
    };
  } | null;
}

interface UpdateIssueResponse {
  updateIssue: {
    issue: {
      id: string;
      number: number;
      title: string;
      body: string;
      url: string;
      state: string;
    };
  } | null;
}

interface CloseReopenIssueResponse {
  closeIssue?: {
    issue: {
      id: string;
      number: number;
      state: string;
      url: string;
    };
  };
  reopenIssue?: {
    issue: {
      id: string;
      number: number;
      state: string;
      url: string;
    };
  };
}

interface AddCommentResponse {
  addComment: {
    commentEdge: {
      node: {
        id: string;
        body: string;
        author: { login: string } | null;
        createdAt: string;
        url: string;
      };
    };
  } | null;
}

/**
 * List issues in a repository with optional filters.
 */
export async function listIssues(
  owner: string,
  repo: string,
  options: ListIssuesOptions = {},
): Promise<IssueListItem[]> {
  const client = await getClient();
  const { state = "open", labels, limit = 30 } = options;

  const states: ("OPEN" | "CLOSED")[] = state === "all"
    ? ["OPEN", "CLOSED"]
    : state === "closed"
    ? ["CLOSED"]
    : ["OPEN"];

  const allIssues: IssueListItem[] = [];
  let cursor: string | null = null;
  let hasNextPage = true;
  let remaining = limit;

  while (hasNextPage && remaining > 0) {
    const fetchCount = Math.min(remaining, 100);

    const result = await client.query(LIST_ISSUES_FILTERED_QUERY, {
      variables: {
        owner,
        name: repo,
        states,
        labels: labels && labels.length > 0 ? labels : null,
        first: fetchCount,
        after: cursor,
      },
      cacheRead: false,
      cacheWrite: false,
    });

    handleGraphQLErrors(result, "Failed to list issues", owner, repo);

    if (!result.data) {
      throw new Error(`Repository ${owner}/${repo} not found or access denied`);
    }

    const data = result.data as ListIssuesResponse;
    if (!data.repository) {
      throw new Error(`Repository ${owner}/${repo} not found or access denied`);
    }

    for (const issue of data.repository.issues.nodes) {
      if (remaining <= 0) break;
      allIssues.push({
        id: issue.id,
        number: issue.number,
        title: issue.title,
        state: issue.state,
        author: issue.author?.login || "unknown",
        assignees: issue.assignees.nodes.map((a) => a.login),
        labels: issue.labels.nodes.map((l) => l.name),
        createdAt: issue.createdAt,
        updatedAt: issue.updatedAt,
        closedAt: issue.closedAt,
        url: issue.url,
      });
      remaining--;
    }

    hasNextPage = data.repository.issues.pageInfo.hasNextPage;
    cursor = data.repository.issues.pageInfo.endCursor;
  }

  return allIssues;
}

/**
 * Get a single issue with comments.
 */
export async function getIssueWithComments(
  owner: string,
  repo: string,
  issueNumber: number,
): Promise<IssueWithComments> {
  const client = await getClient();

  const result = await client.query(GET_ISSUE_WITH_COMMENTS_QUERY, {
    variables: {
      owner,
      name: repo,
      number: issueNumber,
    },
    cacheRead: false,
    cacheWrite: false,
  });

  handleGraphQLErrors(result, "Failed to get issue", owner, repo);

  if (!result.data) {
    throw new Error(`Repository ${owner}/${repo} not found or access denied`);
  }

  const data = result.data as IssueWithCommentsResponse;
  if (!data.repository) {
    throw new Error(`Repository ${owner}/${repo} not found or access denied`);
  }

  if (!data.repository.issue) {
    throw new Error(`Issue #${issueNumber} not found in ${owner}/${repo}`);
  }

  const issue = data.repository.issue;
  return {
    id: issue.id,
    number: issue.number,
    title: issue.title,
    body: issue.body,
    state: issue.state,
    author: issue.author?.login || "unknown",
    assignees: issue.assignees.nodes.map((a) => a.login),
    labels: issue.labels.nodes.map((l) => l.name),
    comments: issue.comments.nodes.map((c) => ({
      id: c.id,
      body: c.body,
      author: c.author?.login || "unknown",
      createdAt: c.createdAt,
    })),
    createdAt: issue.createdAt,
    updatedAt: issue.updatedAt,
    closedAt: issue.closedAt,
    url: issue.url,
  };
}

/**
 * Get the issue node ID for mutations.
 */
async function getIssueId(
  owner: string,
  repo: string,
  issueNumber: number,
): Promise<string> {
  const client = await getClient();

  const result = await client.query(GET_ISSUE_ID_QUERY, {
    variables: {
      owner,
      name: repo,
      number: issueNumber,
    },
    cacheRead: false,
    cacheWrite: false,
  });

  handleGraphQLErrors(result, "Failed to get issue ID", owner, repo);

  if (!result.data) {
    throw new Error(`Repository ${owner}/${repo} not found or access denied`);
  }

  const data = result.data as IssueIdResponse;
  if (!data.repository?.issue) {
    throw new Error(`Issue #${issueNumber} not found in ${owner}/${repo}`);
  }

  return data.repository.issue.id;
}

/**
 * Get repository ID and resolve label names to IDs.
 */
async function getRepositoryIdAndLabelIds(
  owner: string,
  repo: string,
  labelNames: string[],
): Promise<{ repoId: string; labelIds: string[] }> {
  const client = await getClient();

  const result = await client.query(GET_REPOSITORY_ID_AND_LABELS_QUERY, {
    variables: {
      owner,
      name: repo,
    },
    cacheRead: false,
    cacheWrite: false,
  });

  handleGraphQLErrors(result, "Failed to get repository info", owner, repo);

  if (!result.data) {
    throw new Error(`Repository ${owner}/${repo} not found or access denied`);
  }

  const data = result.data as RepositoryIdAndLabelsResponse;
  if (!data.repository) {
    throw new Error(`Repository ${owner}/${repo} not found or access denied`);
  }

  const labelMap = new Map<string, string>();
  for (const label of data.repository.labels.nodes) {
    labelMap.set(label.name.toLowerCase(), label.id);
  }

  const labelIds: string[] = [];
  for (const name of labelNames) {
    const id = labelMap.get(name.toLowerCase());
    if (id) {
      labelIds.push(id);
    } else {
      console.warn(`Label "${name}" not found in repository`);
    }
  }

  return { repoId: data.repository.id, labelIds };
}

/**
 * Create a new issue.
 */
export async function createIssue(
  owner: string,
  repo: string,
  options: CreateIssueOptions,
): Promise<IssueResult> {
  const client = await getClient();

  const { repoId, labelIds } = await getRepositoryIdAndLabelIds(
    owner,
    repo,
    options.labels || [],
  );

  const input: Record<string, unknown> = {
    repositoryId: repoId,
    title: options.title,
    body: options.body || "",
  };

  if (labelIds.length > 0) {
    input.labelIds = labelIds;
  }

  // Note: assignees requires user IDs, not logins. For simplicity, we skip assignees
  // in the create mutation. Users can update the issue afterward.

  const result = await client.mutate(CREATE_ISSUE_MUTATION, {
    variables: { input },
  });

  if (result.errors && result.errors.length > 0) {
    const errorMessages = result.errors
      .map((e) => e.message ?? "Unknown error")
      .join("; ");
    throw new Error(`Failed to create issue: ${errorMessages}`);
  }

  if (!result.data) {
    throw new Error("Failed to create issue: No data returned");
  }

  const data = result.data as CreateIssueResponse;
  if (!data.createIssue?.issue) {
    throw new Error("Failed to create issue: No issue returned");
  }

  return data.createIssue.issue;
}

/**
 * Update an existing issue.
 */
export async function updateIssue(
  owner: string,
  repo: string,
  issueNumber: number,
  options: UpdateIssueOptions,
): Promise<IssueResult> {
  const client = await getClient();

  const issueId = await getIssueId(owner, repo, issueNumber);

  const input: Record<string, unknown> = {
    id: issueId,
  };

  if (options.title !== undefined) {
    input.title = options.title;
  }

  if (options.body !== undefined) {
    input.body = options.body;
  }

  // Handle labels
  if (options.addLabels && options.addLabels.length > 0) {
    const { labelIds } = await getRepositoryIdAndLabelIds(
      owner,
      repo,
      options.addLabels,
    );
    if (labelIds.length > 0) {
      input.labelIds = labelIds;
    }
  }

  const result = await client.mutate(UPDATE_ISSUE_MUTATION, {
    variables: { input },
  });

  if (result.errors && result.errors.length > 0) {
    const errorMessages = result.errors
      .map((e) => e.message ?? "Unknown error")
      .join("; ");
    throw new Error(`Failed to update issue: ${errorMessages}`);
  }

  if (!result.data) {
    throw new Error("Failed to update issue: No data returned");
  }

  const data = result.data as UpdateIssueResponse;
  if (!data.updateIssue?.issue) {
    throw new Error("Failed to update issue: No issue returned");
  }

  return data.updateIssue.issue;
}

/**
 * Close an issue.
 */
export async function closeIssue(
  owner: string,
  repo: string,
  issueNumber: number,
  reason?: "COMPLETED" | "NOT_PLANNED",
): Promise<{ number: number; state: string; url: string }> {
  const client = await getClient();

  const issueId = await getIssueId(owner, repo, issueNumber);

  const input: Record<string, unknown> = {
    issueId,
  };

  if (reason) {
    input.stateReason = reason;
  }

  const result = await client.mutate(CLOSE_ISSUE_MUTATION, {
    variables: { input },
  });

  if (result.errors && result.errors.length > 0) {
    const errorMessages = result.errors
      .map((e) => e.message ?? "Unknown error")
      .join("; ");
    throw new Error(`Failed to close issue: ${errorMessages}`);
  }

  if (!result.data) {
    throw new Error("Failed to close issue: No data returned");
  }

  const data = result.data as CloseReopenIssueResponse;
  if (!data.closeIssue?.issue) {
    throw new Error("Failed to close issue: No issue returned");
  }

  return {
    number: data.closeIssue.issue.number,
    state: data.closeIssue.issue.state,
    url: data.closeIssue.issue.url,
  };
}

/**
 * Reopen a closed issue.
 */
export async function reopenIssue(
  owner: string,
  repo: string,
  issueNumber: number,
): Promise<{ number: number; state: string; url: string }> {
  const client = await getClient();

  const issueId = await getIssueId(owner, repo, issueNumber);

  const result = await client.mutate(REOPEN_ISSUE_MUTATION, {
    variables: {
      input: { issueId },
    },
  });

  if (result.errors && result.errors.length > 0) {
    const errorMessages = result.errors
      .map((e) => e.message ?? "Unknown error")
      .join("; ");
    throw new Error(`Failed to reopen issue: ${errorMessages}`);
  }

  if (!result.data) {
    throw new Error("Failed to reopen issue: No data returned");
  }

  const data = result.data as CloseReopenIssueResponse;
  if (!data.reopenIssue?.issue) {
    throw new Error("Failed to reopen issue: No issue returned");
  }

  return {
    number: data.reopenIssue.issue.number,
    state: data.reopenIssue.issue.state,
    url: data.reopenIssue.issue.url,
  };
}

/**
 * Add a comment to an issue.
 */
export async function addIssueComment(
  owner: string,
  repo: string,
  issueNumber: number,
  body: string,
): Promise<CommentResult> {
  const client = await getClient();

  const issueId = await getIssueId(owner, repo, issueNumber);

  const result = await client.mutate(ADD_ISSUE_COMMENT_MUTATION, {
    variables: {
      input: {
        subjectId: issueId,
        body,
      },
    },
  });

  if (result.errors && result.errors.length > 0) {
    const errorMessages = result.errors
      .map((e) => e.message ?? "Unknown error")
      .join("; ");
    throw new Error(`Failed to add comment: ${errorMessages}`);
  }

  if (!result.data) {
    throw new Error("Failed to add comment: No data returned");
  }

  const data = result.data as AddCommentResponse;
  if (!data.addComment?.commentEdge?.node) {
    throw new Error("Failed to add comment: No comment returned");
  }

  const node = data.addComment.commentEdge.node;
  return {
    id: node.id,
    body: node.body,
    author: node.author?.login || "unknown",
    createdAt: node.createdAt,
    url: node.url,
  };
}
