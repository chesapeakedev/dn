// Copyright 2026 Chesapeake Computing
// SPDX-License-Identifier: Apache-2.0

/**
 * User-level prioritized task list at ~/.dn/todo.md.
 * Format: YAML frontmatter plus markdown checklist lines.
 */

import {
  addIssueComment,
  closeIssue,
  getCurrentRepoFromRemote,
} from "../github/github-gql.ts";
import { parseFrontmatter, stringifyFrontmatter } from "./frontmatter.ts";

const LOCK_STALE_MS = 30_000;
const GITHUB_ISSUE_URL_RE =
  /^https?:\/\/github\.com\/([^/]+)\/([^/]+)\/issues\/(\d+)(?:\?.*)?$/i;
const ISSUE_NUMBER_RE = /^#?(\d+)$/;

/**
 * Returns the dn home directory (~/.dn on Unix).
 * Creates the directory if it does not exist.
 */
export function getDnHomeDir(): string {
  const home = Deno.env.get("HOME");
  const appData = Deno.env.get("APPDATA");
  if (appData) {
    return `${appData.replace(/\//g, "\\")}\\dn`;
  }
  if (home) {
    return `${home}/.dn`;
  }
  return ".dn";
}

/**
 * Path to the todo list file.
 */
export function getTodoPath(): string {
  return `${getDnHomeDir()}/todo.md`;
}

function getLockPath(): string {
  return `${getDnHomeDir()}/todo.md.lock`;
}

/**
 * A single todo list item (one line in the body).
 */
export interface TodoItem {
  /** Whether the item is completed. */
  checked: boolean;
  /** Optional Fibonacci complexity score (1, 2, 3, 5, 8). */
  score?: number;
  /** Ref: GitHub issue URL, issue number, or path (e.g. plans/foo.plan.md). */
  ref: string;
  /** Optional title or notes after the ref. */
  title?: string;
}

/**
 * Parsed todo list with metadata and items.
 */
export interface TodoList {
  /** Frontmatter key-value pairs. */
  meta: Record<string, string>;
  /** All items in order (checked and unchecked). */
  items: TodoItem[];
}

/**
 * Line format: `- [ ]` or `- [x]`, optional number, ref, optional title.
 * Example: `- [ ] 1 https://github.com/org/repo/issues/42  Add login flow`
 */
const TODO_LINE_RE = /^-\s+\[([ xX])\]\s*(?:(\d+)\s+)?(\S+)\s*(.*)$/;

function parseTodoLine(line: string): TodoItem | null {
  const trimmed = line.trim();
  if (!trimmed.startsWith("- [") || !trimmed.includes("]")) return null;
  const m = trimmed.match(TODO_LINE_RE);
  if (!m) return null;
  const [, check, scoreStr, ref, title] = m;
  const checked = check.toLowerCase() === "x";
  const score = scoreStr ? parseInt(scoreStr, 10) : undefined;
  return {
    checked,
    score,
    ref: ref.trim(),
    title: title.trim() || undefined,
  };
}

function formatTodoItem(item: TodoItem): string {
  const check = item.checked ? "[x]" : "[ ]";
  const scorePart = item.score != null ? ` ${item.score}` : "";
  const titlePart = item.title ? ` ${item.title}` : "";
  return `- ${check}${scorePart} ${item.ref}${titlePart}`;
}

/**
 * Ensures ~/.dn exists.
 */
async function ensureDnHome(): Promise<void> {
  const dir = getDnHomeDir();
  await Deno.mkdir(dir, { recursive: true });
}

/**
 * Acquires a simple file lock; if lock exists and is older than LOCK_STALE_MS, overwrites.
 */
async function withLock<T>(fn: () => Promise<T>): Promise<T> {
  await ensureDnHome();
  const lockPath = getLockPath();
  const stat = await Deno.stat(lockPath).catch(() => null);
  if (stat) {
    const mtime = stat.mtime?.getTime();
    const age = mtime != null ? Date.now() - mtime : 0;
    if (age < LOCK_STALE_MS) {
      throw new Error(
        `Todo list is locked (${lockPath}). If no other dn process is running, remove the lock file.`,
      );
    }
  }
  await Deno.writeTextFile(lockPath, String(Date.now()), {
    create: true,
  });
  try {
    return await fn();
  } finally {
    await Deno.remove(lockPath).catch(() => {});
  }
}

/**
 * Parses the todo file content into structured list.
 */
export function parseTodoFile(content: string): TodoList {
  const { frontmatter, body } = parseFrontmatter(content);
  const items: TodoItem[] = [];
  for (const line of body.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const item = parseTodoLine(line);
    if (item) items.push(item);
  }
  return { meta: frontmatter, items };
}

