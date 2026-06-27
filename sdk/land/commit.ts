// Copyright 2026 Chesapeake Computing
// SPDX-License-Identifier: Apache-2.0

import { $ } from "$dax";
import { commitStaged } from "../archive/commit.ts";
import type { CommitMessage } from "../archive/derive.ts";
import { detectVcs } from "../github/vcs.ts";
import type { LandCommitPlan } from "./types.ts";

/**
 * Stages specific paths and commits them with the given message.
 *
 * @param files - Repository-relative paths to stage
 * @param message - Commit summary and optional body
 */
export async function commitFiles(
  files: string[],
  message: CommitMessage,
): Promise<void> {
  const ctx = await detectVcs();
  if (!ctx) {
    throw new Error(
      "Not in a git or sapling repository. Run from a repo root.",
    );
  }

  if (files.length === 0) {
    throw new Error("Cannot commit with an empty file list.");
  }

  if (ctx.vcs === "sapling") {
    for (const file of files) {
      await $`sl add ${file}`;
    }
  } else {
    await $`git add -- ${files}`;
  }

  await commitStaged(message);
}

/**
 * Applies an ordered land commit plan to the workspace.
 *
 * @param plan - Validated commit groups in apply order
 */
export async function executeCommitPlan(plan: LandCommitPlan): Promise<void> {
  for (const group of plan) {
    await commitFiles(group.files, {
      summary: group.summary,
      body: group.body,
    });
  }
}
