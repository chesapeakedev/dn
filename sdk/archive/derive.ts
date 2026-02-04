// Copyright 2026 Chesapeake Computing
// SPDX-License-Identifier: Apache-2.0

import { formatCommitMessage } from "./format.ts";

export interface CommitMessage {
  summary: string;
  body?: string;
}

const FRONTMATTER_NAME = /^name:\s*(.+)$/m;
const FIRST_H1 = /^#\s+(.+)$/m;
const FILENAME_PR_PREFIX = /^(\d+)-.+\.[Pp]lan\.md$/;

/**
 * Derives a commit message from plan content and file path.
 * - If filename matches `<number>-<rest>.plan.md`, summary is `<number>: <title>`.
 * - Title comes from first H1 in body, or frontmatter `name`, or "Plan".
 * - Optional body: truncated overview or first paragraph (e.g. 200 chars).
 */
export function deriveCommitMessage(
  planContent: string,
  planFilePath: string,
): CommitMessage {
  const basename = planFilePath.replace(/.*\//, "");
  const prMatch = basename.match(FILENAME_PR_PREFIX);
  const prNumber = prMatch ? prMatch[1] : null;

  const bodyWithoutFront = planContent.replace(/^---[\s\S]*?---\s*/i, "")
    .trim();
  let title = "";
  const h1Match = bodyWithoutFront.match(FIRST_H1);
  if (h1Match) {
    title = h1Match[1].trim();
  }
  if (!title) {
    const nameMatch = planContent.match(FRONTMATTER_NAME);
    if (nameMatch) title = nameMatch[1].trim();
  }
  if (!title) title = "Plan";

  const summary = prNumber ? `#${prNumber}: ${title}` : title;

  const overviewMatch = planContent.match(/^overview:\s*["']([^"']*)["']/m);
  const overviewSection = bodyWithoutFront.match(
    /^##\s+Overview\s*([\s\S]*?)(?=^##\s+|\z)/im,
  );
  const snippet = overviewMatch
    ? overviewMatch[1].slice(0, 200).replace(/\n/g, " ")
    : overviewSection
    ? overviewSection[1].trim().slice(0, 200).replace(/\n/g, " ")
    : bodyWithoutFront.slice(0, 200).replace(/\n/g, " ").trim();
  const body = snippet ? snippet : undefined;

  return formatCommitMessage({ summary, body });
}
