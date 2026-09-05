// Copyright 2026 Chesapeake Computing
// SPDX-License-Identifier: Apache-2.0

import {
  getClient,
  getCurrentRepoFromRemote,
  handleGraphQLErrors,
} from "./github-gql.ts";
import { parseConfiguredMilestoneUrl } from "./endpoints.ts";

const MILESTONE_QUERY = `
  query GetMilestone($owner: String!, $name: String!, $number: Int!) {
    repository(owner: $owner, name: $name) {
      milestone(number: $number) {
        id
        number
        title
        description
        state
        dueOn
        creator {
          login
        }
        createdAt
        updatedAt
        issues(states: OPEN, first: 100) {
          nodes {
            number
            title
            body
            state
            author {
              ... on User {
                login
              }
            }
            labels(first: 100) {
              nodes {
                name
              }
            }
            url
          }
        }
      }
    }
  }
`;

const MILESTONES_QUERY = `
  query GetMilestones($owner: String!, $name: String!, $first: Int!) {
    repository(owner: $owner, name: $name) {
      milestones(first: $first, states: OPEN) {
        nodes {
          number
          title
          description
          state
          dueOn
        }
      }
    }
  }
`;

const REPOSITORY_ID_QUERY = `
  query GetRepositoryId($owner: String!, $name: String!) {
    repository(owner: $owner, name: $name) {
      id
    }
  }
`;

const CREATE_MILESTONE_MUTATION = `
  mutation CreateMilestone($input: CreateMilestoneInput!) {
    createMilestone(input: $input) {
      milestone {
        id
        number
        title
        description
        state
        dueOn
      }
    }
  }
`;

export interface MilestoneIssue {
  number: number;
  title: string;
  body: string;
  state: string;
  author: string;
  labels: string[];
  url: string;
}

export interface Milestone {
  id: string;
  number: number;
  title: string;
  description: string | null;
  state: string;
  dueOn: string | null;
  creator: string;
  createdAt: string;
  updatedAt: string;
  issues: MilestoneIssue[];
}

interface MilestoneResponse {
  repository: {
    milestone: {
      id: string;
      number: number;
      title: string;
      description: string | null;
      state: string;
      dueOn: string | null;
      creator: { login: string } | null;
      createdAt: string;
      updatedAt: string;
      issues: {
        nodes: Array<{
          number: number;
          title: string;
          body: string;
          state: string;
          author: { login: string } | null;
          labels: { nodes: Array<{ name: string }> };
          url: string;
        }>;
      };
    } | null;
  };
}

interface MilestonesResponse {
  repository: {
    milestones: {
      nodes: Array<{
        number: number;
        title: string;
        description: string | null;
        state: string;
        dueOn: string | null;
      }>;
    };
  };
}

interface RepositoryIdResponse {
  repository: { id: string } | null;
}

interface CreateMilestoneResponse {
  createMilestone: {
    milestone: MilestoneListItem | null;
  } | null;
}

interface MilestoneListItem {
  id: string;
  number: number;
  title: string;
  description: string | null;
  state: string;
  dueOn: string | null;
}

/** Options used to create a GitHub milestone. */
export interface CreateMilestoneOptions {
  title: string;
  description?: string;
  dueOn?: string;
}

/** Summary returned when creating or listing a milestone. */
export interface MilestoneSummary {
  id: string;
  number: number;
  title: string;
  description: string | null;
  state: string;
  dueOn: string | null;
}

export function parseMilestoneUrl(url: string): {
  owner: string;
  repo: string;
  number: number;
} | null {
  return parseConfiguredMilestoneUrl(url);
}

export async function getMilestone(
  owner: string,
  repo: string,
  number: number,
): Promise<Milestone> {
  const client = await getClient();
  const result = await client.query(MILESTONE_QUERY, {
    variables: { owner, name: repo, number },
    cacheRead: false,
    cacheWrite: false,
  });

  handleGraphQLErrors(result, "Failed to get milestone", owner, repo);

  if (!result.data) {
    throw new Error(`Repository ${owner}/${repo} not found`);
  }

  const data = result.data as MilestoneResponse;
  if (!data.repository?.milestone) {
    throw new Error(
      `Milestone #${number} not found in ${owner}/${repo}`,
    );
  }

  const m = data.repository.milestone;
  return {
    id: m.id,
    number: m.number,
    title: m.title,
    description: m.description,
    state: m.state,
    dueOn: m.dueOn,
    creator: m.creator?.login || "unknown",
    createdAt: m.createdAt,
    updatedAt: m.updatedAt,
    issues: m.issues.nodes.map((i) => ({
      number: i.number,
      title: i.title,
      body: i.body || "",
      state: i.state,
      author: i.author?.login || "unknown",
      labels: i.labels.nodes.map((l) => l.name),
      url: i.url,
    })),
  };
}

