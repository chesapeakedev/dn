// Copyright 2026 Chesapeake Computing
// SPDX-License-Identifier: Apache-2.0

/**
 * dn release view — View release details.
 */

import { getRelease, getReleaseByTag, resolveRepo } from "./api.ts";

function showUsage(): void {
  console.error("dn release view - View release details\n");
  console.error("Usage:");
  console.error("  dn release view <tag>\n");
  console.error("Arguments:");
  console.error("  <tag>             Release tag name or ID\n");
  console.error("Options:");
  console.error("  --json            Output as JSON");
  console.error("  -R <owner/repo>   Repository override");
  console.error("  --help, -h        Show this help message\n");
  console.error("Examples:");
  console.error("  dn release view v1.2.3");
  console.error("  dn release view 12345678");
}

export async function handleView(args: string[]): Promise<void> {
  let tagRef: string | null = null;
  let json = false;
  let repoOverride: string | undefined;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--help" || arg === "-h") {
      showUsage();
      return;
    } else if (arg === "--json") {
      json = true;
    } else if (arg === "-R" && i + 1 < args.length) {
      repoOverride = args[++i];
    } else if (!arg.startsWith("-") && !tagRef) {
      tagRef = arg;
    }
  }

  if (!tagRef) {
    console.error("Error: Release tag name or ID required");
    showUsage();
    Deno.exit(1);
  }

  const { owner, repo } = await resolveRepo(repoOverride);

  // Try as numeric ID first, then as tag name
  let release;
  const numericId = parseInt(tagRef, 10);
  if (!isNaN(numericId)) {
    try {
      release = await getRelease(owner, repo, numericId);
    } catch {
      release = await getReleaseByTag(owner, repo, tagRef);
    }
  } else {
    release = await getReleaseByTag(owner, repo, tagRef);
  }

  if (json) {
    console.log(JSON.stringify(release, null, 2));
    return;
  }

  const lines: string[] = [];
  lines.push(`# ${release.name ?? release.tagName}`);
  lines.push("");
  lines.push(
    `${release.tagName} · ${
      release.draft ? "Draft" : release.prerelease ? "Pre-release" : "Release"
    } · ${release.htmlUrl}`,
  );
  lines.push(
    `Published by ${
      release.publishedAt
        ? new Date(release.publishedAt).toLocaleDateString("en-US", {
          year: "numeric",
          month: "short",
          day: "numeric",
        })
        : "unpublished"
    }`,
  );

  if (release.assets.length > 0) {
    lines.push("");
    lines.push("## Assets");
    for (const asset of release.assets) {
      lines.push(`- ${asset.name} (${formatBytes(asset.size)})`);
    }
  }

  if (release.body) {
    lines.push("");
    lines.push("---");
    lines.push("");
    lines.push(release.body);
  }

  console.log(lines.join("\n"));
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}
