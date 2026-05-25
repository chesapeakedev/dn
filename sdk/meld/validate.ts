// Copyright 2026 Chesapeake Computing
// SPDX-License-Identifier: Apache-2.0

import type { MeldTargetKind } from "./target.ts";

/** Maximum markdown file size validated after agent-run (approx. 2 MiB). */
const MELO_MD_MAX_BYTES = 2 * 1024 * 1024;

/** File-backed meld targets validated with {@link checkMeldMarkdownOutput}. */
export type MeldNonPlanMarkdownKind = Extract<
  MeldTargetKind,
  "readme" | "contributing" | "agents" | "markdown"
>;

/**
 * Validate agent-produced markdown outside of plan targets.
 *
 * @param kind - Doc / generic markdown targets only (`plan` uses {@link checkPlanFile})
 * @param outputPathAbsolute - Absolute filesystem path produced by the agent
 */
export async function checkMeldMarkdownOutput(
  _kind: MeldNonPlanMarkdownKind,
  outputPathAbsolute: string,
): Promise<void> {
  let content: string;
  try {
    content = await Deno.readTextFile(outputPathAbsolute);
  } catch (e) {
    if (e instanceof Deno.errors.NotFound) {
      throw new Error(
        `Meld output file was not created at ${outputPathAbsolute}`,
      );
    }
    throw e;
  }

  if (!content.trim()) {
    throw new Error(
      `Meld output file is empty at ${outputPathAbsolute}`,
    );
  }

  const bytes = new TextEncoder().encode(content).length;
  if (bytes > MELO_MD_MAX_BYTES) {
    throw new Error(
      `Meld output exceeds ${MELO_MD_MAX_BYTES} bytes (${bytes}); split work or summarize sources.`,
    );
  }
}

/**
 * Validates a GitHub body string produced by staging (issue body / comment).
 */
export function assertNonEmptyGithubBody(
  kind: MeldTargetKind,
  body: string,
): void {
  if (kind !== "github-issue" && kind !== "github-comment") {
    return;
  }
  if (!body.trim()) {
    throw new Error(
      `${kind}: agent produced empty body`,
    );
  }
}