/**
 * Finds an open milestone whose title matches the input (case-insensitive).
 *
 * @returns The matching milestone number, or `null` when no unique match exists.
 */
export function matchMilestoneByTitle(
  milestones: Array<{ number: number; title: string }>,
  title: string,
): number | null {
  const normalized = title.trim().toLowerCase();
  if (!normalized) {
    return null;
  }

  const matches = milestones.filter(
    (milestone) => milestone.title.trim().toLowerCase() === normalized,
  );

  if (matches.length === 1) {
    return matches[0].number;
  }

  return null;
}

export async function getMilestoneFromInput(
  input: string,
): Promise<{ milestone: Milestone; owner: string; repo: string }> {
  const trimmed = input.trim();

  const urlParsed = parseMilestoneUrl(trimmed);
  if (urlParsed) {
    const milestone = await getMilestone(
      urlParsed.owner,
      urlParsed.repo,
      urlParsed.number,
    );
    return { milestone, owner: urlParsed.owner, repo: urlParsed.repo };
  }

  const numMatch = trimmed.match(/^(\d+)$/);
  if (numMatch) {
    const { owner, repo } = await getCurrentRepoFromRemote();
    const milestone = await getMilestone(
      owner,
      repo,
      parseInt(numMatch[1], 10),
    );
    return { milestone, owner, repo };
  }

  const { owner, repo } = await getCurrentRepoFromRemote();
  const openMilestones = await listOpenMilestones(owner, repo);
  const matchedNumber = matchMilestoneByTitle(openMilestones, trimmed);
  if (matchedNumber !== null) {
    const milestone = await getMilestone(owner, repo, matchedNumber);
    return { milestone, owner, repo };
  }

  throw new Error(
    `Invalid milestone: ${input}. Provide a milestone URL (https://github.com/owner/repo/milestone/3), a milestone number, or an exact open milestone title.`,
  );
}

/** Resolve a milestone number or URL to its GraphQL node ID. */
export async function resolveMilestoneId(
  owner: string,
  repo: string,
  input: string,
): Promise<string> {
  const trimmed = input.trim();
  const urlParsed = parseMilestoneUrl(trimmed);
  if (urlParsed) {
    return (await getMilestone(
      urlParsed.owner,
      urlParsed.repo,
      urlParsed.number,
    )).id;
  }

  const number = Number(trimmed);
  if (!Number.isSafeInteger(number) || number < 1) {
    throw new Error(
      `Invalid milestone: ${input}. Provide a milestone number or URL.`,
    );
  }
  return (await getMilestone(owner, repo, number)).id;
}

/** Create an open GitHub milestone in a repository. */
export async function createMilestone(
  owner: string,
  repo: string,
  options: CreateMilestoneOptions,
): Promise<MilestoneSummary> {
  const client = await getClient();
  const repositoryResult = await client.query(REPOSITORY_ID_QUERY, {
    variables: { owner, name: repo },
    cacheRead: false,
    cacheWrite: false,
  });
  handleGraphQLErrors(
    repositoryResult,
    "Failed to create milestone",
    owner,
    repo,
  );
  const repositoryData = repositoryResult.data as RepositoryIdResponse | null;
  const repositoryId = repositoryData?.repository?.id;
  if (!repositoryId) {
    throw new Error(`Repository ${owner}/${repo} not found`);
  }

  const input: Record<string, unknown> = {
    repositoryId,
    title: options.title,
  };
  if (options.description !== undefined) {
    input.description = options.description;
  }
  if (options.dueOn !== undefined) input.dueOn = options.dueOn;

  const result = await client.mutate(CREATE_MILESTONE_MUTATION, {
    variables: { input },
  });
  handleGraphQLErrors(result, "Failed to create milestone", owner, repo);
  const data = result.data as CreateMilestoneResponse | null;
  const milestone = data?.createMilestone?.milestone;
  if (!milestone) {
    throw new Error("Failed to create milestone: No milestone returned");
  }
  return milestone;
}

export async function listOpenMilestones(
  owner: string,
  repo: string,
): Promise<
  Array<
    {
      number: number;
      title: string;
      description: string | null;
      state: string;
      dueOn: string | null;
    }
  >
> {
  const client = await getClient();
  const result = await client.query(MILESTONES_QUERY, {
    variables: { owner, name: repo, first: 50 },
    cacheRead: false,
    cacheWrite: false,
  });

  handleGraphQLErrors(result, "Failed to list milestones", owner, repo);

  const data = result.data as MilestonesResponse;
  if (!data.repository?.milestones) {
    return [];
  }

  return data.repository.milestones.nodes.map((m) => ({
    number: m.number,
    title: m.title,
    description: m.description,
    state: m.state,
    dueOn: m.dueOn,
  }));
}
