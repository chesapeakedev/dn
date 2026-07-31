// Copyright 2026 Chesapeake Computing
// SPDX-License-Identifier: Apache-2.0

import { $ } from "$dax";
import type { CommitMessage } from "../archive/derive.ts";
import { detectVcs } from "../github/vcs.ts";
import type { LandCommitPlan } from "./types.ts";

/**
 * Stages specific paths and commits them with the given message.
 *
 * Sapling has no staging area: `sl commit` without paths would include every
 * pending change. This always passes an explicit file list so multi-commit
 * land plans only include the intended paths.
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

  const fullMessage = message.body
    ? `${message.summary}\n\n${message.body}`
    : message.summary;

  if (ctx.vcs === "sapling") {
    // -A adds/removes the named paths; path args limit the commit contents.
    await $`sl commit -A -m ${fullMessage} -- ${files}`;
  } else {
    await $`git add -- ${files}`;
    if (message.body) {
      await $`git commit -m ${message.summary} -m ${message.body}`;
    } else {
      await $`git commit -m ${message.summary}`;
    }
  }
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
