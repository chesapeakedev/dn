// Copyright 2026 Chesapeake Computing
// SPDX-License-Identifier: Apache-2.0

import {
  formatVelocity,
  gatherVelocityData,
  getCurrentRepo,
} from "../glance/mod.ts";
import type { FormatVelocityOptions } from "../glance/types.ts";
import { formatError } from "./output.ts";

interface GlanceParseResult {
  help: boolean;
  days: number;
  compact: boolean;
  noUrls: boolean;
}

function parseGlanceArgs(args: string[]): GlanceParseResult {
  let help = false;
  let days = 7;
  let compact = false;
  let noUrls = false;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--help" || arg === "-h") {
      help = true;
    } else if (arg === "--compact") {
      compact = true;
    } else if (arg === "--no-urls") {
      noUrls = true;
    } else if (arg === "--days" || arg === "-d") {
      const daysArg = args[i + 1];
      if (daysArg) {
        days = parseInt(daysArg, 10);
        if (isNaN(days) || days < 1) {
          throw new Error(`Invalid days value: ${daysArg}`);
        }
        i++;
      }
    }
  }

  return { help, days, compact, noUrls };
}

function showGlanceHelp(): void {
  console.log(`
dn glance - Project velocity overview

Usage:
  dn glance [options]

Options:
  -h, --help       Show this help message
  -d, --days N     Show activity for the last N days (default: 7)
      --compact    Fewer blank lines and shorter subsection headers
      --no-urls    Omit URLs for issues and commits (titles and SHAs only)
`);
}

export async function handleGlance(args: string[]): Promise<void> {
  let parsed: GlanceParseResult;
  try {
    parsed = parseGlanceArgs(args);
  } catch (e) {
    console.error(
      formatError(e instanceof Error ? e.message : String(e)),
    );
    Deno.exit(1);
  }

  if (parsed.help) {
    showGlanceHelp();
    return;
  }

  try {
    const repo = await getCurrentRepo();
    const velocity = await gatherVelocityData(
      repo.owner,
      repo.repo,
      parsed.days,
    );
    const formatOpts: FormatVelocityOptions = {
      compact: parsed.compact,
      noUrls: parsed.noUrls,
    };
    console.log(formatVelocity(velocity, formatOpts));
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(formatError(`${msg}`));
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
