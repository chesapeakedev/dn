// Copyright 2026 Chesapeake Computing
// SPDX-License-Identifier: Apache-2.0

/**
 * Parse and serialize ~/.dn/todo.md (checklist queue + native task JSON blocks).
 */

import {
  type DenoiseTaskDocument,
  validateDenoiseTaskDocument,
} from "../runner/types.ts";
import { parseFrontmatter, stringifyFrontmatter } from "./frontmatter.ts";

/** Prefix for native Void task refs on checklist lines. */
export const NATIVE_TASK_REF_PREFIX = "task:";

/** A single checklist line in the task list. */
export interface TaskListItem {
  checked: boolean;
  score?: number;
  ref: string;
  title?: string;
}

/** @deprecated Use {@link TaskListItem}. */
export type TodoItem = TaskListItem;

/** Parsed kickstart queue section (checklist lines only). */
export interface TaskList {
  meta: Record<string, string>;
  items: TaskListItem[];
}

/** @deprecated Use {@link TaskList}. */
export type TodoList = TaskList;

/** Full on-disk representation including native task payloads. */
export interface TaskListFile {
  meta: Record<string, string>;
  items: TaskListItem[];
  nativeTasks: Record<string, DenoiseTaskDocument>;
}

const CHECKLIST_LINE_RE = /^-\s+\[([ xX])\]\s*(?:(\d+)\s+)?(\S+)\s*(.*)$/;

const NATIVE_BLOCK_RE =
  /<!--\s*dn-task:([^>\s]+)\s*-->\s*\r?\n```json\s*\r?\n([\s\S]*?)\r?\n```/g;

/** Returns task id from a `task:<id>` checklist ref, or null. */
export function nativeTaskIdFromRef(ref: string): string | null {
  if (!ref.startsWith(NATIVE_TASK_REF_PREFIX)) return null;
  const id = ref.slice(NATIVE_TASK_REF_PREFIX.length).trim();
  return id.length > 0 ? id : null;
}

export function nativeTaskRef(taskId: string): string {
  return `${NATIVE_TASK_REF_PREFIX}${taskId}`;
}

function parseChecklistLine(line: string): TaskListItem | null {
  const trimmed = line.trim();
  if (!trimmed.startsWith("- [") || !trimmed.includes("]")) return null;
  const m = trimmed.match(CHECKLIST_LINE_RE);
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

function formatChecklistItem(item: TaskListItem): string {
  const check = item.checked ? "[x]" : "[ ]";
  const scorePart = item.score != null ? ` ${item.score}` : "";
  const titlePart = item.title ? ` ${item.title}` : "";
  return `- ${check}${scorePart} ${item.ref}${titlePart}`;
}

function extractNativeBlocks(body: string): {
  checklistBody: string;
  nativeTasks: Record<string, DenoiseTaskDocument>;
} {
  const nativeTasks: Record<string, DenoiseTaskDocument> = {};
  let checklistBody = body;
  for (
    const match of body.matchAll(new RegExp(NATIVE_BLOCK_RE.source, "g"))
  ) {
    const id = match[1].trim();
    const jsonText = match[2];
    try {
      const doc = validateDenoiseTaskDocument(JSON.parse(jsonText));
      if (doc.id !== id) continue;
      nativeTasks[id] = doc;
    } catch {
      // Skip corrupt blocks.
    }
    checklistBody = checklistBody.replace(match[0], "");
  }
  return { checklistBody, nativeTasks };
}

function formatNativeBlock(doc: DenoiseTaskDocument): string {
  return `<!-- dn-task:${doc.id} -->\n\`\`\`json\n${
    JSON.stringify(doc, null, 2)
  }\n\`\`\``;
}

/**
 * Parses full task list file content.
 */
export function parseTaskListFile(content: string): TaskListFile {
  const { frontmatter, body } = parseFrontmatter(content);
  const { checklistBody, nativeTasks } = extractNativeBlocks(body);
  const items: TaskListItem[] = [];
  for (const line of checklistBody.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const item = parseChecklistLine(line);
    if (item) items.push(item);
  }
  return { meta: frontmatter, items, nativeTasks };
}

/** @deprecated Use {@link parseTaskListFile}. */
export function parseTodoFile(content: string): TaskList {
  const file = parseTaskListFile(content);
  return { meta: file.meta, items: file.items };
}

/**
 * Serializes a full task list file (checklist + native blocks).
 */
export function serializeTaskListFile(file: TaskListFile): string {
  const checklist = file.items.map(formatChecklistItem).join("\n");
  const nativeIds = new Set(
    file.items
      .map((i) => nativeTaskIdFromRef(i.ref))
      .filter((id): id is string => id != null),
  );
  for (const id of Object.keys(file.nativeTasks)) {
    nativeIds.add(id);
  }
  const blocks: string[] = [];
  for (const id of nativeIds) {
    const doc = file.nativeTasks[id];
    if (doc) blocks.push(formatNativeBlock(doc));
  }
  const bodyParts = [checklist, ...blocks].filter((p) => p.length > 0);
  const body = bodyParts.join("\n\n");
  return stringifyFrontmatter(file.meta, body);
}

/** @deprecated Use {@link serializeTaskListFile}. */
export function serializeTodoList(list: TaskList): string {
  return serializeTaskListFile({
    meta: list.meta,
    items: list.items,
    nativeTasks: {},
  });
}

/** Maps checklist checked state and document status. */
export function syncNativeStatusWithChecklist(
  doc: DenoiseTaskDocument,
  checked: boolean,
): DenoiseTaskDocument {
  if (checked) {
    if (doc.status === "done" || doc.status === "cancelled") return doc;
    return { ...doc, status: "done" };
  }
  if (doc.status === "open" || doc.status === "in_progress") return doc;
  return { ...doc, status: "open" };
}

export function checklistCheckedForNativeStatus(
  doc: DenoiseTaskDocument,
): boolean {
  return doc.status === "done" || doc.status === "cancelled";
}
