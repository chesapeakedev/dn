// Copyright 2026 Chesapeake Computing
// SPDX-License-Identifier: Apache-2.0

import { createReviewBrief } from "../sdk/github/reviewBrief.ts";
import { getCurrentRepoFromRemote } from "../sdk/github/github-gql.ts";

function usage(): void {
  console.log(`dn read - produce a read-only pull request review brief

Usage:
  dn read <pull-request-url-or-number> [--json]

Options:
  --json   Print the versioned machine-readable review contract
  --help   Show this help

The operation only reads GitHub data and never changes the checkout or PR state.`);
}

async function resolveReference(reference: string): Promise<string> {
  if (
    /^https?:\/\/github\.com\/[^/]+\/[^/]+\/pull\/\d+(?:[/?#].*)?$/.test(
      reference,
    )
  ) {
    const match = reference.match(
      /^https?:\/\/github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)/,
    );
    if (!match) throw new Error(`Invalid pull request reference: ${reference}`);
    return `https://github.com/${match[1]}/${match[2]}/pull/${match[3]}`;
  }
  if (/^#?\d+$/.test(reference)) {
    const { owner, repo } = await getCurrentRepoFromRemote();
    return `https://github.com/${owner}/${repo}/pull/${
      reference.replace(/^#/, "")
    }`;
  }
  throw new Error("Expected a GitHub pull request URL or number.");
}

/** Handles the read-only pull request review command. */
export async function handleRead(args: string[]): Promise<void> {
  if (args.includes("--help") || args.includes("-h") || args.length === 0) {
    usage();
    return;
  }
  if (
    args.some((arg) =>
      ["--publish", "--write", "--comment", "--review"].includes(arg)
    )
  ) {
    throw new Error(
      "dn read is read-only and does not accept mutation or publish options.",
    );
  }
  const json = args.includes("--json");
  const references = args.filter((arg) => !arg.startsWith("--"));
  if (references.length !== 1) {
    throw new Error("Provide exactly one pull request reference.");
  }
  const brief = await createReviewBrief(await resolveReference(references[0]));
  if (json) {
    console.log(JSON.stringify(brief, null, 2));
    return;
  }
  console.log(
    `# ${brief.identity.owner}/${brief.identity.repo}#${brief.identity.number}`,
  );
  console.log(brief.conclusions.change);
  console.log(brief.conclusions.mergeOutlook);
  if (brief.warnings.length > 0) {
    console.log(
      `Warnings: ${
        brief.warnings.map((warning) => warning.message).join("; ")
      }`,
    );
  }
}
