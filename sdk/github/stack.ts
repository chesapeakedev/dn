// Copyright 2026 Chesapeake Computing
// SPDX-License-Identifier: Apache-2.0

import type { TodoItem } from "../todo/todo.ts";

const GITHUB_ISSUE_URL_RE =
  /^https:\/\/github\.com\/[^/\s]+\/[^/\s]+\/issues\/\d+$/;

/**
 * Filesystem paths for the generated milestone stack artifacts.
 */
export interface StackArtifactPaths {
  /** Stable artifact identifier used as the filename stem. */
  id: string;
  /** Path to the human-readable markdown stack file. */
  markdownPath: string;
  /** Path to the machine-readable JSON stack file. */
  jsonPath: string;
}

/**
 * Replaces characters that are not safe in generated artifact filenames.
 *
 * GitHub owner and repository names normally contain only alphanumerics,
 * hyphens, underscores, and dots. This keeps those unchanged while still
 * producing a deterministic filename for unexpected input.
 */
export function sanitizeStackFilenamePart(value: string): string {
  const sanitized = value.trim().replace(/[^A-Za-z0-9_.-]+/g, "_").replace(
    /^_+|_+$/g,
    "",
  );
  if (!sanitized) {
    throw new Error("Stack artifact filename part cannot be empty.");
  }
  return sanitized;
}

/**
 * Builds the repository-prefixed artifact identifier for a milestone stack.
 */
export function formatStackArtifactId(
  owner: string,
  repo: string,
  milestoneNumber: number,
): string {
  return `${sanitizeStackFilenamePart(owner)}_${
    sanitizeStackFilenamePart(repo)
  }_${milestoneNumber}`;
}

/**
 * Returns the expected markdown and JSON artifact paths for a milestone stack.
 */
export function getStackArtifactPaths(
  repoRoot: string,
  owner: string,
  repo: string,
  milestoneNumber: number,
): StackArtifactPaths {
  const id = formatStackArtifactId(owner, repo, milestoneNumber);
  return {
    id,
    markdownPath: `${repoRoot}/plans/${id}.stack.md`,
    jsonPath: `${repoRoot}/plans/${id}.stack.json`,
  };
}

/**
 * Parses generated stack markdown checklist items into todo entries.
 */
export function parseStackTodoItems(body: string): TodoItem[] {
  const items: TodoItem[] = [];
  for (const line of body.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const match = trimmed.match(
      /^-\s+\[([ xX])\]\s*(?:(\d+)\s+)?((?:#?\d+)|(?:https:\/\/github\.com\/[^/\s]+\/[^/\s]+\/issues\/\d+))\s+(.*)$/,
    );
    if (!match) continue;

    const rawRef = match[3];
    const ref = GITHUB_ISSUE_URL_RE.test(rawRef)
      ? rawRef
      : rawRef.replace(/^#?/, "#");
    items.push({
      checked: match[1].toLowerCase() === "x",
      score: match[2] ? parseInt(match[2], 10) : undefined,
      ref,
      title: match[4].trim(),
    });
  }
  return items;
}
