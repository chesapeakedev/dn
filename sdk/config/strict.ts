// Copyright 2026 Chesapeake Computing
// SPDX-License-Identifier: Apache-2.0

/**
 * Strict-mode guardrails from project `dn.json`.
 */

import { relative } from "@std/path";
import { getRfcDir, listRfcsFromState } from "../rfc/state.ts";
import { resolveDnConfig } from "./resolve.ts";
import type { DnStrictConfig } from "./types.ts";

/** Outcome of checking the RFC corpus when strict mode requires one. */
export interface StrictRfcCheckResult {
  /** Whether kickstart/meld may proceed. */
  ok: boolean;
  /** Human-readable failure reason when {@link ok} is false. */
  error?: string;
}

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
 * Returns whether `strict.enabled` and `strict.require_rfcs` both opt in.
 *
 * Other strict flags (for example `linear_history`) are documented separately
 * and do not gate kickstart/meld in this release.
 */
export function isStrictRfcRequired(
  strict: DnStrictConfig | undefined,
): boolean {
  return strict?.enabled === true && strict?.require_rfcs === true;
}

/**
 * Validates the RFC corpus when strict mode requires one.
 *
 * Policy (when {@link isStrictRfcRequired} is true):
 * - Fail if the configured RFC directory is missing.
 * - Fail if no RFC has a status other than `draft` (review, accepted,
 *   implementing, done, or superseded).
 *
 * When strict mode is off or `require_rfcs` is unset/false, returns `{ ok: true }`
 * without touching the filesystem.
 */
export async function checkStrictRfcCorpus(
  repoRoot: string,
): Promise<StrictRfcCheckResult> {
  const resolved = await resolveDnConfig({
    repoRoot,
    includeUser: false,
    env: {},
  });
  if (!isStrictRfcRequired(resolved.strict)) {
    return { ok: true };
  }

  const rfcDir = await getRfcDir({ repoRoot });
  if (!await pathExists(rfcDir)) {
    const displayPath = relative(repoRoot, rfcDir) || rfcDir;
    return {
      ok: false,
      error:
        `Strict mode (require_rfcs): RFC directory not found at ${displayPath}. ` +
        "Run `dn rfc init`, create at least one RFC with `dn rfc create`, and " +
        "promote it beyond draft with `dn rfc status <id> review` (or accepted).",
    };
  }

  const rfcs = await listRfcsFromState({ repoRoot });
  const nonDraftCount = rfcs.filter((rfc) => rfc.metadata.status !== "draft")
    .length;
  if (nonDraftCount === 0) {
    if (rfcs.length === 0) {
      return {
        ok: false,
        error:
          "Strict mode (require_rfcs): RFC directory exists but the corpus is empty. " +
          "Create an RFC with `dn rfc create` and promote it beyond draft before " +
          "running `dn kickstart` or `dn meld`.",
      };
    }
    return {
      ok: false,
      error:
        `Strict mode (require_rfcs): all ${rfcs.length} RFC(s) are still draft. ` +
        "Promote at least one with `dn rfc status <id> review` (or accepted) " +
        "before running `dn kickstart` or `dn meld`.",
    };
  }

  return { ok: true };
}

/**
 * Throws when {@link checkStrictRfcCorpus} fails; no-op when strict RFC checks
 * are disabled.
 */
export async function enforceStrictRfcCorpus(repoRoot: string): Promise<void> {
  const result = await checkStrictRfcCorpus(repoRoot);
  if (!result.ok) {
    throw new Error(result.error);
  }
}
