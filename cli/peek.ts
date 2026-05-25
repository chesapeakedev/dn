// Copyright 2026 Chesapeake Computing
// SPDX-License-Identifier: Apache-2.0

import {
  formatPeekIssues,
  getCurrentRepo,
  scorePeekIssues,
} from "../glance/mod.ts";
import { listIssues } from "../sdk/mod.ts";
import { formatError } from "./output.ts";

interface PeekParseResult {
  help: boolean;
  limit: number;
  fetchLimit: number;
  compact: boolean;
  noUrls: boolean;
  verbose: boolean;
}

function parsePeekArgs(args: string[]): PeekParseResult {
  let help = false;
  let limit = 3;
  let fetchLimit = 100;
  let compact = false;
  let noUrls = false;
  let verbose = false;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--help" || arg === "-h") {
      help = true;
    } else if (arg === "--compact") {
      compact = true;
    } else if (arg === "--no-urls") {
      noUrls = true;
    } else if (arg === "--verbose" || arg === "-v") {
      verbose = true;
    } else if (arg === "--limit" || arg === "-n") {
      const raw = args[i + 1];
      if (!raw) throw new Error("Missing value after --limit");
      const n = parseInt(raw, 10);
      if (isNaN(n) || n < 1) throw new Error(`Invalid --limit: ${raw}`);
      limit = n;
      i++;
    } else if (arg === "--fetch") {
      const raw = args[i + 1];
      if (!raw) throw new Error("Missing value after --fetch");
      const n = parseInt(raw, 10);
      if (isNaN(n) || n < 1 || n > 500) {
        throw new Error(`Invalid --fetch (use 1..500): ${raw}`);
      }
      fetchLimit = n;
      i++;
    }
  }

  return { help, limit, fetchLimit, compact, noUrls, verbose };
}

function showPeekHelp(): void {
  console.log(`
dn peek - Next issues to prioritize (heuristic ranking)

Scores open issues with simple signals (age, labels, staleness, comments,
assignees). Uses no LLM.

Usage:
  dn peek [options]

Options:
  -h, --help       Show this help message
  -n, --limit K    Print top K issues (default: 3)
      --fetch N    Consider up to N open issues from GitHub (default: 100, max 500)
      --compact    Tighter spacing
      --no-urls    Omit issue URLs
      -v, --verbose  Show numeric score breakdown
`);
}

export async function handlePeek(args: string[]): Promise<void> {
  let parsed: PeekParseResult;
  try {
    parsed = parsePeekArgs(args);
  } catch (e) {
    console.error(
      formatError(e instanceof Error ? e.message : String(e)),
    );
    Deno.exit(1);
  }

  if (parsed.help) {
    showPeekHelp();
    return;
  }

  try {
    const repo = await getCurrentRepo();
    const issues = await listIssues(repo.owner, repo.repo, {
      state: "open",
      limit: parsed.fetchLimit,
    });
    const ranked = scorePeekIssues(issues);
    const top = ranked.slice(0, parsed.limit);
    if (top.length === 0) {
      console.log(
        "No open issues matched the heuristic (empty candidate list).",
      );
      return;
    }
    console.log(
      formatPeekIssues(top, {
        compact: parsed.compact,
        noUrls: parsed.noUrls,
        verbose: parsed.verbose,
      }),
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(formatError(msg));
    if (
      msg.toLowerCase().includes("auth") ||
      msg.includes("GITHUB_TOKEN") ||
      msg.includes("credentials")
    ) {
      console.error(
        formatError(
          `Try: gh auth login, or dn auth, or a GITHUB_TOKEN with repo scope.`,
        ),
      );
    }
    if (msg.includes("remote") || msg.includes("repository")) {
      console.error(
        formatError(
          `Run inside a checkout whose origin is github.com/org/repo.`,
        ),
      );
    }
    Deno.exit(1);
  }
}
