// Copyright 2026 Chesapeake Computing
// SPDX-License-Identifier: Apache-2.0

import type { CommitMessage } from "../archive/derive.ts";
import { completeRfc } from "../rfc/complete.ts";
import type { Rfc } from "../rfc/types.ts";
import { detectVcs } from "../github/vcs.ts";
import { commitFiles } from "./commit.ts";

/** Options for RFC complete-mode land. */
export interface RunLandRfcCompleteOptions {
  /** RFC id, slug, or path. */
  ref: string;
  /** Repository root for RFC resolution and commits. */
  workspaceRoot: string;
  /** When true, preview status/state/commit without writing. */
  dryRun: boolean;
}

function deriveRfcCompleteMessage(rfc: Rfc): CommitMessage {
  const idStr = rfc.metadata.id.toString().padStart(3, "0");
  return {
    summary: `docs: complete RFC ${idStr}: ${rfc.metadata.title}`,
  };
}

function formatRfcCompletePreview(
  result: Awaited<ReturnType<typeof completeRfc>>,
  message: CommitMessage,
  dryRun: boolean,
): string {
  const lines = [
    dryRun ? "RFC complete (dry-run)" : "RFC complete",
    `  RFC: ${result.rfc.path}`,
    `  Status: ${result.previousStatus} → done`,
    `  Commit: ${message.summary}`,
    "  Files:",
    `    - ${result.rfc.path}`,
    `    - ${result.statePath}`,
  ];
  if (dryRun) {
    lines.push("(dry-run) No files written or committed");
  }
  return lines.join("\n");
}

/**
 * Lands an RFC by marking it done and committing the RFC markdown plus
 * `.state.json`. The RFC file is never deleted.
 */
export async function runLandRfcComplete(
  options: RunLandRfcCompleteOptions,
): Promise<void> {
  const { ref, workspaceRoot, dryRun } = options;

  const ctx = await detectVcs();
  if (!ctx) {
    throw new Error(
      "Not in a git or sapling repository. Run from a repo root.",
    );
  }

  const result = await completeRfc(ref, { repoRoot: workspaceRoot, dryRun });
  const message = deriveRfcCompleteMessage(result.rfc);
  console.log(formatRfcCompletePreview(result, message, dryRun));

  if (dryRun) {
    return;
  }

  await commitFiles([result.rfc.path, result.statePath], message);
}
