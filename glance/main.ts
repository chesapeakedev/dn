#!/usr/bin/env -S deno run --allow-run --allow-env --allow-net
// Copyright 2026 Chesapeake Computing
// SPDX-License-Identifier: Apache-2.0

import {
  formatGlanceJson,
  formatVelocity,
  gatherRfcMetrics,
  gatherVelocityData,
  getCurrentRepo,
} from "./mod.ts";
import type { FormatVelocityOptions } from "./types.ts";

interface GlanceArgs {
  help: boolean;
  days: number;
  compact: boolean;
  noUrls: boolean;
  json: boolean;
}

function parseGlanceCliArgs(raw: string[]): GlanceArgs {
  let help = false;
  let days = 7;
  let compact = false;
  let noUrls = false;
  let json = false;

  for (let i = 0; i < raw.length; i++) {
    const arg = raw[i];
    if (arg === "--help" || arg === "-h") {
      help = true;
    } else if (arg === "--compact") {
      compact = true;
    } else if (arg === "--no-urls") {
      noUrls = true;
    } else if (arg === "--json") {
      json = true;
    } else if (arg === "--days" || arg === "-d") {
      const daysArg = raw[i + 1];
      if (!daysArg) {
        console.error("Missing value for --days");
        Deno.exit(1);
      }
      days = parseInt(daysArg, 10);
      if (isNaN(days) || days < 1) {
        console.error(`Invalid days value: ${daysArg}`);
        Deno.exit(1);
      }
      i++;
    }
  }

  return { help, days, compact, noUrls, json };
}

function showStandaloneHelp(): void {
  console.log(`
glance - Project velocity overview

Usage:
  glance [options]

Options:
  -h, --help       Show this help message
  -d, --days N     Show activity for the last N days (default: 7)
      --compact    Fewer blank lines and shorter subsection headers
      --no-urls    Omit URLs for issues and commits
      --json       Machine-readable report (includes RFC fields when present)

Description:
  Visualizes recent project velocity using GitHub issues and commits.
  Compares the last N days against the preceding N-day window.

Requirements:
  - GitHub authentication: run \`gh auth login\`, or \`dn auth\`, or set GITHUB_TOKEN
  - Must be run from within a checkout with a GitHub remote on github.com

Flags align with \`dn glance\` for consistent output.
`);
}

async function main(): Promise<void> {
  const args = parseGlanceCliArgs(Deno.args);

  if (args.help) {
    showStandaloneHelp();
    Deno.exit(0);
  }

  try {
    const repo = await getCurrentRepo();
    console.error(`Repository: ${repo.owner}/${repo.repo}`);

    const velocity = await gatherVelocityData(repo.owner, repo.repo, args.days);
    const rfcMetrics = await gatherRfcMetrics({
      windowDays: args.days,
      referenceTime: velocity.weekEnd,
    });
    console.error(
      `Window: ${velocity.weekStart.toLocaleDateString()} - ${velocity.weekEnd.toLocaleDateString()} (${velocity.windowDays}d vs prior)`,
    );

    if (args.json) {
      console.log(formatGlanceJson(velocity, rfcMetrics));
      return;
    }

    const formatOpts: FormatVelocityOptions = {
      compact: args.compact,
      noUrls: args.noUrls,
      rfcMetrics,
    };
    const output = formatVelocity(velocity, formatOpts);
    console.log(output);
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error(`Error: ${msg}`);
    if (
      msg.toLowerCase().includes("auth") ||
      msg.includes("GITHUB_TOKEN")
    ) {
      console.error(
        `Hint: gh auth login, dn auth, or a GITHUB_TOKEN with repo scope.`,
      );
    }
    if (msg.includes("remote")) {
      console.error(`Hint: use a github.com remote (origin).`);
    }
    Deno.exit(1);
  }
}

if (import.meta.main) {
  await main();
}
