// Copyright 2026 Chesapeake Computing
// SPDX-License-Identifier: Apache-2.0

/**
 * RFC corpus state (`.state.json`) and directory resolution.
 */

import { basename, join } from "@std/path";
import { resolveDnConfig } from "../config/resolve.ts";
import {
  parseRfcIdFromFilename,
  parseRfcSlugFromFilename,
  type Rfc,
  type RfcState,
} from "./types.ts";

/** Project-level RFC directory settings. */
export interface RfcConfig {
  /** RFC directory relative to the repository root. Defaults to `rfcs`. */
  dir: string;
}

/** Options that scope RFC filesystem operations to a repository root. */
export interface RfcRepoOptions {
  /** Repository root. Defaults to the process cwd. */
  repoRoot?: string;
}

const DEFAULT_DIR = "rfcs";
const STATE_FILENAME = ".state.json";

async function pathExists(path: string): Promise<boolean> {
  try {
    await Deno.stat(path);
    return true;
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) return false;
    throw error;
  }
}

/**
 * Reads `rfc.dir` from project config (`dn.json` / Actions bridge).
 *
 * Does not read user `~/.dn/` — RFC corpus location is team policy.
 */
export async function readConfig(
  options: RfcRepoOptions = {},
): Promise<RfcConfig> {
  const repoRoot = options.repoRoot ?? Deno.cwd();
  const resolved = await resolveDnConfig({
    repoRoot,
    includeUser: false,
    env: {},
  });
  const dir = resolved.rfc?.dir?.trim() || DEFAULT_DIR;
  return { dir: dir.replace(/\/+$/, "") || DEFAULT_DIR };
}

/**
 * Returns the RFC directory path (absolute when `repoRoot` is absolute).
 */
export async function getRfcDir(
  options: RfcRepoOptions = {},
): Promise<string> {
  const repoRoot = options.repoRoot ?? Deno.cwd();
  const config = await readConfig(options);
  return join(repoRoot, config.dir);
}

/**
 * Returns the absolute/relative path to `.state.json`.
 */
export async function getStatePath(
  options: RfcRepoOptions = {},
): Promise<string> {
  return join(await getRfcDir(options), STATE_FILENAME);
}

function emptyState(): RfcState {
  return { nextId: 1, rfcs: {} };
}

/**
 * Loads RFC state from `.state.json`, or an empty state when missing.
 */
export async function loadState(
  options: RfcRepoOptions = {},
): Promise<RfcState> {
  const statePath = await getStatePath(options);
  if (!await pathExists(statePath)) {
    return emptyState();
  }
  try {
    const parsed = JSON.parse(await Deno.readTextFile(statePath)) as Partial<
      RfcState
    >;
    if (typeof parsed.nextId !== "number" || parsed.nextId < 1) {
      throw new Error(`Invalid nextId in state: ${String(parsed.nextId)}`);
    }
    if (!parsed.rfcs || typeof parsed.rfcs !== "object") {
      throw new Error("Invalid rfcs in state");
    }
    return { nextId: parsed.nextId, rfcs: parsed.rfcs };
  } catch (error) {
    throw new Error(
      `Failed to load RFC state at ${statePath}: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
}

/**
 * Writes RFC state to `.state.json`, creating the directory when needed.
 */
export async function saveState(
  state: RfcState,
  options: RfcRepoOptions = {},
): Promise<void> {
  const dir = await getRfcDir(options);
  const statePath = await getStatePath(options);
  await Deno.mkdir(dir, { recursive: true });
  await Deno.writeTextFile(statePath, `${JSON.stringify(state, null, 2)}\n`);
}

/**
 * Upserts an RFC entry in state and advances `nextId` when needed.
 */
export async function updateRfcInState(
  rfc: Rfc,
  options: RfcRepoOptions = {},
): Promise<RfcState> {
  const state = await loadState(options);
  state.rfcs[String(rfc.metadata.id)] = {
    path: rfc.path,
    metadata: rfc.metadata,
    contentHash: rfc.contentHash,
  };
  if (rfc.metadata.id >= state.nextId) {
    state.nextId = rfc.metadata.id + 1;
  }
  await saveState(state, options);
  return state;
}

/**
 * Removes an RFC id from state (does not delete the markdown file).
 */
export async function removeRfcFromState(
  id: number,
  options: RfcRepoOptions = {},
): Promise<RfcState> {
  const state = await loadState(options);
  delete state.rfcs[String(id)];
  await saveState(state, options);
  return state;
}

/**
 * Lists RFCs recorded in state, sorted by id.
 */
export async function listRfcsFromState(
  options: RfcRepoOptions = {},
): Promise<Rfc[]> {
  const state = await loadState(options);
  return Object.values(state.rfcs)
    .map((entry) => ({
      metadata: entry.metadata,
      path: entry.path,
      contentHash: entry.contentHash,
    }))
    .sort((a, b) => a.metadata.id - b.metadata.id);
}

/**
 * Finds an RFC by numeric id, filename slug, basename, or path.
 */
export async function findRfc(
  ref: string,
  options: RfcRepoOptions = {},
): Promise<Rfc | null> {
  const state = await loadState(options);
  const trimmed = ref.trim();

  if (/^\d+$/.test(trimmed)) {
    const entry = state.rfcs[trimmed] ??
      state.rfcs[String(Number.parseInt(trimmed, 10))];
    if (!entry) return null;
    return {
      metadata: entry.metadata,
      path: entry.path,
      contentHash: entry.contentHash,
    };
  }

  for (const entry of Object.values(state.rfcs)) {
    const filename = basename(entry.path);
    if (
      entry.path === trimmed ||
      filename === trimmed ||
      parseRfcSlugFromFilename(filename) === trimmed.toLowerCase()
    ) {
      return {
        metadata: entry.metadata,
        path: entry.path,
        contentHash: entry.contentHash,
      };
    }
    // Allow refs like `001` without requiring exact state key formatting.
    if (parseRfcIdFromFilename(filename) === Number.parseInt(trimmed, 10)) {
      return {
        metadata: entry.metadata,
        path: entry.path,
        contentHash: entry.contentHash,
      };
    }
  }

  return null;
}
