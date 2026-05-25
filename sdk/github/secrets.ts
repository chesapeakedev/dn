// Copyright 2026 Chesapeake Computing
// SPDX-License-Identifier: Apache-2.0

import { resolveGitHubToken } from "./token.ts";

const GITHUB_API_BASE = "https://api.github.com";

interface SecretsListResponse {
  secrets: Array<{ name: string }>;
  total_count: number;
}

/**
 * Lists configured GitHub Actions repository secret names (values are never returned).
 *
 * @param owner - Repository owner
 * @param repo - Repository name
 * @returns Secret names present in the repository
 */
export async function listRepositoryActionSecrets(
  owner: string,
  repo: string,
): Promise<Set<string>> {
  const token = await resolveGitHubToken();
  const names = new Set<string>();
  let page = 1;

  while (true) {
    const response = await fetch(
      `${GITHUB_API_BASE}/repos/${owner}/${repo}/actions/secrets?per_page=100&page=${page}`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/vnd.github+json",
          "X-GitHub-Api-Version": "2022-11-28",
        },
      },
    );

    if (!response.ok) {
      const body = await response.text();
      throw new Error(
        `Failed to list repository secrets (${response.status}): ${body}`,
      );
    }

    const data = await response.json() as SecretsListResponse;
    for (const secret of data.secrets) {
      names.add(secret.name);
    }

    if (data.secrets.length < 100) {
      break;
    }
    page++;
  }

  return names;
}
