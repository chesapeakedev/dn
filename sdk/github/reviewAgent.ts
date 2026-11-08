// Copyright 2026 Chesapeake Computing
// SPDX-License-Identifier: Apache-2.0

import { readIncludedSystemPrompt } from "../../kickstart/includedPrompt.ts";
import type { AgentSelection } from "./agentHarness.ts";
import {
  getRunAgent,
  resolveAgentHarnessFromFlagsAndEnv,
  toAgentRunOptions,
} from "./agentHarness.ts";
import type { PullRequestReviewData } from "./github-gql.ts";
import { scrubSecrets } from "./secretScrub.ts";

export interface ReviewAgentConclusions {
  change: string;
  mergeOutlook: string;
  limitations: string[];
}

function extractJsonObject(stdout: string): unknown {
  const trimmed = stdout.trim();
  const codeBlock = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
  const raw = codeBlock ? codeBlock[1].trim() : trimmed;
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}") + 1;
  if (start < 0 || end <= start) {
    throw new Error("Agent output did not contain a JSON object");
  }
  return JSON.parse(raw.slice(start, end)) as unknown;
}

function parseAgentConclusions(value: unknown): ReviewAgentConclusions {
  if (typeof value !== "object" || value === null) {
    throw new Error("Agent output was not an object");
  }
  const record = value as Record<string, unknown>;
  const change = typeof record.change === "string" ? record.change.trim() : "";
  const mergeOutlook = typeof record.mergeOutlook === "string"
    ? record.mergeOutlook.trim()
    : "";
  if (!change || !mergeOutlook) {
    throw new Error("Agent output missing change or mergeOutlook");
  }
  const limitations = Array.isArray(record.limitations)
    ? record.limitations.filter((item): item is string =>
      typeof item === "string" && item.trim() !== ""
    )
    : [];
  return { change, mergeOutlook, limitations };
}

/** Builds markdown context for the review agent from fetched GitHub evidence. */
export function formatReviewEvidenceForAgent(
  data: PullRequestReviewData,
): string {
  const scrubBody = scrubSecrets(data.body ?? "");
  const lines: string[] = [
    "# Pull request evidence",
    "",
    `URL: ${data.url}`,
    `Repository: ${data.owner}/${data.repo}`,
    `Number: #${data.number}`,
    `Title: ${data.title}`,
    `State: ${data.state}`,
    `Draft: ${data.isDraft}`,
    `Mergeable: ${data.mergeable}`,
    `Merge state: ${data.mergeStateStatus ?? "(unknown)"}`,
    `Review decision: ${data.reviewDecision ?? "(unknown)"}`,
    `Base: ${data.baseRefName ?? "?"} (${data.baseRefOid ?? "?"})`,
    `Head: ${data.headRefName ?? "?"} (${data.headRefOid ?? "?"})`,
    "",
    "## Description",
    "",
    scrubBody.text.trim() || "(no description)",
    "",
    "## Commits",
  ];
  for (const commit of data.commits) {
    const firstLine = scrubSecrets(commit.message.split("\n")[0]).text;
    lines.push(`- \`${commit.oid.slice(0, 7)}\` ${firstLine}`);
  }
  lines.push("", "## Changed files");
  for (const file of data.files) {
    lines.push(
      `- ${file.path} (+${file.additions}/-${file.deletions}) ${file.changeType}`,
    );
  }
  if (data.checks.length > 0) {
    lines.push("", "## Checks");
    for (const check of data.checks) {
      lines.push(
        `- ${check.name}: ${check.conclusion ?? check.state ?? "unknown"}`,
      );
    }
  }
  if (data.reviews.length > 0) {
    lines.push("", "## Reviews");
    for (const review of data.reviews) {
      const body = scrubSecrets(review.body ?? "").text.trim().slice(0, 500);
      lines.push(
        `- ${review.author} [${review.state}]: ${body || "(no body)"}`,
      );
    }
  }
  if (data.comments.length > 0) {
    lines.push("", "## Conversation");
    for (const comment of data.comments.slice(0, 30)) {
      const body = scrubSecrets(comment.body ?? "").text.trim().slice(0, 400);
      lines.push(`- ${comment.author}: ${body || "(no body)"}`);
    }
    if (data.comments.length > 30) {
      lines.push(`- … (${data.comments.length - 30} more comments omitted)`);
    }
  }
  if (data.warnings.length > 0) {
    lines.push("", "## Data warnings", ...data.warnings.map((w) => `- ${w}`));
  }
  return lines.join("\n");
}

/**
 * Runs the configured agent to produce judgment conclusions for a review brief.
 */
export async function runReviewAgentConclusions(
  data: PullRequestReviewData,
  workspaceRoot: string,
  agent?: AgentSelection | null,
): Promise<ReviewAgentConclusions> {
  const systemPrompt = await readIncludedSystemPrompt(
    "system.prompt.review.md",
    workspaceRoot,
  );
  const evidence = formatReviewEvidenceForAgent(data);
  const combined = `${systemPrompt}\n\n---\n\n${evidence}`;

  const tmpDir = await Deno.makeTempDir({ prefix: "dn-review-" });
  const promptPath = `${tmpDir}/review.prompt.md`;
  await Deno.writeTextFile(promptPath, combined);

  const selection = agent ?? resolveAgentHarnessFromFlagsAndEnv();
  const run = getRunAgent(selection.harness, toAgentRunOptions(selection));
  try {
    const result = await run("plan", promptPath, workspaceRoot, true);
    if (result.code !== 0) {
      throw new Error(
        `Review agent failed (exit ${result.code}): ${
          result.stderr || result.stdout
        }`,
      );
    }
    return parseAgentConclusions(extractJsonObject(result.stdout));
  } finally {
    await Deno.remove(tmpDir, { recursive: true }).catch(() => {});
  }
}
