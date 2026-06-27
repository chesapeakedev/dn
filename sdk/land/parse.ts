// Copyright 2026 Chesapeake Computing
// SPDX-License-Identifier: Apache-2.0

import type { LandCommitGroup, LandCommitPlan } from "./types.ts";

const CONVENTIONAL_COMMIT =
  /^(feat|fix|docs|style|refactor|perf|test|build|ci|chore|revert)(\([^)]+\))?(!)?: .+/;

/**
 * Extracts a JSON array from agent stdout (handles fenced or raw JSON).
 */
export function extractLandJson(stdout: string): unknown {
  const trimmed = stdout.trim();
  const codeBlock = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
  const raw = codeBlock ? codeBlock[1].trim() : trimmed;
  const start = raw.indexOf("[");
  const end = raw.lastIndexOf("]") + 1;
  if (start >= 0 && end > start) {
    return JSON.parse(raw.slice(start, end)) as unknown;
  }
  return JSON.parse(raw) as unknown;
}

function normalizePath(path: string): string {
  return path.replace(/^\.\/+/, "");
}

function isOptionalBody(value: unknown): boolean {
  return value === undefined || value === null || typeof value === "string";
}

function isLandCommitGroup(value: unknown): value is LandCommitGroup {
  if (typeof value !== "object" || value === null) return false;
  const obj = value as Record<string, unknown>;
  return Array.isArray(obj.files) &&
    obj.files.every((f) => typeof f === "string") &&
    typeof obj.summary === "string" &&
    isOptionalBody(obj.body);
}

function normalizeBody(body: unknown): string | undefined {
  if (body === undefined || body === null) return undefined;
  if (typeof body !== "string") return undefined;
  const trimmed = body.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

/**
 * Parses and validates a land commit plan from agent JSON output.
 *
 * @param parsed - Parsed JSON value
 * @param changedFiles - Workspace files that must be assigned exactly once
 * @throws Error when structure, conventional commits, or file coverage is invalid
 */
export function parseCommitPlan(
  parsed: unknown,
  changedFiles: string[],
): LandCommitPlan {
  if (!Array.isArray(parsed) || parsed.length === 0) {
    throw new Error("Land plan must be a non-empty JSON array of commits.");
  }

  const plan: LandCommitPlan = [];
  for (let i = 0; i < parsed.length; i++) {
    const rawItem = parsed[i];
    if (!isLandCommitGroup(rawItem)) {
      throw new Error(
        `Commit ${
          i + 1
        } must have files (string[]), summary (string), and optional body (string, null, or omitted).`,
      );
    }
    if (!CONVENTIONAL_COMMIT.test(rawItem.summary)) {
      throw new Error(
        `Commit summary must use conventional commits: ${rawItem.summary}`,
      );
    }
    plan.push({
      files: rawItem.files.map(normalizePath),
      summary: rawItem.summary.trim(),
      body: normalizeBody((rawItem as { body?: unknown }).body),
    });
  }

  const expected = new Set(changedFiles.map(normalizePath));
  const assigned = new Map<string, number>();

  for (let i = 0; i < plan.length; i++) {
    for (const file of plan[i].files) {
      const normalized = normalizePath(file);
      if (!expected.has(normalized)) {
        throw new Error(
          `Commit ${i + 1} includes file not in workspace changes: ${file}`,
        );
      }
      if (assigned.has(normalized)) {
        throw new Error(
          `File assigned to multiple commits: ${file}`,
        );
      }
      assigned.set(normalized, i);
    }
  }

  for (const file of expected) {
    if (!assigned.has(file)) {
      throw new Error(`Changed file not assigned to any commit: ${file}`);
    }
  }

  return plan;
}

/**
 * Formats a land commit plan for stdout preview.
 */
export function formatCommitPlanPreview(plan: LandCommitPlan): string {
  return plan.map((group, index) => {
    const body = group.body ? `\n\n${group.body}` : "";
    const files = group.files.map((f) => `  - ${f}`).join("\n");
    return `Commit ${index + 1}: ${group.summary}${body}\n${files}`;
  }).join("\n\n");
}
