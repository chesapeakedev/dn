// Copyright 2026 Chesapeake Computing
// SPDX-License-Identifier: Apache-2.0

/**
 * GitHub REST API client for releases, tags, and assets.
 *
 * Uses the GitHub REST API exclusively, enabling tag creation without
 * requiring a local git binary — works natively with Sapling repos.
 */

import { resolveGitHubToken } from "../../sdk/github/token.ts";
import { getCurrentRepoFromRemote } from "../../sdk/github/github-gql.ts";
import type {
  CreateReleaseParams,
  CreateTagObjectParams,
  CreateTagRefParams,
  GeneratedReleaseNotes,
  GenerateNotesParams,
  GitHubRelease,
  GitRef,
  GitTagObject,
  ReleaseAsset,
  RepoIdentifier,
  UpdateReleaseParams,
} from "./types.ts";

const GITHUB_API_BASE = "https://api.github.com";

/**
 * Build standard headers for GitHub REST API requests.
 */
function buildHeaders(token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "Content-Type": "application/json",
  };
}

/**
 * Perform a JSON API request and return the parsed response.
 */
async function request<T>(
  url: string,
  options: {
    method?: string;
    headers?: Record<string, string>;
    body?: unknown;
  } = {},
): Promise<T> {
  const { method = "GET", headers = {}, body } = options;

  const init: RequestInit = {
    method,
    headers,
  };

  if (body !== undefined) {
    init.body = JSON.stringify(body);
  }

  const response = await fetch(url, init);

  if (!response.ok) {
    const errorBody = await response.text().catch(() => "");
    throw new Error(
      `GitHub API request failed (${response.status} ${response.statusText}): ${errorBody}`,
    );
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return (await response.json()) as T;
}

/**
 * Resolve the current repository from the remote URL.
 * Tries Sapling first, then falls back to git.
 */
export async function resolveRepo(
  repoOverride?: string,
): Promise<RepoIdentifier> {
  if (repoOverride) {
    const parts = repoOverride.split("/");
    if (parts.length !== 2 || !parts[0] || !parts[1]) {
      throw new Error(
        `Invalid repository format: ${repoOverride}. Use owner/repo`,
      );
    }
    return { owner: parts[0], repo: parts[1] };
  }
  return await getCurrentRepoFromRemote();
}

/**
 * Create an annotated git tag object via the GitHub API.
 *
 * This is step 1 of creating a tag without git locally.
 * Creates the tag object (annotated tag data) in GitHub's git database.
 */
export async function createTagObject(
  owner: string,
  repo: string,
  params: CreateTagObjectParams,
): Promise<GitTagObject> {
  const token = await resolveGitHubToken();
  const url = `${GITHUB_API_BASE}/repos/${owner}/${repo}/git/tags`;

  return request<GitTagObject>(url, {
    method: "POST",
    headers: buildHeaders(token),
    body: params,
  });
}

/**
 * Create a git reference (refs/tags/<name>) via the GitHub API.
 *
 * This is step 2 of creating a tag without git locally.
 * Creates the reference that makes the tag object accessible as a tag.
 */
export async function createTagRef(
  owner: string,
  repo: string,
  params: CreateTagRefParams,
): Promise<GitRef> {
  const token = await resolveGitHubToken();
  const url = `${GITHUB_API_BASE}/repos/${owner}/${repo}/git/refs`;

  return request<GitRef>(url, {
    method: "POST",
    headers: buildHeaders(token),
    body: {
      ref: `refs/tags/${params.tagName}`,
      sha: params.sha,
    },
  });
}

/**
 * Check if a tag exists on the remote repository.
 */
export async function tagExists(
  owner: string,
  repo: string,
  tagName: string,
): Promise<boolean> {
  const token = await resolveGitHubToken();
  const url =
    `${GITHUB_API_BASE}/repos/${owner}/${repo}/git/ref/tags/${tagName}`;

  try {
    await request(url, {
      method: "GET",
      headers: buildHeaders(token),
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * Generate release notes content via the GitHub API.
 */
export async function generateReleaseNotes(
  owner: string,
  repo: string,
  params: GenerateNotesParams,
): Promise<GeneratedReleaseNotes> {
  const token = await resolveGitHubToken();
  const url =
    `${GITHUB_API_BASE}/repos/${owner}/${repo}/releases/generate-notes`;

  return request<GeneratedReleaseNotes>(url, {
    method: "POST",
    headers: buildHeaders(token),
    body: {
      tag_name: params.tagName,
      ...(params.targetCommitish &&
        { target_commitish: params.targetCommitish }),
      ...(params.previousTagName &&
        { previous_tag_name: params.previousTagName }),
      ...(params.configurationFilePath &&
        { configuration_file_path: params.configurationFilePath }),
    },
  });
}

/**
 * Create a release via the GitHub API.
 */
export async function createRelease(
  owner: string,
  repo: string,
  params: CreateReleaseParams,
): Promise<GitHubRelease> {
  const token = await resolveGitHubToken();
  const url = `${GITHUB_API_BASE}/repos/${owner}/${repo}/releases`;

  return request<GitHubRelease>(url, {
    method: "POST",
    headers: buildHeaders(token),
    body: {
      tag_name: params.tagName,
      draft: params.draft,
      prerelease: params.prerelease,
      ...(params.targetCommitish &&
        { target_commitish: params.targetCommitish }),
      ...(params.name && { name: params.name }),
      ...(params.body && { body: params.body }),
      ...(params.discussionCategoryName &&
        { discussion_category_name: params.discussionCategoryName }),
      ...(params.generateReleaseNotes &&
        { generate_release_notes: params.generateReleaseNotes }),
      ...(params.makeLatest && { make_latest: params.makeLatest }),
    },
  });
}

/**
 * Update an existing release via the GitHub API.
 */
export async function updateRelease(
  owner: string,
  repo: string,
  releaseId: number,
  params: UpdateReleaseParams,
): Promise<GitHubRelease> {
  const token = await resolveGitHubToken();
  const url = `${GITHUB_API_BASE}/repos/${owner}/${repo}/releases/${releaseId}`;

  return request<GitHubRelease>(url, {
    method: "PATCH",
    headers: buildHeaders(token),
    body: params,
  });
}

/**
 * Delete a release via the GitHub API.
 */
export async function deleteRelease(
  owner: string,
  repo: string,
  releaseId: number,
): Promise<void> {
  const token = await resolveGitHubToken();
  const url = `${GITHUB_API_BASE}/repos/${owner}/${repo}/releases/${releaseId}`;

  await request<void>(url, {
    method: "DELETE",
    headers: buildHeaders(token),
  });
}

/**
 * Get a release by its ID.
 */
export async function getRelease(
  owner: string,
  repo: string,
  releaseId: number,
): Promise<GitHubRelease> {
  const token = await resolveGitHubToken();
  const url = `${GITHUB_API_BASE}/repos/${owner}/${repo}/releases/${releaseId}`;

  return request<GitHubRelease>(url, {
    method: "GET",
    headers: buildHeaders(token),
  });
}

/**
 * Get a release by tag name.
 */
export async function getReleaseByTag(
  owner: string,
  repo: string,
  tagName: string,
): Promise<GitHubRelease> {
  const token = await resolveGitHubToken();
  const url =
    `${GITHUB_API_BASE}/repos/${owner}/${repo}/releases/tags/${tagName}`;

  return request<GitHubRelease>(url, {
    method: "GET",
    headers: buildHeaders(token),
  });
}

/**
 * List releases for a repository.
 */
export async function listReleases(
  owner: string,
  repo: string,
  options: { limit?: number } = {},
): Promise<GitHubRelease[]> {
  const token = await resolveGitHubToken();
  const limit = options.limit ?? 30;
  const url =
    `${GITHUB_API_BASE}/repos/${owner}/${repo}/releases?per_page=${limit}`;

  return request<GitHubRelease[]>(url, {
    method: "GET",
    headers: buildHeaders(token),
  });
}

/**
 * Upload a single asset to a release.
 *
 * The uploadUrl should be the release's upload_url with the {?name,label}
 * template suffix removed.
 */
export async function uploadAsset(
  uploadUrl: string,
  asset: ReleaseAsset,
): Promise<void> {
  const token = await resolveGitHubToken();

  const fileName = asset.path.split("/").pop() ?? asset.path;
  const url = new URL(uploadUrl);
  url.searchParams.set("name", fileName);
  if (asset.label) {
    url.searchParams.set("label", asset.label);
  }

  const file = await Deno.readFile(asset.path);

  const response = await fetch(url.toString(), {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "Content-Type": "application/octet-stream",
      "Content-Length": String(file.length),
    },
    body: file,
  });

  if (!response.ok) {
    const errorBody = await response.text().catch(() => "");
    throw new Error(
      `Failed to upload asset ${fileName} (${response.status}): ${errorBody}`,
    );
  }
}

/**
 * Parse asset arguments into ReleaseAsset objects.
 *
 * Supports the gh release create format:
 *   ./dist/app.tar.gz              → { path: "./dist/app.tar.gz" }
 *   ./dist/app.tar.gz#My Label     → { path: "./dist/app.tar.gz", label: "My Label" }
 */
export function parseAssetArgs(args: string[]): ReleaseAsset[] {
  const assets: ReleaseAsset[] = [];

  for (const arg of args) {
    const hashIndex = arg.indexOf("#");
    if (hashIndex > 0) {
      assets.push({
        path: arg.slice(0, hashIndex),
        label: arg.slice(hashIndex + 1) || undefined,
      });
    } else {
      assets.push({ path: arg });
    }
  }

  return assets;
}

/**
 * Expand glob patterns in asset paths to actual file paths.
 */
export async function expandAssetPaths(
  assets: ReleaseAsset[],
): Promise<ReleaseAsset[]> {
  const expanded: ReleaseAsset[] = [];

  for (const asset of assets) {
    if (
      asset.path.includes("*") || asset.path.includes("?") ||
      asset.path.includes("[")
    ) {
      const globPattern = asset.path;
      const dirPart = globPattern.substring(
        0,
        globPattern.lastIndexOf("/") + 1,
      );
      const pattern = globPattern.substring(globPattern.lastIndexOf("/") + 1);

      if (dirPart) {
        try {
          for await (const entry of Deno.readDir(dirPart)) {
            const name = entry.name;
            if (matchesSimpleGlob(name, pattern)) {
              const fullPath = `${dirPart}${name}`;
              try {
                const stat = await Deno.stat(fullPath);
                if (stat.isFile) {
                  expanded.push({
                    path: fullPath,
                    label: asset.label,
                  });
                }
              } catch {
                // Skip files that can't be stat'd
              }
            }
          }
        } catch {
          // Directory doesn't exist, keep original path
          expanded.push(asset);
        }
      } else {
        expanded.push(asset);
      }
    } else {
      expanded.push(asset);
    }
  }

  return expanded;
}

/**
 * Simple glob matcher supporting * and ? wildcards.
 */
export function matchesSimpleGlob(name: string, pattern: string): boolean {
  const regex = pattern
    .replace(/\./g, "\\.")
    .replace(/\*/g, ".*")
    .replace(/\?/g, ".");
  return new RegExp(`^${regex}$`).test(name);
}

/**
 * Strip the {?name,label} template from an upload URL.
 */
export function stripUploadUrlTemplate(url: string): string {
  const idx = url.indexOf("{");
  return idx > 0 ? url.slice(0, idx) : url;
}

/**
 * Resolve the target commit SHA from the current VCS.
 * Tries Sapling first, then falls back to git.
 */
export async function resolveTargetSha(override?: string): Promise<string> {
  if (override) {
    return override;
  }

  // Try Sapling first
  try {
    const cmd = new Deno.Command("sl", {
      args: ["log", "-r", ".", "-T", "{node}"],
      stdout: "piped",
      stderr: "piped",
    });
    const output = await cmd.output();
    if (output.success) {
      const sha = new TextDecoder().decode(output.stdout).trim();
      if (sha.length > 0) {
        return sha;
      }
    }
  } catch {
    // Not a Sapling repo or sl not available
  }

  // Fall back to git
  try {
    const cmd = new Deno.Command("git", {
      args: ["rev-parse", "HEAD"],
      stdout: "piped",
      stderr: "piped",
    });
    const output = await cmd.output();
    if (output.success) {
      const sha = new TextDecoder().decode(output.stdout).trim();
      if (sha.length > 0) {
        return sha;
      }
    }
  } catch {
    // Not a git repo or git not available
  }

  throw new Error(
    "Could not determine current commit. Neither Sapling (sl) nor git available, or not in a repository.",
  );
}

/**
 * Resolve tagger info from environment or git config.
 */
export async function resolveTagger(): Promise<
  { name: string; email: string }
> {
  const name = Deno.env.get("GIT_AUTHOR_NAME") ??
    Deno.env.get("GIT_COMMITTER_NAME") ?? "";
  const email = Deno.env.get("GIT_AUTHOR_EMAIL") ??
    Deno.env.get("GIT_COMMITTER_EMAIL") ?? "";

  if (name && email) {
    return { name, email };
  }

  // Try git config as fallback
  try {
    const cmd = new Deno.Command("git", {
      args: ["config", "user.name"],
      stdout: "piped",
      stderr: "piped",
    });
    const output = await cmd.output();
    if (output.success) {
      const gitName = new TextDecoder().decode(output.stdout).trim();
      if (gitName) {
        const emailCmd = new Deno.Command("git", {
          args: ["config", "user.email"],
          stdout: "piped",
          stderr: "piped",
        });
        const emailOutput = await emailCmd.output();
        const gitEmail = emailOutput.success
          ? new TextDecoder().decode(emailOutput.stdout).trim()
          : "";
        return { name: gitName, email: gitEmail };
      }
    }
  } catch {
    // git not available
  }

  if (!name || !email) {
    throw new Error(
      "Could not determine tagger identity. Set GIT_AUTHOR_NAME and GIT_AUTHOR_EMAIL, or configure git user.name and user.email.",
    );
  }

  return { name, email };
}
