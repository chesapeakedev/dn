// Copyright 2026 Chesapeake Computing
// SPDX-License-Identifier: Apache-2.0

/**
 * Shared types for the dn release subcommand.
 */

/**
 * Options for creating a GitHub release.
 */
export interface ReleaseCreateOptions {
  tagName: string;
  target?: string;
  title?: string;
  notes?: string;
  notesFile?: string;
  generateNotes: boolean;
  notesStartTag?: string;
  draft: boolean;
  prerelease: boolean;
  latest?: boolean;
  verifyTag: boolean;
  discussionCategory?: string;
  assets: string[];
  repoOverride?: string;
}

/**
 * Parameters for creating a git tag object via the GitHub API.
 */
export interface CreateTagObjectParams {
  tag: string;
  message: string;
  object: string;
  type: "commit";
  tagger: {
    name: string;
    email: string;
    date?: string;
  };
}

/**
 * Parameters for creating a git reference via the GitHub API.
 */
export interface CreateTagRefParams {
  tagName: string;
  sha: string;
}

/**
 * Parameters for generating release notes via the GitHub API.
 */
export interface GenerateNotesParams {
  tagName: string;
  targetCommitish?: string;
  previousTagName?: string;
  configurationFilePath?: string;
}

/**
 * Parameters for creating a release via the GitHub API.
 */
export interface CreateReleaseParams {
  tagName: string;
  targetCommitish?: string;
  name?: string;
  body?: string;
  draft: boolean;
  prerelease: boolean;
  discussionCategoryName?: string;
  generateReleaseNotes?: boolean;
  makeLatest?: "true" | "false" | "legacy";
}

/**
 * Parameters for updating a release via the GitHub API.
 */
export interface UpdateReleaseParams {
  tagName?: string;
  targetCommitish?: string;
  name?: string;
  body?: string;
  draft?: boolean;
  prerelease?: boolean;
  makeLatest?: "true" | "false" | "legacy";
  discussionCategoryName?: string;
}

/**
 * A release asset to upload.
 */
export interface ReleaseAsset {
  path: string;
  label?: string;
}

/**
 * GitHub release response from the API.
 */
export interface GitHubRelease {
  id: number;
  url: string;
  htmlUrl: string;
  tagName: string;
  targetCommitish: string;
  name: string | null;
  body: string | null;
  draft: boolean;
  prerelease: boolean;
  createdAt: string;
  publishedAt: string | null;
  uploadUrl: string;
  tarballUrl: string | null;
  zipballUrl: string | null;
}

/**
 * Generated release notes from the GitHub API.
 */
export interface GeneratedReleaseNotes {
  name: string;
  body: string;
}

/**
 * Git tag object response from the GitHub API.
 */
export interface GitTagObject {
  sha: string;
  url: string;
  tag: string;
  message: string;
  object: {
    sha: string;
    type: string;
    url: string;
  };
  tagger: {
    name: string;
    email: string;
    date: string;
  };
}

/**
 * Git reference response from the GitHub API.
 */
export interface GitRef {
  ref: string;
  url: string;
  object: {
    sha: string;
    type: string;
    url: string;
  };
}

/**
 * Repository identifier.
 */
export interface RepoIdentifier {
  owner: string;
  repo: string;
}
