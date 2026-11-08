// Copyright 2026 Chesapeake Computing
// SPDX-License-Identifier: Apache-2.0

import { resolveLocalAgentHarness } from "../sdk/config/localAgent.ts";
import type { AgentSelection } from "../sdk/github/agentHarness.ts";
import {
  extractAgentSelectionFromArgs,
  mergeAgentSelections,
} from "../sdk/github/agentHarness.ts";
import { createReviewBrief } from "../sdk/github/reviewBrief.ts";
import { normalizePullRequestUrl } from "../sdk/github/pullRequestReference.ts";
import { reviewFailureDocument } from "../sdk/github/reviewCliError.ts";
import { formatWarning } from "../sdk/github/output.ts";

function usage(): void {
  console.log(`dn review - read-only pull request review brief

Usage:
  dn review <pull-request-url> [options]

Arguments:
  <pull-request-url>   Full GitHub URL (https://github.com/owner/repo/pull/N)

Options:
  --json               Print the versioned machine-readable review contract
  --no-agent           Skip the configured agent; use GitHub signals only
  --signals-only       Alias for --no-agent
  --agent <harness>    Agent for judgment (also global --agent; see dn --help)
  --help               Show this help

Reads GitHub data only. Does not mutate the checkout, PR metadata, reviews, or CI.
Bare PR numbers are not accepted — pass a full URL (required on shared runners).`);
}

/** @internal Exported for CLI tests. */
export function parseReviewArgs(
  args: string[],
  globalAgent: AgentSelection | null,
): {
  help: boolean;
  json: boolean;
  noAgent: boolean;
  prUrl: string | null;
  agent: AgentSelection | null;
} {
  let help = false;
  let json = false;
  let noAgent = false;
  let prUrl: string | null = null;

  const { selection: localAgent, rest } = extractAgentSelectionFromArgs(args);
  const agent = mergeAgentSelections(globalAgent, localAgent);

  for (const arg of rest) {
    if (arg === "--help" || arg === "-h") help = true;
    else if (arg === "--json") json = true;
    else if (arg === "--no-agent" || arg === "--signals-only") noAgent = true;
    else if (
      [
        "--publish",
        "--write",
        "--comment",
        "--approve",
        "--merge",
      ].includes(arg)
    ) {
      throw new Error(
        "dn review is read-only and does not accept mutation or publish options.",
      );
    } else if (!arg.startsWith("--")) {
      if (prUrl !== null) {
        throw new Error("Provide exactly one pull request URL.");
      }
      prUrl = arg;
    } else {
      throw new Error(`Unknown option: ${arg}`);
    }
  }

  return { help, json, noAgent, prUrl, agent };
}

function wantsJsonOutput(args: string[]): boolean {
  return args.includes("--json");
}

function exitReviewJsonFailure(error: unknown): never {
  console.log(JSON.stringify(reviewFailureDocument(error), null, 2));
  Deno.exit(1);
}

/** Handles the read-only pull request review command. */
export async function handleReview(
  args: string[],
  globalAgent: AgentSelection | null = null,
): Promise<void> {
  const jsonMode = wantsJsonOutput(args);
  let parsed;
  try {
    parsed = parseReviewArgs(args, globalAgent);
  } catch (error) {
    if (jsonMode) exitReviewJsonFailure(error);
    throw error;
  }
  if (parsed.help || args.length === 0) {
    usage();
    return;
  }
  if (!parsed.prUrl) {
    const error = new Error("Provide a GitHub pull request URL.");
    if (jsonMode) exitReviewJsonFailure(error);
    throw error;
  }

  try {
    const prUrl = normalizePullRequestUrl(parsed.prUrl);
    const workspaceRoot = Deno.cwd();
    const agent = parsed.noAgent ? null : await resolveLocalAgentHarness({
      repoRoot: workspaceRoot,
      agent: parsed.agent,
    });

    const brief = await createReviewBrief(prUrl, {
      workspaceRoot,
      agent,
      noAgent: parsed.noAgent,
    });

    if (parsed.json) {
      console.log(JSON.stringify(brief, null, 2));
      return;
    }

    console.log(
      `# ${brief.identity.owner}/${brief.identity.repo}#${brief.identity.number}`,
    );
    console.log("\n## What it does\n");
    console.log(brief.conclusions.change);
    if (brief.conclusionsSource.change === "heuristic") {
      console.log(
        "\n_(signal heuristic — facts below; rerun without --no-agent for agent judgment)_",
      );
    }
    console.log("\n## Merge outlook\n");
    console.log(brief.conclusions.mergeOutlook);
    if (brief.warnings.length > 0) {
      console.log(`\n${
        formatWarning(
          brief.warnings.map((w) => w.message).join("; "),
        )
      }`);
    }
  } catch (error) {
    if (jsonMode) exitReviewJsonFailure(error);
    throw error;
  }
}

/** @deprecated Use {@link handleReview}. */
export async function handleRead(
  args: string[],
  globalAgent: AgentSelection | null = null,
): Promise<void> {
  console.error(
    formatWarning("dn read is deprecated; use dn review with a full PR URL."),
  );
  await handleReview(args, globalAgent);
}
