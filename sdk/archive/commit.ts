// Copyright 2026 Chesapeake Computing
// SPDX-License-Identifier: Apache-2.0

import { $ } from "$dax";
import { detectVcs } from "../github/vcs.ts";
import type { CommitMessage } from "./derive.ts";

/**
 * Commits currently staged files with the given message.
 * Does not stage any files; user must stage before calling.
 * Uses Sapling (sl) or git depending on repo.
 *
 * @param message - Commit summary and optional body
 * @throws Error if not in a VCS repo or commit fails
 */
export async function commitStaged(message: CommitMessage): Promise<void> {
  const ctx = await detectVcs();
  if (!ctx) {
    throw new Error(
      "Not in a git or sapling repository. Run from a repo root.",
    );
  }

  if (ctx.vcs === "sapling") {
    const fullMessage = message.body
      ? `${message.summary}\n\n${message.body}`
      : message.summary;
    await $`sl commit -m ${fullMessage}`;
  } else {
    if (message.body) {
      await $`git commit -m ${message.summary} -m ${message.body}`;
    } else {
      await $`git commit -m ${message.summary}`;
    }
  }
}
