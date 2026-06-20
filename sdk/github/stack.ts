// Copyright 2026 Chesapeake Computing
// SPDX-License-Identifier: Apache-2.0

import { parseFrontmatter, stringifyFrontmatter } from "../todo/frontmatter.ts";
import {
  itemRefMatchesTarget,
  resolveGitHubRef,
  type TodoItem,
} from "../todo/todo.ts";

/** Normalize stack checklist refs for comparison (#123 vs issue URL). */
export function normalizeStackRef(ref: string): string {
  const trimmed = ref.trim();
  if (GITHUB_ISSUE_URL_RE.test(trimmed)) {
    const match = trimmed.match(/\/issues\/(\d+)$/);
    return match ? `#${match[1]}` : trimmed;
  }
  return trimmed.replace(/^#?/, "#");
}

/**
 * Merges checked state from an existing stack markdown file into newly generated content.
 */
export function mergeStackCheckmarks(
  newContent: string,
  existingMarkdown: string,
): string {
  const { body: existingBody } = parseFrontmatter(existingMarkdown);
  const existingItems = parseStackTodoItems(existingBody);
  const checkedRefs = new Set(
    existingItems
      .filter((item) => item.checked)
      .map((item) => normalizeStackRef(item.ref)),
  );

  if (checkedRefs.size === 0) {
    return newContent;
  }

  const { frontmatter, body } = parseFrontmatter(newContent);
  const lines = body.split(/\r?\n/).map((line) => {
    const trimmed = line.trim();
    const match = trimmed.match(STACK_TODO_LINE_RE);
    if (!match || match[1].toLowerCase() === "x") {
      return line;
    }
    const rawRef = match[3];
    const normalized = GITHUB_ISSUE_URL_RE.test(rawRef)
      ? normalizeStackRef(rawRef)
      : normalizeStackRef(rawRef);
    if (!checkedRefs.has(normalized)) {
      return line;
    }
    const lead = line.match(/^\s*/)?.[0] ?? "";
    const updated = trimmed.replace(/^-\s+\[ \]/, "- [x]");
    return lead + updated;
  });

  return stringifyFrontmatter(frontmatter, lines.join("\n"));
}

const GITHUB_ISSUE_URL_RE =
  /^https:\/\/github\.com\/[^/\s]+\/[^/\s]+\/issues\/\d+$/;

/**
 * Checklist line pattern for milestone stack markdown (same as {@link parseStackTodoItems}).
 */
export const STACK_TODO_LINE_RE =
  /^-\s+\[([ xX])\]\s*(?:(\d+)\s+)?((?:#?\d+)|(?:https:\/\/github\.com\/[^/\s]+\/[^/\s]+\/issues\/\d+))\s+(.*)$/;

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
    const match = trimmed.match(STACK_TODO_LINE_RE);
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

/**
 * Marks the first unchecked stack line matching `targetRef` as done (`[x]`).
 * Matches the same ref rules as ~/.dn/todo.md (issue URL, `#n`, or `n`).
 *
 * @throws Error if no matching unchecked line exists in the file.
 */
export async function markMilestoneStackItemDone(
  stackMarkdownPath: string,
  targetRef: string,
): Promise<void> {
  const raw = await Deno.readTextFile(stackMarkdownPath);
  const { frontmatter, body } = parseFrontmatter(raw);
  const lines = body.split(/\r?\n/);
  let targetGh: Awaited<ReturnType<typeof resolveGitHubRef>> | null = null;
  let targetGhResolved = false;

  async function getTargetGh(): Promise<
    Awaited<ReturnType<typeof resolveGitHubRef>>
  > {
    if (targetGhResolved) return targetGh;
    targetGhResolved = true;
    try {
      targetGh = await resolveGitHubRef(targetRef);
    } catch {
      targetGh = null;
    }
    return targetGh;
  }

  let changed = false;
  const newLines: string[] = [];
  for (const line of lines) {
    const trimmed = line.trim();
    const m = trimmed.match(STACK_TODO_LINE_RE);
    if (!m) {
      newLines.push(line);
      continue;
    }
    if (m[1].toLowerCase() === "x") {
      newLines.push(line);
      continue;
    }
    const rawRef = m[3];
    const itemRef = GITHUB_ISSUE_URL_RE.test(rawRef)
      ? rawRef
      : rawRef.replace(/^#?/, "#");
    const matches = itemRef === targetRef ||
      itemRefMatchesTarget(itemRef, targetRef, await getTargetGh());
    if (!matches) {
      newLines.push(line);
      continue;
    }
    changed = true;
    const newTrimmed = trimmed.replace(/^-\s+\[ \]/, "- [x]");
    const lead = line.match(/^\s*/)?.[0] ?? "";
    newLines.push(lead + newTrimmed);
  }
  if (!changed) {
    throw new Error(
      `No unchecked stack item found for ref: ${targetRef}`,
    );
  }
  await Deno.writeTextFile(
    stackMarkdownPath,
    stringifyFrontmatter(frontmatter, newLines.join("\n")),
  );
}
