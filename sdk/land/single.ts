// Copyright 2026 Chesapeake Computing
// SPDX-License-Identifier: Apache-2.0

import { commitWorkspace } from "../archive/commit.ts";
import { deriveCommitMessage } from "../archive/derive.ts";

/**
 * Lands workspace changes with a deterministic single commit (--single mode).
 *
 * @param planFilePath - Path to the plan file
 * @param dryRun - When true, print message only
 */
export async function runLandSingle(
  planFilePath: string,
  dryRun: boolean,
): Promise<void> {
  let planContent: string;
  try {
    planContent = await Deno.readTextFile(planFilePath);
  } catch (e) {
    throw new Error(
      `Cannot read plan file: ${planFilePath}. ${
        e instanceof Error ? e.message : String(e)
      }`,
    );
  }

  const message = deriveCommitMessage(planContent, planFilePath);
  const fullMessage = message.body
    ? `${message.summary}\n\n${message.body}`
    : message.summary;
  console.log(fullMessage);

  if (dryRun) {
    return;
  }

  let removedPlan = false;
  try {
    await Deno.remove(planFilePath);
    removedPlan = true;
    await commitWorkspace(message);
  } catch (e) {
    if (removedPlan) {
      try {
        await Deno.writeTextFile(planFilePath, planContent);
      } catch (restoreError) {
        console.error(
          `Warning: Could not restore plan file after land failure: ${planFilePath}`,
        );
        console.error(
          restoreError instanceof Error
            ? restoreError.message
            : String(restoreError),
        );
      }
    }
    throw e;
  }
}
