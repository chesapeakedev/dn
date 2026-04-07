// Copyright 2026 Chesapeake Computing
// SPDX-License-Identifier: Apache-2.0

import {
  getClient,
  getCurrentRepoFromRemote,
  handleGraphQLErrors,
} from "./github-gql.ts";

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

const MILESTONE_URL_RE =
  /^https?:\/\/github\.com\/([^/]+)\/([^/]+)\/milestone\/(\d+)(?:\?.*)?$/i;

export function parseMilestoneUrl(url: string): {
  owner: string;
  repo: string;
  number: number;
} | null {
  const match = url.match(MILESTONE_URL_RE);
  if (!match) return null;
  return {
    owner: match[1],
    repo: match[2],
    number: parseInt(match[3], 10),
  };
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

  throw new Error(
    `Invalid milestone: ${input}. Provide a milestone URL (https://github.com/owner/repo/milestone/3) or a milestone number.`,
  );
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
