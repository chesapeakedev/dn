// Copyright 2026 Chesapeake Computing
// SPDX-License-Identifier: Apache-2.0

import { $ } from "$dax";
import { resolveGitHubToken } from "./token.ts";

const CREATE_LABEL_MUTATION = `
  mutation CreateLabel($input: CreateLabelInput!) {
    createLabel(input: $input) {
      label {
        id
        name
        color
        description
      }
    }
  }
`;

const GET_LABELS_QUERY = `
  query GetLabels($owner: String!, $name: String!, $first: Int!) {
    repository(owner: $owner, name: $name) {
      labels(first: $first) {
        nodes {
          name
        }
      }
    }
  }
`;

const DELETE_LABEL_MUTATION = `
  mutation DeleteLabel($input: DeleteLabelInput!) {
    deleteLabel(input: $input) {
      deletedLabelId
    }
  }
`;

export interface LabelOptions {
  color?: string;
  description?: string;
}

export interface Label {
  id: string;
  name: string;
  color?: string;
  description?: string;
}

interface CreateLabelResponse {
  createLabel?: {
    label: {
      id: string;
      name: string;
      color: string;
      description: string;
    };
  };
}

interface GetLabelsResponse {
  repository?: {
    labels?: {
      nodes?: Array<{ name: string }>;
    };
  };
}

interface DeleteLabelResponse {
  deleteLabel?: {
    deletedLabelId: string;
  };
}

async function graphqlRequest<T>(
  query: string,
  variables: Record<string, unknown>,
): Promise<T> {
  const token = await resolveGitHubToken();
  const response = await fetch("https://api.github.com/graphql", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      "User-Agent": "dn-github-graphql",
    },
    body: JSON.stringify({ query, variables }),
  });

  if (!response.ok) {
    throw new Error(
      `GraphQL request failed: ${response.status} ${response.statusText}`,
    );
  }

  const result = await response.json() as {
    data?: T;
    errors?: Array<{ message: string }>;
  };

  if (result.errors && result.errors.length > 0) {
    throw new Error(
      `GraphQL errors: ${result.errors.map((e) => e.message).join(", ")}`,
    );
  }

  if (!result.data) {
    throw new Error("No data returned from GraphQL");
  }

  return result.data;
}

/**
 * Check if a label exists in a repository.
 */
export async function labelExists(
  owner: string,
  repo: string,
  labelName: string,
): Promise<boolean> {
  const data = await graphqlRequest<GetLabelsResponse>(GET_LABELS_QUERY, {
    owner,
    name: repo,
    first: 100,
  });

  const labels = data.repository?.labels?.nodes || [];
  return labels.some((label) => label.name === labelName);
}

/**
 * Create a label in a repository.
 * Does nothing if the label already exists.
 */
export async function createLabel(
  owner: string,
  repo: string,
  labelName: string,
  options?: LabelOptions,
): Promise<Label | null> {
  const exists = await labelExists(owner, repo, labelName);
  if (exists) {
    console.log(`Label "${labelName}" already exists in ${owner}/${repo}`);
    return null;
  }

  const data = await graphqlRequest<CreateLabelResponse>(
    CREATE_LABEL_MUTATION,
    {
      input: {
        repositoryId: `${owner}/${repo}`,
        name: labelName,
        color: options?.color || undefined,
        description: options?.description || undefined,
      },
    },
  );

  if (!data.createLabel?.label) {
    throw new Error(`Failed to create label: ${labelName}`);
  }

  return data.createLabel.label;
}

/**
 * Create a label using the gh CLI.
 * Falls back to this if GraphQL fails.
 */
export async function createLabelWithGh(
  owner: string,
  repo: string,
  labelName: string,
  options?: LabelOptions,
): Promise<void> {
  try {
    const args = ["label", "create", labelName, "--repo", `${owner}/${repo}`];
    if (options?.color) {
      args.push("--color", options.color);
    }
    if (options?.description) {
      args.push("--description", options.description);
    }
    await $`gh ${args}`.stdout("null");
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    if (errorMessage.includes("already exists")) {
      console.log(`Label "${labelName}" already exists in ${owner}/${repo}`);
      return;
    }
    throw error;
  }
}

/**
 * Delete a label from a repository.
 */
export async function deleteLabel(
  owner: string,
  repo: string,
  labelName: string,
): Promise<void> {
  try {
    const data = await graphqlRequest<DeleteLabelResponse>(
      DELETE_LABEL_MUTATION,
      {
        input: {
          repositoryId: `${owner}/${repo}`,
          name: labelName,
        },
      },
    );

    if (!data.deleteLabel?.deletedLabelId) {
      throw new Error(`Failed to delete label: ${labelName}`);
    }
  } catch {
    await $`gh label delete ${labelName} --repo ${owner}/${repo} --yes`.stdout(
      "null",
    );
  }
}
