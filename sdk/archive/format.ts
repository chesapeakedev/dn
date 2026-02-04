// Copyright 2026 Chesapeake Computing
// SPDX-License-Identifier: Apache-2.0

import type { CommitMessage } from "./derive.ts";

/** Target length for commit subject line (fits git log --oneline). */
export const SUBJECT_MAX_LENGTH = 50;

/** Line length for commit message body (email/patch convention). */
export const BODY_LINE_LENGTH = 72;

/**
 * Truncates the subject line to at most SUBJECT_MAX_LENGTH characters.
 * Appends "…" when truncated so the subject fits conventional limits.
 */
export function formatSummary(summary: string): string {
  if (summary.length <= SUBJECT_MAX_LENGTH) return summary;
  return summary.slice(0, SUBJECT_MAX_LENGTH - 1) + "…";
}

/**
 * Wraps body text at word boundaries to BODY_LINE_LENGTH characters per line.
 * Preserves existing newlines as paragraph breaks, then wraps each paragraph.
 */
export function wrapBody(body: string): string {
  const lines: string[] = [];
  const paragraphs = body.split(/\n\n+/).map((p) =>
    p.replace(/\n/g, " ").trim()
  );

  for (const para of paragraphs) {
    if (!para) continue;
    const words = para.split(/\s+/);
    let current = "";

    for (const word of words) {
      const candidate = current ? `${current} ${word}` : word;
      if (candidate.length <= BODY_LINE_LENGTH) {
        current = candidate;
      } else {
        if (current) lines.push(current);
        current = word.length > BODY_LINE_LENGTH
          ? word.slice(0, BODY_LINE_LENGTH)
          : word;
      }
    }
    if (current) lines.push(current);
  }

  return lines.join("\n");
}

/**
 * Formats a commit message so the subject fits SUBJECT_MAX_LENGTH and the
 * body is wrapped at BODY_LINE_LENGTH characters per line.
 */
export function formatCommitMessage(message: CommitMessage): CommitMessage {
  return {
    summary: formatSummary(message.summary),
    body: message.body ? wrapBody(message.body) : undefined,
  };
}
