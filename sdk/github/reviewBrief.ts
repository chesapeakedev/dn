// Copyright 2026 Chesapeake Computing
// SPDX-License-Identifier: Apache-2.0

import type { AgentSelection } from "./agentHarness.ts";
import {
  fetchPullRequestReviewData,
  parsePullRequestUrl,
  type PullRequestReviewData,
} from "./github-gql.ts";
import { normalizePullRequestUrl } from "./pullRequestReference.ts";
import {
  canonicalizeReviewData,
  computeReviewDigest,
} from "./reviewBriefCanonical.ts";
import { runReviewAgentConclusions } from "./reviewAgent.ts";
import { scrubSecrets } from "./secretScrub.ts";

export {
  canonicalizeReviewData,
  computeReviewDigest,
} from "./reviewBriefCanonical.ts";

/** A normalized pull request identity used for cache invalidation. */
export interface ReviewPullRequestIdentity {
  owner: string;
  repo: string;
  number: number;
  url: string;
  headSha: string | null;
  baseRef: string | null;
  headRef: string | null;
}

/** A fact collected from GitHub, kept separate from agent judgment. */
export interface ReviewFact {
  source: string;
  value: string | number | boolean | null;
  complete: boolean;
}

/** Structured limitations encountered while collecting review evidence. */
export interface ReviewWarning {
  code:
    | "incomplete-data"
    | "unavailable-data"
    | "truncated-data"
    | "secrets-scrubbed"
    | "agent-unavailable";
  message: string;
}

/** The two conclusions produced by a review brief. */
export interface ReviewConclusions {
  change: string;
  mergeOutlook: string;
}

/** How each conclusion was produced (facts vs judgment). */
export interface ReviewConclusionsSource {
  change: "agent" | "heuristic";
  mergeOutlook: "agent" | "heuristic";
}

/** Machine-readable, versioned output of `dn review`. */
export interface ReviewBrief {
  schemaVersion: "1.0";
  identity: ReviewPullRequestIdentity;
  canonicalInput: string;
  digest: string;
  facts: ReviewFact[];
  conclusions: ReviewConclusions;
  conclusionsSource: ReviewConclusionsSource;
  warnings: ReviewWarning[];
}

export interface CreateReviewBriefOptions {
  workspaceRoot?: string;
  agent?: AgentSelection | null;
  /** Skip the configured agent; use signal heuristics only. */
  noAgent?: boolean;
}

function scrubReviewDataForPersistence(
  data: PullRequestReviewData,
): { data: PullRequestReviewData; scrubbed: SecretScrubResultSummary } {
  let redactionCount = 0;
  const categories = new Set<string>();

  const absorb = (text: string): string => {
    const result = scrubSecrets(text);
    redactionCount += result.redactionCount;
    for (const c of result.categories) categories.add(c);
    return result.text;
  };

  return {
    data: {
      ...data,
      body: absorb(data.body ?? ""),
      comments: data.comments.map((c) => ({
        ...c,
        body: absorb(c.body),
      })),
      reviews: data.reviews.map((r) => ({
        ...r,
        body: absorb(r.body ?? ""),
      })),
      commits: data.commits.map((c) => ({
        ...c,
        message: absorb(c.message),
      })),
    },
    scrubbed: {
      redactionCount,
      categories: [...categories].sort(),
    },
  };
}

interface SecretScrubResultSummary {
  redactionCount: number;
  categories: string[];
}

/** Signal-only fallback conclusions when the agent is skipped or fails. */
export function heuristicConclusions(
  data: PullRequestReviewData,
): ReviewConclusions {
  const fileCount = data.files.length;
  const additions = data.files.reduce((sum, file) => sum + file.additions, 0);
  const deletions = data.files.reduce((sum, file) => sum + file.deletions, 0);
  const pendingChanges =
    data.reviewThreads.filter((thread) =>
      !thread.isResolved && !thread.isOutdated
    ).length;
  const failingChecks =
    data.checks.filter((check) =>
      ["FAILURE", "ERROR", "CANCELLED"].includes(
        (check.conclusion ?? check.state ?? "").toUpperCase(),
      )
    ).length;
  const mergeReasons: string[] = [];
  if (data.state === "CLOSED" && data.mergeable !== "MERGEABLE") {
    mergeReasons.push("the pull request is already closed");
  }
  if (data.isDraft) mergeReasons.push("the pull request is a draft");
  if (data.mergeable === "CONFLICTING") {
    mergeReasons.push("GitHub reports merge conflicts");
  }
  if (failingChecks > 0) {
    mergeReasons.push(`${failingChecks} check(s) are failing`);
  }
  if (data.reviewDecision === "CHANGES_REQUESTED") {
    mergeReasons.push("changes have been requested");
  }
  if (pendingChanges > 0) {
    mergeReasons.push(`${pendingChanges} unresolved review thread(s) remain`);
  }
  const mergeOutlook = mergeReasons.length === 0
    ? "Likely mergeable based on the available GitHub signals, though this is not a guarantee."
    : `Unlikely to merge yet because ${mergeReasons.join(", ")}.`;
  return {
    change:
      `${data.title} changes ${fileCount} file(s), with ${additions} addition(s) and ${deletions} deletion(s). (Heuristic summary; use the configured agent without --no-agent for a behavioral description.)`,
    mergeOutlook,
  };
}

