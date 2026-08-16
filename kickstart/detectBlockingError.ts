// Copyright 2026 Chesapeake Computing
// SPDX-License-Identifier: Apache-2.0

/**
 * Heuristic and structured detection of hard implement-phase blockers.
 *
 * Agent CLIs (especially Codex) often echo the full system prompt into stderr,
 * including instructional "Cannot proceed..." examples. Prefer structured
 * `.dn/implement-result.json` when present, and never treat prompt dumps as
 * real blockers.
 */

import type { ImplementPhaseResult } from "./implementResult.ts";

/** Patterns that indicate an agent-reported hard blocker in free-form output. */
const BLOCKING_PATTERNS: RegExp[] = [
  /error:\s*cannot proceed/i,
  /error:\s*implementation blocked/i,
  /cannot proceed with implementation/i,
  /implementation blocked:/i,
  /codebase not present/i,
  /required.*not present/i,
  /missing.*codebase/i,
  /workspace.*not found/i,
  /critical.*missing/i,
];

/**
 * Markers that appear in kickstart system prompts. When stderr contains these,
 * it is almost certainly a prompt/session dump rather than agent-authored
 * blocker text.
 */
const PROMPT_DUMP_MARKERS: string[] = [
  "You are running in **headless, non-interactive mode**",
  "CRITICAL: Implement Result JSON",
  "CRITICAL: Update Acceptance Criteria Checklist",
  "Example of what NOT to do",
  "Example of what TO do",
  "### Blocking Errors (Cannot Proceed)",
];

/**
 * True when text looks like an echoed system prompt / session transcript.
 */
export function looksLikePromptDump(text: string): boolean {
  if (!text.trim()) return false;
  return PROMPT_DUMP_MARKERS.some((marker) => text.includes(marker));
}

/**
 * Scans a single stream for blocking-error phrases and returns nearby context.
 */
function scanStreamForBlockingError(text: string): string | null {
  if (!text.trim()) return null;

  for (const pattern of BLOCKING_PATTERNS) {
    if (!pattern.test(text)) continue;

    const lines = text.split("\n");
    const errorLineIndex = lines.findIndex((line) => pattern.test(line));
    if (errorLineIndex >= 0) {
      const start = Math.max(0, errorLineIndex - 1);
      const end = Math.min(lines.length, errorLineIndex + 3);
      return lines.slice(start, end).join("\n").trim();
    }

    const match = text.match(pattern);
    return match?.[0] ?? null;
  }

  return null;
}

/**
 * Detects a blocking error in implement-phase streams when no structured
 * result is available.
 *
 * Prefers stdout. Stderr is ignored when it looks like a prompt dump (common
 * with Codex), otherwise it is scanned as a fallback.
 *
 * @param stdout - Standard output from the implement phase
 * @param stderr - Standard error from the implement phase
 * @returns Nearby error context if a blocker phrase is found, otherwise null
 */
export function detectBlockingError(
  stdout: string,
  stderr: string,
): string | null {
  const fromStdout = scanStreamForBlockingError(stdout);
  if (fromStdout) return fromStdout;

  if (looksLikePromptDump(stderr)) return null;
  return scanStreamForBlockingError(stderr);
}

/**
 * Resolves whether the implement phase hit a hard blocker.
 *
 * When a structured implement result exists, only `status` /
 * `recommendation` of `blocked` counts — never regex-scan logs (prompt
 * examples would false-positive). Heuristic scanning is a fallback only when
 * no structured result was written.
 *
 * @param structured - Parsed `.dn/implement-result.json`, or null if missing
 * @param stdout - Implement phase stdout
 * @param stderr - Implement phase stderr
 * @returns Blocker summary/context, or null if implementation may continue
 */
export function resolveImplementBlockingError(
  structured:
    | Pick<
      ImplementPhaseResult,
      "status" | "recommendation" | "summary"
    >
    | null,
  stdout: string,
  stderr: string,
): string | null {
  if (structured) {
    if (
      structured.status === "blocked" ||
      structured.recommendation === "blocked"
    ) {
      return structured.summary;
    }
    return null;
  }
  return detectBlockingError(stdout, stderr);
}
