// Copyright 2026 Chesapeake Computing
// SPDX-License-Identifier: Apache-2.0

/**
 * Runs LLM-based scoring of GitHub issues and plan refs for kickstart prioritization.
 * Output: sorted list with Fibonacci scores (1, 2, 3, 5, 8); disqualified items excluded.
 */

import type { AgentHarness } from "../sdk/github/agentHarness.ts";
import {
  getRunAgent,
  resolveAgentHarnessFromFlagsAndEnv,
} from "../sdk/github/agentHarness.ts";

const VALID_SCORES = new Set([1, 2, 3, 5, 8]);

export interface ScoredRef {
  ref: string;
  score?: number;
  disqualified?: boolean;
  reason?: string;
}

export interface MergeSuggestion {
  into_ref: string;
  merge_refs: string[];
}

export interface ScoringResult {
  scored: ScoredRef[];
  merge_suggestions?: MergeSuggestion[];
}

/**
 * Get binary directory (works in both compiled binary and development mode).
 * Same pattern as kickstart/lib.ts and orchestrator.ts.
 */
function getBinaryDir(): string {
  const url = new URL(import.meta.url);
  if (url.protocol === "file:") {
    return new URL(".", url).pathname;
  }
  return new URL(".", import.meta.url).pathname;
}

const BINARY_DIR = getBinaryDir();

/**
 * Read included system prompt (works in compiled binary and development mode).
 * Resolution order matches kickstart/lib.ts readIncludedPrompt.
 */
async function readScoreSystemPrompt(workspaceRoot: string): Promise<string> {
  const filename = "system.prompt.score.md";
  try {
    if (typeof import.meta.dirname !== "undefined") {
      try {
        return await Deno.readTextFile(
          import.meta.dirname + `/${filename}`,
        );
      } catch {
        // fall through
      }
    }
  } catch {
    // fall through
  }

  try {
    return await Deno.readTextFile(`${BINARY_DIR}/${filename}`);
  } catch {
    // fall through
  }

  try {
    return await Deno.readTextFile(`${workspaceRoot}/${filename}`);
  } catch {
    throw new Error(
      `Scoring system prompt not found: ${filename}. Run from dn repo or recompile with --include.`,
    );
  }
}

/**
 * Extracts a JSON array or object from agent stdout (handles ```json ... ``` or raw JSON).
 */
function extractJson(stdout: string): unknown {
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

/**
 * Runs the scoring prompt and parses the result.
 *
 * @param workspaceRoot - Workspace root (for agent cwd and prompt resolution)
 * @param issues - List of issues with ref, title, body
 * @param planPaths - Optional plan file paths to include as virtual issues
 * @param agentHarness - Harness for the scoring LLM; when omitted, uses env (`CURSOR_ENABLED` / `CLAUDE_ENABLED`)
 */
export async function runScoring(
  workspaceRoot: string,
  issues: { ref: string; title: string; body: string }[],
  planPaths: { ref: string; title: string }[] = [],
  agentHarness?: AgentHarness,
): Promise<ScoringResult> {
  const systemPrompt = await readScoreSystemPrompt(workspaceRoot);
  const lines: string[] = ["# Issues to score\n"];
  for (const i of issues) {
    lines.push(`## Ref: ${i.ref}`);
    lines.push(`Title: ${i.title}`);
    lines.push("");
    lines.push(i.body || "(no body)");
    lines.push("\n---\n");
  }
  for (const p of planPaths) {
    lines.push(`## Ref: ${p.ref}`);
    lines.push(`Title: ${p.title}`);
    lines.push("\n---\n");
  }
  const combined = systemPrompt + "\n\n---\n\n" + lines.join("\n");

  const tmpDir = await Deno.makeTempDir({ prefix: "dn-score-" });
  const promptPath = `${tmpDir}/score.prompt.md`;
  await Deno.writeTextFile(promptPath, combined);

  const harness = agentHarness ??
    resolveAgentHarnessFromFlagsAndEnv({
      cursorFlag: false,
      claudeFlag: false,
    });
  const run = getRunAgent(harness);
  const result = await run(
    "plan",
    promptPath,
    workspaceRoot,
    true,
  );

  await Deno.remove(tmpDir, { recursive: true }).catch(() => {});

  if (result.code !== 0) {
    throw new Error(
      `Scoring failed (exit ${result.code}): ${result.stderr || result.stdout}`,
    );
  }

  const parsed = extractJson(result.stdout);
  if (!Array.isArray(parsed)) {
    const obj = parsed as Record<string, unknown>;
    const arr = obj.scored ?? obj.results ?? parsed;
    if (!Array.isArray(arr)) {
      throw new Error("Scoring output was not a JSON array");
    }
    const scored: ScoredRef[] = [];
    for (const item of arr) {
      if (item && typeof item === "object" && "ref" in item) {
        const r = item as Record<string, unknown>;
        const ref = String(r.ref ?? "");
        if (r.disqualified) {
          scored.push({
            ref,
            disqualified: true,
            reason: String(r.reason ?? ""),
          });
        } else {
          const score = typeof r.score === "number" && VALID_SCORES.has(r.score)
            ? r.score
            : undefined;
          scored.push({ ref, score, reason: String(r.reason ?? "") });
        }
      }
    }
    const merge_suggestions = obj.merge_suggestions as
      | MergeSuggestion[]
      | undefined;
    return { scored, merge_suggestions };
  }

  const scored: ScoredRef[] = [];
  for (const item of parsed) {
    if (item && typeof item === "object" && "ref" in item) {
      const r = item as Record<string, unknown>;
      const ref = String(r.ref ?? "");
      if (r.disqualified) {
        scored.push({
          ref,
          disqualified: true,
          reason: String(r.reason ?? ""),
        });
      } else {
        const score = typeof r.score === "number" && VALID_SCORES.has(r.score)
          ? r.score
          : undefined;
        scored.push({ ref, score, reason: String(r.reason ?? "") });
      }
    }
  }
  return { scored };
}