function buildFacts(data: PullRequestReviewData): ReviewFact[] {
  return [
    { source: "github.state", value: data.state, complete: true },
    { source: "github.draft", value: data.isDraft, complete: true },
    { source: "github.mergeable", value: data.mergeable, complete: true },
    {
      source: "github.mergeStateStatus",
      value: data.mergeStateStatus,
      complete: data.mergeStateStatus !== null,
    },
    {
      source: "github.reviewDecision",
      value: data.reviewDecision,
      complete: data.reviewDecision !== null,
    },
    {
      source: "github.checkCount",
      value: data.checks.length,
      complete: !data.warnings.some((warning) => warning.includes("Checks")),
    },
    {
      source: "github.unresolvedReviewThreads",
      value: data.reviewThreads.filter((thread) => !thread.isResolved).length,
      complete: true,
    },
  ];
}

/** Builds a deterministic read-only review brief from GitHub PR evidence. */
export async function createReviewBrief(
  prReference: string,
  options: CreateReviewBriefOptions = {},
): Promise<ReviewBrief> {
  const prUrl = normalizePullRequestUrl(prReference);
  const parsed = parsePullRequestUrl(prUrl);
  if (!parsed) throw new Error(`Invalid PR URL: ${prUrl}`);

  const raw = await fetchPullRequestReviewData(prUrl);
  const { data, scrubbed } = scrubReviewDataForPersistence(raw);

  const warnings: ReviewWarning[] = raw.warnings.map((message) => ({
    code: message.includes("unavailable")
      ? "unavailable-data"
      : "truncated-data",
    message,
  }));
  if (!data.headRefOid) {
    warnings.push({
      code: "incomplete-data",
      message: "The pull request head SHA is unavailable.",
    });
  }
  if (scrubbed.redactionCount > 0) {
    warnings.push({
      code: "secrets-scrubbed",
      message:
        `Scrubbed ${scrubbed.redactionCount} likely secret segment(s) before analysis and caching (${
          scrubbed.categories.join(", ")
        }).`,
    });
  }

  const workspaceRoot = options.workspaceRoot ?? Deno.cwd();
  let conclusions: ReviewConclusions;
  let conclusionsSource: ReviewConclusionsSource = {
    change: "heuristic",
    mergeOutlook: "heuristic",
  };

  if (options.noAgent) {
    conclusions = heuristicConclusions(data);
  } else {
    try {
      const agentOut = await runReviewAgentConclusions(
        data,
        workspaceRoot,
        options.agent,
      );
      conclusions = {
        change: agentOut.change,
        mergeOutlook: agentOut.mergeOutlook,
      };
      conclusionsSource = { change: "agent", mergeOutlook: "agent" };
      for (const limitation of agentOut.limitations) {
        warnings.push({
          code: "incomplete-data",
          message: limitation,
        });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      warnings.push({
        code: "agent-unavailable",
        message: `Review agent did not produce conclusions: ${message}`,
      });
      conclusions = heuristicConclusions(data);
    }
  }

  const canonicalInput = canonicalizeReviewData(data);
  const facts = buildFacts(data);

  return {
    schemaVersion: "1.0",
    identity: {
      ...parsed,
      url:
        `https://github.com/${parsed.owner}/${parsed.repo}/pull/${parsed.number}`,
      headSha: data.headRefOid,
      baseRef: data.baseRefName,
      headRef: data.headRefName,
    },
    canonicalInput,
    digest: await computeReviewDigest(canonicalInput),
    facts,
    conclusions,
    conclusionsSource,
    warnings,
  };
}
