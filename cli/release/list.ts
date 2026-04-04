// Copyright 2026 Chesapeake Computing
// SPDX-License-Identifier: Apache-2.0

/**
 * dn release list — List GitHub releases.
 */

import { listReleases, resolveRepo } from "./api.ts";

function showUsage(): void {
  console.error("dn release list - List releases\n");
  console.error("Usage:");
  console.error("  dn release list [options]\n");
  console.error("Options:");
  console.error("  --limit <n>       Max results (default: 30)");
  console.error("  --json            Output as JSON");
  console.error("  -R <owner/repo>   Repository override");
  console.error("  --help, -h        Show this help message\n");
  console.error("Examples:");
  console.error("  dn release list");
  console.error("  dn release list --limit 10");
}

export async function handleList(args: string[]): Promise<void> {
  let limit = 30;
  let json = false;
  let repoOverride: string | undefined;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--help" || arg === "-h") {
      showUsage();
      return;
    } else if (arg === "--limit" && i + 1 < args.length) {
      limit = parseInt(args[++i], 10);
    } else if (arg === "--json") {
      json = true;
    } else if (arg === "-R" && i + 1 < args.length) {
      repoOverride = args[++i];
    }
  }

  const { owner, repo } = await resolveRepo(repoOverride);
  const releases = await listReleases(owner, repo, { limit });

  if (json) {
    console.log(JSON.stringify(releases, null, 2));
    return;
  }

  if (releases.length === 0) {
    console.log("No releases found.");
    return;
  }

  for (const release of releases) {
    const tag = release.tagName;
    const name = release.name ?? tag;
    const draft = release.draft ? " (Draft)" : "";
    const prerelease = release.prerelease ? " (Pre-release)" : "";
    const latest = !release.draft && !release.prerelease ? " (Latest)" : "";
    const date = new Date(release.publishedAt ?? release.createdAt)
      .toLocaleDateString("en-US", {
        year: "numeric",
        month: "short",
        day: "numeric",
      });
    console.log(`${tag} · ${name}${draft}${prerelease}${latest} · ${date}`);
  }

  console.log(`\nShowing ${releases.length} release(s)`);
}
