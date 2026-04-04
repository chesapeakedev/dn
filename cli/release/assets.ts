// Copyright 2026 Chesapeake Computing
// SPDX-License-Identifier: Apache-2.0

/**
 * Asset upload orchestration for GitHub releases.
 *
 * Handles the draft-then-publish flow required when uploading assets:
 * 1. Release is created as draft
 * 2. Assets are uploaded sequentially
 * 3. Release is published after all uploads succeed
 */

import {
  deleteRelease,
  expandAssetPaths,
  parseAssetArgs,
  stripUploadUrlTemplate,
  updateRelease,
  uploadAsset,
} from "./api.ts";
import type { GitHubRelease, ReleaseAsset } from "./types.ts";

/**
 * Parse raw asset argument strings into resolved ReleaseAsset objects.
 *
 * Handles glob expansion and label parsing (path#label format).
 */
export async function resolveAssets(
  rawArgs: string[],
): Promise<ReleaseAsset[]> {
  const parsed = parseAssetArgs(rawArgs);
  const expanded = await expandAssetPaths(parsed);

  // Validate all files exist
  for (const asset of expanded) {
    try {
      const stat = await Deno.stat(asset.path);
      if (!stat.isFile) {
        throw new Error(`Asset path is not a file: ${asset.path}`);
      }
    } catch (error) {
      if (error instanceof Deno.errors.NotFound) {
        throw new Error(`Asset file not found: ${asset.path}`);
      }
      throw error;
    }
  }

  return expanded;
}

/**
 * Upload all assets to a release, then publish it.
 *
 * If the release was created as a draft for uploading, it will be published
 * after all assets are successfully uploaded. If any upload fails, the draft
 * release is cleaned up (deleted).
 */
export async function uploadAssetsAndPublish(
  owner: string,
  repo: string,
  release: GitHubRelease,
  rawAssetArgs: string[],
  wasDraftForUpload: boolean,
): Promise<GitHubRelease> {
  const assets = await resolveAssets(rawAssetArgs);

  if (assets.length === 0) {
    return release;
  }

  const uploadUrl = stripUploadUrlTemplate(release.uploadUrl);

  for (const asset of assets) {
    const label = asset.label ? ` "${asset.label}"` : "";
    console.error(`Uploading ${asset.path}${label}...`);

    try {
      await uploadAsset(uploadUrl, asset);
    } catch (error) {
      if (wasDraftForUpload) {
        await cleanupDraftRelease(owner, repo, release.id, error as Error);
      }
      throw error;
    }
  }

  if (wasDraftForUpload) {
    console.error("Publishing release...");
    const published = await updateRelease(owner, repo, release.id, {
      draft: false,
    });
    return published;
  }

  return release;
}

/**
 * Clean up a draft release when asset upload fails.
 */
async function cleanupDraftRelease(
  owner: string,
  repo: string,
  releaseId: number,
  originalError: Error,
): Promise<void> {
  try {
    await deleteRelease(owner, repo, releaseId);
  } catch (cleanupError) {
    throw new Error(
      `${originalError.message}\nCleaning up draft release failed: ${
        cleanupError instanceof Error
          ? cleanupError.message
          : String(cleanupError)
      }`,
    );
  }
}