/**
 * Serializes a TodoList back to file content.
 */
export function serializeTodoList(list: TodoList): string {
  const body = list.items.map(formatTodoItem).join("\n");
  return stringifyFrontmatter(list.meta, body);
}

/**
 * Reads the todo list from disk. Returns default list if file is missing.
 */
export async function readTodoList(): Promise<TodoList> {
  const path = getTodoPath();
  try {
    const content = await Deno.readTextFile(path);
    return parseTodoFile(content);
  } catch (e) {
    if (e instanceof Deno.errors.NotFound) {
      return { meta: {}, items: [] };
    }
    throw e;
  }
}

/**
 * Writes the todo list to disk. Uses lock.
 */
export async function writeTodoList(list: TodoList): Promise<void> {
  await withLock(async () => {
    await ensureDnHome();
    const path = getTodoPath();
    await Deno.writeTextFile(path, serializeTodoList(list), { create: true });
  });
}

/**
 * Returns the first unchecked item, or null if none.
 */
export function firstUnchecked(list: TodoList): TodoItem | null {
  return list.items.find((i) => !i.checked) ?? null;
}

/**
 * Resolves a ref to owner/repo/number for GitHub issues. Returns null for paths.
 */
async function resolveGitHubRef(ref: string): Promise<
  {
    owner: string;
    repo: string;
    number: number;
  } | null
> {
  const urlMatch = ref.match(GITHUB_ISSUE_URL_RE);
  if (urlMatch) {
    return {
      owner: urlMatch[1],
      repo: urlMatch[2],
      number: parseInt(urlMatch[3], 10),
    };
  }
  const numMatch = ref.match(ISSUE_NUMBER_RE);
  if (numMatch) {
    const { owner, repo } = await getCurrentRepoFromRemote();
    return { owner, repo, number: parseInt(numMatch[1], 10) };
  }
  return null;
}

/**
 * Appends items to the list, skipping refs that already exist. Uses lock.
 */
export async function addToTodoList(
  items: Omit<TodoItem, "checked">[],
  options?: { repo?: string; updated?: string },
): Promise<void> {
  await withLock(async () => {
    const list = await readTodoList();
    const existingRefs = new Set(list.items.map((i) => i.ref));
    for (const item of items) {
      if (existingRefs.has(item.ref)) continue;
      list.items.push({ ...item, checked: false });
      existingRefs.add(item.ref);
    }
    if (options?.repo) list.meta.repo = options.repo;
    if (options?.updated) list.meta.updated = options.updated;
    await Deno.writeTextFile(getTodoPath(), serializeTodoList(list), {
      create: true,
    });
  });
}

/**
 * Finds the first unchecked item matching ref (exact ref, or same GitHub issue).
 */
function findUncheckedItem(
  list: TodoList,
  ref: string,
  gh: { owner: string; repo: string; number: number } | null,
): number {
  return list.items.findIndex((i) => {
    if (i.checked) return false;
    if (i.ref === ref) return true;
    if (gh && (i.ref === `#${gh.number}` || i.ref === String(gh.number))) {
      return true;
    }
    if (gh && i.ref.endsWith(`/issues/${gh.number}`)) return true;
    return false;
  });
}

/**
 * Marks the item matching ref as done. If ref is a GitHub issue, closes it with a comment.
 * Uses lock for the file update.
 *
 * @returns Whether a GitHub issue was closed.
 */
export async function markDone(
  ref: string,
  options?: { closeComment?: string; updated?: string },
): Promise<{ closedIssue: boolean }> {
  const list = await readTodoList();
  const gh = await resolveGitHubRef(ref);
  const matchIndex = findUncheckedItem(list, ref, gh);
  if (matchIndex < 0) {
    throw new Error(`No unchecked todo item found for ref: ${ref}`);
  }
  if (gh) {
    const comment = options?.closeComment ?? "Completed via dn todo done";
    await addIssueComment(gh.owner, gh.repo, gh.number, comment);
    await closeIssue(gh.owner, gh.repo, gh.number, "COMPLETED");
  }
  await withLock(async () => {
    const list2 = await readTodoList();
    const idx = findUncheckedItem(list2, ref, gh);
    if (idx >= 0) {
      list2.items[idx].checked = true;
    }
    if (options?.updated) list2.meta.updated = options.updated;
    await Deno.writeTextFile(getTodoPath(), serializeTodoList(list2), {
      create: true,
    });
  });
  return { closedIssue: !!gh };
}
