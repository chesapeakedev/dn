// Copyright 2026 Chesapeake Computing
// SPDX-License-Identifier: Apache-2.0

/**
 * Mark an RFC as done: update frontmatter and `.state.json` without deleting
 * the markdown file.
 */

import { isAbsolute, join, relative } from "@std/path";
import { readRfc, readRfcIfExists, updateRfcContent } from "./parser.ts";
import {
  findRfc,
  getStatePath,
  type RfcRepoOptions,
  updateRfcInState,
} from "./state.ts";
import {
  isValidStatusTransition,
  type Rfc,
  type RfcMetadata,
  type RfcStatus,
} from "./types.ts";

/** Result of completing an RFC. */
export interface CompleteRfcResult {
  /** RFC after completion (or preview when `dryRun`). */
  rfc: Rfc;
  /** Status before completion. */
  previousStatus: RfcStatus;
  /** Repository-relative path to `rfcs/.state.json`. */
  statePath: string;
}

function resolveStoredPath(storedPath: string, repoRoot: string): string {
  if (isAbsolute(storedPath) || /^[A-Za-z]:[\\/]/.test(storedPath)) {
    return storedPath;
  }
  return join(repoRoot, storedPath);
}

/**
 * Resolves an RFC by numeric id, slug, basename, or repository-relative path.
 */
export async function resolveRfcRef(
  ref: string,
  options: RfcRepoOptions = {},
): Promise<Rfc | null> {
  const repoRoot = options.repoRoot ?? Deno.cwd();
  const fromState = await findRfc(ref, { repoRoot });
  if (fromState) {
    return fromState;
  }

  const trimmed = ref.trim();
  if (!trimmed.includes("/") && !trimmed.endsWith(".md")) {
    return null;
  }

  const absolutePath = resolveStoredPath(trimmed, repoRoot);
  const rfc = await readRfcIfExists(absolutePath);
  if (!rfc) {
    return null;
  }

  rfc.path = relative(repoRoot, absolutePath);
  return rfc;
}

/**
 * Marks an RFC as `done`, synchronizing frontmatter and `.state.json`.
 *
 * When `dryRun` is true, no files are written.
 */
export async function completeRfc(
  ref: string,
  options: RfcRepoOptions & { dryRun?: boolean } = {},
): Promise<CompleteRfcResult> {
  const repoRoot = options.repoRoot ?? Deno.cwd();
  const rfc = await resolveRfcRef(ref, { repoRoot });
  if (!rfc) {
    throw new Error(`RFC not found: ${ref}`);
  }

  const previousStatus = rfc.metadata.status;
  const nextStatus: RfcStatus = "done";
  if (!isValidStatusTransition(previousStatus, nextStatus)) {
    throw new Error(
      `Cannot transition from "${previousStatus}" to "${nextStatus}"`,
    );
  }

  const absoluteStatePath = await getStatePath({ repoRoot });
  const statePath = relative(repoRoot, absoluteStatePath);

  if (options.dryRun) {
    return {
      rfc: {
        ...rfc,
        metadata: { ...rfc.metadata, status: nextStatus },
      },
      previousStatus,
      statePath,
    };
  }

  const absolutePath = resolveStoredPath(rfc.path, repoRoot);
  const content = await Deno.readTextFile(absolutePath);
  const newMetadata: RfcMetadata = { ...rfc.metadata, status: nextStatus };
  await Deno.writeTextFile(
    absolutePath,
    updateRfcContent(content, newMetadata),
  );

  const updated = await readRfc(absolutePath);
  updated.path = rfc.path;
  await updateRfcInState(updated, { repoRoot });

  return {
    rfc: updated,
    previousStatus,
    statePath,
  };
}
